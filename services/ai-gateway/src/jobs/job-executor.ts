import { setTimeout as sleep } from 'node:timers/promises';

import { Injectable, Logger } from '@nestjs/common';
import { InjectDatabase } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { asPlatform, asTenant, type GatewayDatabase } from '../db/context.js';
import { DocumentFetcher } from '../documents/document-fetcher.js';
import { DocumentError } from '../documents/document-error.js';
import { readDocument, type ReadDocument } from '../documents/read-document.js';
import { type Job, jobs } from '../db/schema.js';
import { hashJson } from '../hashing.js';
import { CircuitBreaker } from '../policy/circuit-breaker.js';
import { costMicros } from '../policy/pricing.js';
import { type PreparedPrompt, preparePrompt } from '../policy/prompt.js';
import { UnknownTokenError } from '../policy/minimisation.js';
import { problemCounts, sourceRefProblems } from '../policy/source-refs.js';
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
import {
  type AiLabel,
  aiLabel,
  type OutputViolation,
  outputSchemaOf,
  type TaskDefinition,
} from '../tasks/task.js';
import { Admission } from './admission.js';
import { recordJobEnded } from './job-ended.js';
import { type JobReason, LIVE_STATUSES } from './job-states.js';
import { parseParams, type RouteParams } from './routing.js';

/**
 * How a job ends. A succeeded job carries violations only when its output was replaced because it
 * failed its checks (a streamed answer becomes a decline).
 */
export type Outcome =
  | { status: 'succeeded'; output: Record<string, unknown>; violations?: OutputViolation[] }
  | { status: 'failed' | 'blocked'; reason: JobReason; violations?: OutputViolation[] };

/** The document a job's task reads, before the call. */
type DocumentReading =
  { status: 'none' } | { status: 'read'; document: ReadDocument } | { status: 'failed' };

/** What one provider call cost; absent when the job ends without a call. */
export interface AttemptMetrics {
  usage: Usage | null;
  /** Model that served the call, which prices it. */
  model: string | null;
  latencyMs: number;
}

export const NO_CALL: AttemptMetrics = { usage: null, model: null, latencyMs: 0 };

/** Violations kept with a job and its audit record: enough to say why, bounded. */
export const MAX_STORED_VIOLATIONS = 20;
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
    @InjectDatabase() private readonly db: GatewayDatabase,
    private readonly providers: ProviderRegistry,
    private readonly admission: Admission,
    private readonly breaker: CircuitBreaker,
    private readonly telemetry: GenAiTelemetry,
    private readonly events: EventPublisher,
    private readonly documents: DocumentFetcher,
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
    const refusal = await this.admission.refusal(job.tenant, job.dataClass, job.provider, job.task);
    if (refusal) {
      await this.finish(job, refusal, NO_CALL);
      return;
    }
    // Fetched only once the gate admits the job: a refused job never touches the document.
    const reading = await this.read(job, task);
    if (reading.status === 'failed') return;
    const document = reading.status === 'read' ? reading.document : undefined;
    const provider = this.providers.get(job.provider);
    if (!provider) throw new Error(`Job ${jobId}: provider ${job.provider} vanished`);
    if (!this.breaker.tryAcquire(provider.name)) {
      await this.finish(job, { status: 'failed', reason: 'provider-unavailable' }, NO_CALL);
      return;
    }

    let prompt: PreparedPrompt;
    let params: RouteParams;
    try {
      params = parseParams(job.params, `job ${job.id}`);
      // The token map lives in `prompt` for this attempt only, and is never stored or logged.
      prompt = preparePrompt(task, job.promptVersion, job.input, job.model, params, document);
      this.telemetry.identifiersMinimised(job, prompt.counts);
    } catch (error) {
      // No call was made: a probe this attempt claimed must not keep the breaker half-open.
      this.breaker.release(provider.name);
      throw error;
    }
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
    await retryWrite(job.id, deadline, async () => {
      await this.finish(job, outcome, metrics);
    });
  }

  /**
   * The document the job's task reads, fetched and read: `none` for a task that reads none,
   * `failed` once the job has been finished as failed because the document could not be read.
   */
  private async read(job: Job, task: TaskDefinition): Promise<DocumentReading> {
    if (!task.document) return { status: 'none' };
    const ref = task.document(task.input.parse(job.input));
    try {
      return {
        status: 'read',
        document: await readDocument(await this.documents.fetch(ref), ref.contentType),
      };
    } catch (error) {
      if (!(error instanceof DocumentError)) throw error;
      // The kind and message name no content and no link.
      this.logger.warn(
        { jobId: job.id, task: job.task, kind: error.kind, message: error.message },
        'The document the job reads could not be read',
      );
      const reason = error.kind === 'unavailable' ? 'document-unavailable' : 'document-unreadable';
      await this.finish(job, { status: 'failed', reason }, NO_CALL);
      return { status: 'failed' };
    }
  }

  /** Records a job whose execution could not succeed (retries exhausted, permanent error). */
  async fail(jobId: string, reason: JobReason): Promise<void> {
    // Found by id alone (the workflow knows no tenant); finished as its tenant.
    const [job] = await asPlatform(this.db, (tx) =>
      tx.select().from(jobs).where(eq(jobs.id, jobId)),
    );
    if (job) await this.finish(job, { status: 'failed', reason }, NO_CALL);
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

  /**
   * Marks the job running; undefined when it has already ended (a late retry, a replay). In the
   * platform context, since the workflow knows the job by its id alone; everything after runs as
   * the job's tenant.
   */
  private async start(jobId: string): Promise<Job | undefined> {
    const [job] = await asPlatform(this.db, (tx) =>
      tx
        .update(jobs)
        .set({ status: 'running', startedAt: sql`coalesce(${jobs.startedAt}, now())` })
        .where(and(eq(jobs.id, jobId), inArray(jobs.status, LIVE_STATUSES)))
        .returning(),
    );
    return job;
  }

  /**
   * The job's ending for a provider result. Validated twice: the raw output against the task
   * schema and the input's refs, then the output with identifiers restored against the schema
   * again, so what is stored is always valid. Any failure stores nothing (no partial output).
   */
  outcome(
    job: Job,
    task: TaskDefinition,
    result: StructuredResult,
    prompt: Pick<PreparedPrompt, 'restore'>,
  ): Outcome {
    if (result.status === 'refused') return { status: 'failed', reason: 'refused' };
    // A cut-off structured output is absent: nothing valid to keep.
    if (result.status === 'truncated') return { status: 'failed', reason: 'validation' };
    const schema = outputSchemaOf(task, job.input);
    const parsed = schema.safeParse(result.output);
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
    // The ids in a problem are the model's own writing: only how many of each kind are logged.
    const problems = sourceRefProblems(job.input, parsed.data);
    if (problems.length > 0) {
      this.logger.warn(
        { jobId: job.id, task: job.task, problems: problemCounts(problems) },
        'Model output refers to what the input does not hold',
      );
      return { status: 'failed', reason: 'validation' };
    }
    let unminimised: unknown;
    try {
      unminimised = prompt.restore(parsed.data);
    } catch (error) {
      if (!(error instanceof UnknownTokenError)) throw error;
      this.logger.warn(
        { jobId: job.id, task: job.task, unknownTokens: error.unknownTokens },
        'Model output holds identifier tokens the input never had',
      );
      return { status: 'failed', reason: 'validation' };
    }
    const restored = schema.safeParse(unminimised);
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
    const found = task.validate?.(task.input.parse(job.input), restored.data) ?? [];
    if (found.length > 0) {
      const violations = found.slice(0, MAX_STORED_VIOLATIONS);
      this.logger.warn(
        { jobId: job.id, task: job.task, count: found.length, violations },
        'Model output failed the task checks',
      );
      return { status: 'failed', reason: 'validation', violations };
    }
    return { status: 'succeeded', output: { label: this.label(job, task), ...restored.data } };
  }

  /** The label of a job's output: what made it, when, and the task's disclaimer. */
  label(job: Job, task: TaskDefinition): AiLabel {
    return aiLabel(
      {
        task: task.name,
        promptVersion: job.promptVersion,
        provider: job.provider,
        model: job.model,
        generatedAt: new Date().toISOString(),
      },
      inputLanguage(job.input),
      task.disclaimer,
    );
  }

  /**
   * The call's cost at list price. A self-hosted model has none; an external one without a
   * price is a gap in the price table, warned about and counted, and costs 0 until it is added.
   */
  private costOf(job: Job, model: string, usage: Usage): number {
    const cost = costMicros(model, usage);
    if (cost !== undefined) return cost;
    if (this.providers.get(job.provider)?.providerClass === 'external') {
      this.logger.warn(
        { jobId: job.id, provider: job.provider, model },
        'No list price for an external model: the call counts as costing 0',
      );
      this.telemetry.unpricedCall(job.provider, model);
    }
    return 0;
  }

  /**
   * Moves a live job to its final state, with its audit record and event; a job that already
   * ended is left. Counted in telemetry once committed.
   */
  async finish(job: Job, outcome: Outcome, metrics: AttemptMetrics): Promise<Job | undefined> {
    const output = outcome.status === 'succeeded' ? outcome.output : null;
    const finished = await asTenant(this.db, job.tenant, async (tx) => {
      // A hung write (lock wait, lost connection) must fail in time for the caller to react.
      await tx.execute(sql.raw(`set local statement_timeout = ${WRITE_TIMEOUT_MS}`));
      const [row] = await tx
        .update(jobs)
        .set({
          status: outcome.status,
          reason: outcome.status === 'succeeded' ? null : outcome.reason,
          violations: outcome.violations ?? null,
          output,
          outputHash: output && hashJson(output),
          input: null,
          ...(metrics.usage && {
            tokensIn: totalInputTokens(metrics.usage),
            tokensOut: metrics.usage.outputTokens,
            costMicros: this.costOf(job, metrics.model ?? job.model, metrics.usage),
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
    return finished;
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
