import { Injectable, Logger } from '@nestjs/common';
import { type Database, InjectDatabase } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { jobs, type schema } from '../db/schema.js';
import { hashJson } from '../hashing.js';
import type { ModelProvider, StructuredResult, Usage } from '../providers/port.js';
import { InjectModelProvider } from '../providers/providers.module.js';
import type { Language } from '../tasks/common.js';
import { buildProviderRequest } from '../tasks/provider-request.js';
import { findTask } from '../tasks/registry.js';
import { aiLabel, type TaskDefinition } from '../tasks/task.js';
import { jobFinished } from './events.js';
import type { JobReason } from './job-states.js';

type Job = typeof jobs.$inferSelect;

type Outcome =
  | { status: 'succeeded'; output: Record<string, unknown> }
  | { status: 'failed'; reason: JobReason };

interface Measured {
  usage: Usage | null;
  latencyMs: number;
}

/**
 * Runs jobs: one attempt per `execute` call. Provider errors propagate so the workflow can
 * retry them; every other ending (success, refusal, invalid output) is final and recorded
 * here, with its event, in one transaction.
 */
@Injectable()
export class JobExecutor {
  private readonly logger = new Logger(JobExecutor.name);

  constructor(
    @InjectDatabase() private readonly db: Database<typeof schema>,
    @InjectModelProvider() private readonly provider: ModelProvider,
    private readonly events: EventPublisher,
  ) {}

  async execute(jobId: string): Promise<void> {
    const job = await this.start(jobId);
    if (!job) return;
    const task = findTask(job.task);
    if (!task || job.input === null) {
      // Unreachable: jobs are created for registered tasks and keep their input until they end.
      throw new Error(`Job ${jobId} cannot run: unknown task or missing input`);
    }
    const request = buildProviderRequest(task, job.promptVersion, job.input, {
      model: job.model,
      maxOutputTokens: task.maxOutputTokens,
    });
    const startedAt = performance.now();
    const result = await this.provider.generateStructured(request);
    const measured = { usage: result.usage, latencyMs: Math.round(performance.now() - startedAt) };
    await this.finish(job, this.outcome(job, task, result), measured);
  }

  /** Records a job whose execution could not succeed (retries exhausted, permanent error). */
  async fail(jobId: string, reason: JobReason): Promise<void> {
    const [job] = await this.db.select().from(jobs).where(eq(jobs.id, jobId));
    if (job) await this.finish(job, { status: 'failed', reason }, { usage: null, latencyMs: 0 });
  }

  /** Marks the job running; undefined when it has already ended (a late retry, a replay). */
  private async start(jobId: string): Promise<Job | undefined> {
    const [job] = await this.db
      .update(jobs)
      .set({ status: 'running', startedAt: sql`coalesce(${jobs.startedAt}, now())` })
      .where(and(eq(jobs.id, jobId), inArray(jobs.status, ['queued', 'running'])))
      .returning();
    return job;
  }

  private outcome(job: Job, task: TaskDefinition, result: StructuredResult): Outcome {
    if (result.status === 'refused') return { status: 'failed', reason: 'refused' };
    // A cut-off structured output is absent: nothing valid to keep.
    if (result.status === 'truncated') return { status: 'failed', reason: 'validation' };
    const parsed = task.output.safeParse(result.output);
    if (!parsed.success) {
      // Issue paths and codes only: messages can quote the output.
      this.logger.warn(
        {
          jobId: job.id,
          task: job.task,
          issues: parsed.error.issues.map((issue) => ({ path: issue.path, code: issue.code })),
        },
        'Model output failed the task schema',
      );
      return { status: 'failed', reason: 'validation' };
    }
    const language = (job.input as { language: Language }).language;
    const label = aiLabel(
      {
        task: task.name,
        promptVersion: job.promptVersion,
        provider: job.provider,
        model: job.model,
        generatedAt: new Date().toISOString(),
      },
      language,
    );
    return { status: 'succeeded', output: { label, ...parsed.data } };
  }

  /** Moves a live job to its final state and announces it; a job that already ended is left. */
  private async finish(job: Job, outcome: Outcome, measured: Measured): Promise<void> {
    const output = outcome.status === 'succeeded' ? outcome.output : null;
    await this.db.transaction(async (tx) => {
      const [finished] = await tx
        .update(jobs)
        .set({
          status: outcome.status,
          reason: outcome.status === 'failed' ? outcome.reason : null,
          output,
          outputHash: output && hashJson(output),
          input: null,
          ...(measured.usage && {
            tokensIn: measured.usage.inputTokens,
            tokensOut: measured.usage.outputTokens,
          }),
          latencyMs: measured.latencyMs,
          finishedAt: sql`now()`,
        })
        .where(and(eq(jobs.id, job.id), inArray(jobs.status, ['queued', 'running'])))
        .returning();
      if (finished) await this.events.record(tx, jobFinished(finished));
    });
  }
}
