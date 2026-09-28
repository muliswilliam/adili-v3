import { setTimeout as sleep } from 'node:timers/promises';

import { Injectable, Logger } from '@nestjs/common';
import { type Database, InjectDatabase } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { type Job, jobs, type schema } from '../db/schema.js';
import { hashJson } from '../hashing.js';
import {
  type ModelProvider,
  type StructuredResult,
  totalInputTokens,
  type Usage,
} from '../providers/port.js';
import { InjectModelProvider } from '../providers/providers.module.js';
import { inputLanguage } from '../tasks/common.js';
import { buildProviderRequest } from '../tasks/provider-request.js';
import { findTask } from '../tasks/registry.js';
import { aiLabel, type TaskDefinition } from '../tasks/task.js';
import { gateAdmits } from './classification-gate.js';
import { jobFinished } from './events.js';
import { type JobReason, LIVE_STATUSES } from './job-states.js';

type Outcome =
  | { status: 'succeeded'; output: Record<string, unknown> }
  | { status: 'failed' | 'blocked'; reason: JobReason };

/** What one provider call cost; absent when the job ends without a call. */
interface AttemptMetrics {
  usage: Usage | null;
  latencyMs: number;
}

const NO_CALL: AttemptMetrics = { usage: null, latencyMs: 0 };
const FINISH_RETRY_DELAYS_MS = [250, 1000, 4000];

/** Runs `write`, retrying briefly on failure; rethrows once the pauses are spent. */
async function retried(write: () => Promise<void>): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await write();
      return;
    } catch (error) {
      const delay = FINISH_RETRY_DELAYS_MS[attempt];
      if (delay === undefined) throw error;
      await sleep(delay);
    }
  }
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
    // Checked again here, against the provider this process will actually contact.
    if (!gateAdmits(job.dataClass, this.provider.providerClass)) {
      await this.finish(job, { status: 'blocked', reason: 'policy' }, NO_CALL);
      return;
    }
    const request = buildProviderRequest(task, job.promptVersion, job.input, job.model);
    const startedAt = performance.now();
    const result = await this.provider.generateStructured(request);
    const metrics = { usage: result.usage, latencyMs: Math.round(performance.now() - startedAt) };
    // The call is paid for: a database blip while recording it must not send the job back to
    // the workflow's retry, which would call the provider again.
    await retried(() => this.finish(job, this.outcome(job, task, result), metrics));
  }

  /** Records a job whose execution could not succeed (retries exhausted, permanent error). */
  async fail(jobId: string, reason: JobReason): Promise<void> {
    const [job] = await this.db.select().from(jobs).where(eq(jobs.id, jobId));
    if (job) await this.finish(job, { status: 'failed', reason }, NO_CALL);
  }

  /** Marks the job running; undefined when it has already ended (a late retry, a replay). */
  private async start(jobId: string): Promise<Job | undefined> {
    const [job] = await this.db
      .update(jobs)
      .set({ status: 'running', startedAt: sql`coalesce(${jobs.startedAt}, now())` })
      .where(and(eq(jobs.id, jobId), inArray(jobs.status, LIVE_STATUSES)))
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
    const language = inputLanguage(job.input);
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
  private async finish(job: Job, outcome: Outcome, metrics: AttemptMetrics): Promise<void> {
    const output = outcome.status === 'succeeded' ? outcome.output : null;
    await this.db.transaction(async (tx) => {
      const [finished] = await tx
        .update(jobs)
        .set({
          status: outcome.status,
          reason: outcome.status === 'succeeded' ? null : outcome.reason,
          output,
          outputHash: output && hashJson(output),
          input: null,
          ...(metrics.usage && {
            tokensIn: totalInputTokens(metrics.usage),
            tokensOut: metrics.usage.outputTokens,
          }),
          latencyMs: metrics.latencyMs,
          finishedAt: sql`now()`,
        })
        .where(and(eq(jobs.id, job.id), inArray(jobs.status, LIVE_STATUSES)))
        .returning();
      if (finished) await this.events.record(tx, jobFinished(finished));
    });
  }
}
