import { setTimeout as sleep } from 'node:timers/promises';

import { Injectable, Logger } from '@nestjs/common';
import { type Database, InjectDatabase } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { type Job, jobs, type schema } from '../db/schema.js';
import { hashJson } from '../hashing.js';
import { Budgets } from '../policy/budgets.js';
import { CircuitBreaker } from '../policy/circuit-breaker.js';
import { GatePolicies } from '../policy/gate-policies.js';
import { costMicros } from '../policy/pricing.js';
import { type PreparedPrompt, preparePrompt } from '../policy/prompt.js';
import { sourceRefProblems } from '../policy/source-refs.js';
import { GenAiTelemetry } from '../policy/telemetry.js';
import {
  type ModelProvider,
  ProviderError,
  type StructuredResult,
  totalInputTokens,
  type Usage,
} from '../providers/port.js';
import { ProviderRegistry } from '../providers/providers.module.js';
import { inputLanguage } from '../tasks/common.js';
import { findTask } from '../tasks/registry.js';
import { aiLabel, type OutputViolation, type TaskDefinition } from '../tasks/task.js';
import { recordJobEnded } from './job-ended.js';
import { type JobReason, LIVE_STATUSES } from './job-states.js';
import { parseParams } from './routing.js';

type Outcome =
  | { status: 'succeeded'; output: Record<string, unknown> }
  | { status: 'failed' | 'blocked'; reason: JobReason; violations?: OutputViolation[] };

/** What one provider call cost; absent when the job ends without a call. */
interface AttemptMetrics {
  usage: Usage | null;
  /** Model that served the call, which prices it. */
  model: string | null;
  latencyMs: number;
}

const NO_CALL: AttemptMetrics = { usage: null, model: null, latencyMs: 0 };
/** Longest one write of a job's final state may take (Postgres `statement_timeout`). */
const WRITE_TIMEOUT_MS = 5_000;
/**
 * The same bound on this side: a connection lost mid-write never answers, and the server's
 * timeout cannot reach a client it has lost. Covers the commit too.
 */
const WRITE_WAIT_MS = WRITE_TIMEOUT_MS + 1_000;
const RECORD_RETRY_DELAY_MS = { first: 250, max: 4_000 };

/**
 * A provider result that could not be recorded. Not retried: another attempt would call, and
 * pay, the provider again; the workflow fails the job instead.
 */
export class ResultNotRecordedError extends Error {
  override readonly name = 'ResultNotRecordedError';
}

/**
 * Runs `write` (bounded by `WRITE_WAIT_MS`), retrying with backoff while another try can
 * still end before `deadline`; then throws `ResultNotRecordedError`. A write abandoned by the
 * timer may still commit later; that is safe, since final-state writes only apply to live jobs
 * and the job then simply keeps the recorded result.
 */
async function retryWrite(
  jobId: string,
  deadline: number,
  write: () => Promise<void>,
): Promise<void> {
  for (
    let delay = RECORD_RETRY_DELAY_MS.first;
    ;
    delay = Math.min(delay * 2, RECORD_RETRY_DELAY_MS.max)
  ) {
    try {
      await withTimeout(write(), WRITE_WAIT_MS);
      return;
    } catch (error) {
      if (Date.now() + delay + WRITE_WAIT_MS > deadline) {
        throw new ResultNotRecordedError(`Could not record the result of job ${jobId}`, {
          cause: error,
        });
      }
      await sleep(delay);
    }
  }
}

/** `work`, or a rejection once `ms` pass; the work itself is not cancelled. */
async function withTimeout(work: Promise<void>, ms: number): Promise<void> {
  const timer = new AbortController();
  try {
    await Promise.race([
      work,
      sleep(ms, undefined, { signal: timer.signal }).then(() => {
        throw new Error(`Write did not finish within ${ms} ms`);
      }),
    ]);
  } finally {
    timer.abort();
  }
}

/**
 * Runs jobs through the policy pipeline, one attempt per `execute` call: provider reachable,
 * classification gate, budget, circuit breaker, then minimise, prompt with the input as
 * untrusted data, call, validate the output against the task schema and the input's refs,
 * restore the identifiers, and record. Provider transport errors propagate so the workflow can
 * retry them; every other ending is final and recorded here, with its audit record and event,
 * in one transaction.
 */
@Injectable()
export class JobExecutor {
  private readonly logger = new Logger(JobExecutor.name);

  constructor(
    @InjectDatabase() private readonly db: Database<typeof schema>,
    private readonly providers: ProviderRegistry,
    private readonly gate: GatePolicies,
    private readonly budgets: Budgets,
    private readonly breaker: CircuitBreaker,
    private readonly telemetry: GenAiTelemetry,
    private readonly events: EventPublisher,
  ) {}

  /**
   * @param deadline epoch ms by which this attempt must have recorded its result or given up,
   *   so that giving up (`ResultNotRecordedError`) always comes before the attempt times out
   *   and is retried with a second provider call.
   */
  async execute(jobId: string, deadline: number): Promise<void> {
    const job = await this.start(jobId);
    if (!job) return;
    const task = findTask(job.task);
    if (!task || job.input === null) {
      // Unreachable: jobs are created for registered tasks and keep their input until they end.
      throw new Error(`Job ${jobId} cannot run: unknown task or missing input`);
    }
    const ending = await this.admission(job);
    if (ending) {
      await this.finish(job, ending, NO_CALL);
      return;
    }
    const provider = this.providers.get(job.provider);
    if (!provider) throw new Error(`Job ${jobId}: provider ${job.provider} vanished`);

    const params = parseParams(job.params, `job ${job.id}`);
    // The token map lives in `prompt` for this attempt only, and is never stored or logged.
    const prompt = preparePrompt(task, job.promptVersion, job.input, job.model, params);
    const startedAt = performance.now();
    const result = await this.call(job, provider, prompt, params.timeoutMs);
    const metrics: AttemptMetrics = {
      usage: result.usage,
      model: result.model,
      latencyMs: Math.round(performance.now() - startedAt),
    };
    const outcome = this.outcome(job, task, result, prompt);
    // The call is paid for: a database outage while recording it must not send the job back to
    // the workflow's retry, which would call the provider again. A worker that dies between
    // the call and the commit still leads to a second call; only storing the raw result first
    // would prevent that.
    await retryWrite(job.id, deadline, () => this.finish(job, outcome, metrics));
  }

  /** Records a job whose execution could not succeed (retries exhausted, permanent error). */
  async fail(jobId: string, reason: JobReason): Promise<void> {
    const [job] = await this.db.select().from(jobs).where(eq(jobs.id, jobId));
    if (job) await this.finish(job, { status: 'failed', reason }, NO_CALL);
  }

  /**
   * Why the job must end without contacting its provider, checked again at each attempt since
   * policy, budget and provider health may have changed since it was created; undefined when it
   * may go ahead. Claims the breaker's probe when it lets the call through.
   */
  private async admission(job: Job): Promise<Outcome | undefined> {
    const provider = this.providers.get(job.provider);
    if (!provider) return { status: 'failed', reason: 'provider-unavailable' };
    if (!(await this.gate.admits(job.tenant, job.dataClass, provider.providerClass))) {
      return { status: 'blocked', reason: 'policy' };
    }
    if (await this.budgets.exhausted(job.tenant)) return { status: 'blocked', reason: 'budget' };
    if (!this.breaker.tryAcquire(provider.name)) {
      return { status: 'failed', reason: 'provider-unavailable' };
    }
    return undefined;
  }

  /** One provider call in a GenAI span, bounded by the route's timeout, fed to the breaker. */
  private async call(
    job: Job,
    provider: ModelProvider,
    prompt: PreparedPrompt,
    timeoutMs: number | undefined,
  ): Promise<StructuredResult> {
    try {
      const result = await this.telemetry.call(
        {
          jobId: job.id,
          tenant: job.tenant,
          task: job.task,
          promptVersion: job.promptVersion,
          provider: provider.name,
          model: job.model,
          maxOutputTokens: prompt.request.maxOutputTokens,
        },
        () => withCallTimeout(provider, provider.generateStructured(prompt.request), timeoutMs),
      );
      this.breaker.recordSuccess(provider.name);
      return result;
    } catch (error) {
      if (error instanceof ProviderError && error.retryable) {
        this.breaker.recordFailure(provider.name);
      } else {
        // The provider answered (a bad request, bad credentials) or the failure was ours.
        this.breaker.release(provider.name);
      }
      throw error;
    }
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

  /**
   * The job's ending for a provider result. Validated twice: the raw output against the task
   * schema and the input's refs, then the output with identifiers restored against the schema
   * again, so what is stored is always valid. Any failure stores nothing (no partial output).
   */
  private outcome(
    job: Job,
    task: TaskDefinition,
    result: StructuredResult,
    prompt: PreparedPrompt,
  ): Outcome {
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
    // Problems name keys and ids (item, person, section, flag), never text.
    const problems = sourceRefProblems(job.input, parsed.data);
    if (problems.length > 0) {
      this.logger.warn(
        { jobId: job.id, task: job.task, problems: problems.slice(0, 20) },
        'Model output refers to what the input does not hold',
      );
      return { status: 'failed', reason: 'validation' };
    }
    const restored = task.output.safeParse(prompt.restore(parsed.data));
    if (!restored.success) {
      this.logger.warn(
        {
          jobId: job.id,
          task: job.task,
          issues: restored.error.issues.map((issue) => ({ path: issue.path, code: issue.code })),
        },
        'Model output failed the task schema once identifiers were restored',
      );
      return { status: 'failed', reason: 'validation' };
    }
    // The task's own checks read the output as stored: identifiers restored, as in the input.
    const violations = task.validate?.(task.input.parse(job.input), restored.data) ?? [];
    if (violations.length > 0) {
      this.logger.warn(
        { jobId: job.id, task: job.task, violations: violations.slice(0, 20) },
        'Model output failed the task checks',
      );
      return { status: 'failed', reason: 'validation', violations };
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
    return { status: 'succeeded', output: { label, ...restored.data } };
  }

  /**
   * Moves a live job to its final state, with its audit record and event; a job that already
   * ended is left. Counted in telemetry once committed.
   */
  private async finish(job: Job, outcome: Outcome, metrics: AttemptMetrics): Promise<void> {
    const output = outcome.status === 'succeeded' ? outcome.output : null;
    const finished = await this.db.transaction(async (tx) => {
      // A hung write (lock wait, lost connection) must fail in time for the caller to react.
      await tx.execute(sql.raw(`set local statement_timeout = ${WRITE_TIMEOUT_MS}`));
      const [row] = await tx
        .update(jobs)
        .set({
          status: outcome.status,
          reason: outcome.status === 'succeeded' ? null : outcome.reason,
          violations: outcome.status === 'succeeded' ? null : (outcome.violations ?? null),
          output,
          outputHash: output && hashJson(output),
          input: null,
          ...(metrics.usage && {
            tokensIn: totalInputTokens(metrics.usage),
            tokensOut: metrics.usage.outputTokens,
            costMicros: costMicros(metrics.model ?? job.model, metrics.usage),
          }),
          latencyMs: metrics.latencyMs,
          finishedAt: sql`now()`,
        })
        .where(and(eq(jobs.id, job.id), inArray(jobs.status, LIVE_STATUSES)))
        .returning();
      if (row) await recordJobEnded(tx, this.events, row);
      return row;
    });
    if (finished) this.telemetry.jobFinished(finished);
  }
}

/**
 * The provider's answer, or a retryable timeout once the route's `timeoutMs` passes. The call
 * itself is not cancelled (the port has no signal); the provider client's own timeout ends it.
 */
async function withCallTimeout(
  provider: ModelProvider,
  call: Promise<StructuredResult>,
  timeoutMs: number | undefined,
): Promise<StructuredResult> {
  if (timeoutMs === undefined) return call;
  const timer = new AbortController();
  try {
    return await Promise.race([
      call,
      sleep(timeoutMs, undefined, { signal: timer.signal }).then(() => {
        throw new ProviderError(
          'timeout',
          provider.name,
          `No answer from ${provider.name} within the route's ${timeoutMs} ms`,
        );
      }),
    ]);
  } finally {
    timer.abort();
  }
}
