import { setTimeout as sleep } from 'node:timers/promises';

import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ProblemException } from '@adili/api-kit';
import { InjectDatabase } from '@adili/data-access';
import { eq } from 'drizzle-orm';

import { asTenant, type GatewayDatabase } from '../db/context.js';
import { type Job, jobs } from '../db/schema.js';
import { CircuitBreaker } from '../policy/circuit-breaker.js';
import { UnknownTokenError } from '../policy/minimisation.js';
import { type PreparedPrompt, preparePrompt, streamedRequest } from '../policy/prompt.js';
import { GenAiTelemetry } from '../policy/telemetry.js';
import {
  type GenerateRequest,
  type GenerateResult,
  type ModelProvider,
  ProviderError,
  type StreamEvent,
  type Usage,
} from '../providers/port.js';
import { ProviderRegistry } from '../providers/providers.module.js';
import {
  type AnswerOutput,
  answerDeclarantQuestion,
  DECLINED_ANSWER,
} from '../tasks/answer-declarant-question.js';
import { answerProse, type ReadAnswer, TaggedAnswerReader } from '../tasks/tagged-answer.js';
import type { OutputViolation } from '../tasks/task.js';
import {
  type AttemptMetrics,
  JobExecutor,
  MAX_STORED_VIOLATIONS,
  NO_CALL,
  type Outcome,
} from './job-executor.js';
import { isTerminal, type JobReason } from './job-states.js';
import { toJobView, type JobView } from './job-view.js';
import { GRACE_SECONDS } from './jobs-janitor.js';
import { JobsService } from './jobs.service.js';
import { parseParams } from './routing.js';
import { requireEndpoint, type TaskCaller, taskRequestSchema } from './task-request.js';

/** One server-sent event of an answer stream. */
export type StreamFrame =
  | { event: 'delta'; data: { text: string } }
  | { event: 'final'; data: { job: JobView } }
  | { event: 'error'; data: { reason: JobReason } };

/** An opened answer stream: its frames, read until the caller goes away (`signal`). */
export interface AnswerStream {
  frames(signal: AbortSignal): AsyncGenerator<StreamFrame>;
}

/**
 * Longest a stream may run. It has no workflow, so it must end before the janitor's grace window
 * passes and the janitor fails it as abandoned (which it is, if this process died).
 */
const STREAM_DEADLINE_MS = (GRACE_SECONDS - 15) * 1000;
/** Provider calls per stream: retries happen only before anything has streamed. */
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 500;

const task = answerDeclarantQuestion;

/** The caller went away: the job ends, and nothing more is sent. */
class CallerGone extends Error {
  override readonly name = 'CallerGone';
}

/** One stream's provider call, as every attempt makes it. */
interface StreamCall {
  job: Job;
  provider: ModelProvider;
  prompt: PreparedPrompt;
  request: GenerateRequest;
  /** The caller's: aborted when it disconnects. */
  signal: AbortSignal;
  deadline: AbortSignal;
  startedAt: number;
}

/** How an attempt ended: the job's outcome, the caller gone, or another attempt to make. */
type Attempted =
  | { kind: 'ended'; outcome: Outcome; metrics: AttemptMetrics }
  | { kind: 'gone'; metrics: AttemptMetrics }
  | { kind: 'retry' };

/**
 * Ask Adili's streamed answers (ADR-019): an `answer`-mode `answer-declarant-question` job created
 * and run in the request, its blocks' prose sent as text deltas while the model writes, then the
 * job itself once its output is validated. The same policy as a job: idempotency key, cache, rate
 * limit, classification gate, budget and breaker; the input minimised and wrapped as untrusted;
 * every ending recorded with its audit and event.
 *
 * An answer that fails its checks (the grammar, its schema, the task's own checks) is replaced by
 * a decline, and the job succeeds with the violations recorded: the caller shows its decline text,
 * and the deltas it already showed are provisional until the final frame. Such a decline is not
 * cached (`servesCache`): an equal request calls the provider again.
 */
@Injectable()
export class AnswerStreams {
  private readonly logger = new Logger(AnswerStreams.name);

  constructor(
    @InjectDatabase() private readonly db: GatewayDatabase,
    private readonly jobs: JobsService,
    private readonly executor: JobExecutor,
    private readonly providers: ProviderRegistry,
    private readonly breaker: CircuitBreaker,
    private readonly telemetry: GenAiTelemetry,
  ) {}

  /**
   * Checks and records the request, before anything is sent: throws the problem to answer with
   * (validation, a reused or running key, rate limit, gate, budget). A finished key or an equal
   * succeeded request replays as frames without a provider call.
   */
  async open(body: unknown, caller: TaskCaller): Promise<AnswerStream> {
    const request = taskRequestSchema(task).parse(body);
    requireEndpoint(task, request, 'stream');
    const { kind, job } = await this.jobs.findOrCreate(task, request, caller, 'running');
    if (kind !== 'created') return replay(job, kind === 'cached');
    if (isTerminal(job.status)) throw refused(job);
    return { frames: (signal) => this.run(job, signal) };
  }

  /** Calls the provider and streams; every ending is recorded and ends the frames. */
  private async *run(job: Job, signal: AbortSignal): AsyncGenerator<StreamFrame> {
    // Gone before the call: it would be paid for and its answer never read.
    if (signal.aborted) {
      await this.cancel(job, NO_CALL);
      return;
    }
    const provider = this.providers.get(job.provider);
    if (!provider || !this.breaker.tryAcquire(provider.name)) {
      yield* this.end(job, { status: 'failed', reason: 'provider-unavailable' }, NO_CALL);
      return;
    }
    const prompt = preparePrompt(
      task,
      job.promptVersion,
      job.input,
      job.model,
      parseParams(job.params, `job ${job.id}`),
    );
    this.telemetry.identifiersMinimised(job, prompt.counts);
    const call: StreamCall = {
      job,
      provider,
      prompt,
      request: streamedRequest(prompt.request),
      signal,
      deadline: AbortSignal.timeout(STREAM_DEADLINE_MS),
      startedAt: performance.now(),
    };
    for (let attempt = 1; ; attempt++) {
      const attempted = yield* this.attempt(call, attempt);
      if (attempted.kind === 'retry') continue;
      if (attempted.kind === 'gone') await this.cancel(job, attempted.metrics);
      else yield* this.end(job, attempted.outcome, attempted.metrics);
      return;
    }
  }

  /**
   * One provider call: its prose streamed as it arrives, then how it ended. A transient failure
   * before anything has streamed asks for another attempt, after a backoff the caller may cut short.
   */
  private async *attempt(
    { job, provider, prompt, request, signal, deadline, startedAt }: StreamCall,
    attempt: number,
  ): AsyncGenerator<StreamFrame, Attempted> {
    const metrics = (result?: GenerateResult): AttemptMetrics => ({
      usage: result?.usage ?? null,
      model: result?.model ?? null,
      latencyMs: Math.round(performance.now() - startedAt),
    });
    const reader = new TaggedAnswerReader();
    let streamed = false;
    /** Characters the provider sent this attempt, for `estimated`. */
    let received = 0;
    // An attempt that ends without the final result has no usage: it is charged an estimate.
    const estimated = (): AttemptMetrics => ({
      ...metrics(),
      usage: estimatedUsage(request, received),
    });
    const span = this.telemetry.begin({
      jobId: job.id,
      tenant: job.tenant,
      task: job.task,
      promptVersion: job.promptVersion,
      provider: provider.name,
      model: job.model,
      maxOutputTokens: request.maxOutputTokens,
    });
    let result: GenerateResult | undefined;
    try {
      for await (const event of until(provider, request, signal, deadline)) {
        if (event.type === 'final') {
          result = event.result;
          continue;
        }
        received += event.text.length;
        const text = reader.push(event.text);
        if (text === '') continue;
        streamed = true;
        yield { event: 'delta', data: { text: prompt.restore(text) } };
      }
      if (!result) throw new ProviderError('invalid-response', provider.name, 'No final event');
    } catch (error) {
      span.failed(error);
      // The caller leaving or a token the input never had says nothing of the provider's health:
      // a half-open probe is given back, as for a job that made no call.
      if (error instanceof CallerGone) {
        this.breaker.release(provider.name);
        return { kind: 'gone', metrics: estimated() };
      }
      if (error instanceof UnknownTokenError) {
        this.breaker.release(provider.name);
        return { kind: 'ended', outcome: this.unknownToken(job, error), metrics: estimated() };
      }
      const retryable = error instanceof ProviderError && error.retryable;
      if (retryable) this.breaker.recordFailure(provider.name);
      else this.breaker.release(provider.name);
      if (retryable && !streamed && attempt < MAX_ATTEMPTS && !deadline.aborted) {
        try {
          await sleep(RETRY_DELAY_MS * attempt, undefined, { signal });
        } catch {
          return { kind: 'gone', metrics: estimated() };
        }
        if (this.breaker.tryAcquire(provider.name)) return { kind: 'retry' };
      }
      if (!(error instanceof ProviderError)) {
        this.logger.error({ err: error, jobId: job.id }, 'Stream failed');
      }
      const reason: JobReason =
        error instanceof ProviderError && error.kind === 'timeout' ? 'timeout' : 'provider';
      return {
        kind: 'ended',
        outcome: { status: 'failed', reason },
        metrics: received > 0 ? estimated() : metrics(),
      };
    }
    span.succeeded(result);
    this.breaker.recordSuccess(provider.name);
    if (result.status === 'refused') {
      return {
        kind: 'ended',
        outcome: { status: 'failed', reason: 'refused' },
        metrics: metrics(result),
      };
    }
    const { delta, answer } = reader.end(result.status);
    let last: string;
    try {
      last = delta === '' ? '' : prompt.restore(delta);
    } catch (error) {
      if (!(error instanceof UnknownTokenError)) throw error;
      return { kind: 'ended', outcome: this.unknownToken(job, error), metrics: metrics(result) };
    }
    if (last !== '') yield { event: 'delta', data: { text: last } };
    return {
      kind: 'ended',
      outcome: this.judge(job, answer, result, prompt),
      metrics: metrics(result),
    };
  }

  /** The job's ending for a read answer: validated as a job's output, else a decline. */
  private judge(
    job: Job,
    answer: ReadAnswer,
    result: GenerateResult,
    prompt: Pick<PreparedPrompt, 'restore'>,
  ): Outcome {
    if (!answer.ok) return this.decline(job, answer.problems);
    const outcome = this.executor.outcome(
      job,
      task,
      { status: 'completed', output: answer.answer, model: result.model, usage: result.usage },
      prompt,
    );
    if (outcome.status === 'succeeded') return outcome;
    return this.decline(job, outcome.violations ?? [{ kind: 'invalid-output' }]);
  }

  /** Streamed text holding a token the input never had: a failed check, so a decline. */
  private unknownToken(job: Job, error: UnknownTokenError): Outcome {
    this.logger.warn(
      { jobId: job.id, unknownTokens: error.unknownTokens },
      'Streamed text holds identifier tokens the input never had',
    );
    return this.decline(job, [{ kind: 'unknown-token' }]);
  }

  private decline(job: Job, found: OutputViolation[]): Outcome {
    const violations = found.slice(0, MAX_STORED_VIOLATIONS);
    this.logger.warn(
      { jobId: job.id, task: job.task, count: found.length, violations },
      'Streamed answer failed its checks; declined',
    );
    return {
      status: 'succeeded',
      output: { label: this.executor.label(job, task), ...DECLINED_ANSWER },
      violations,
    };
  }

  /** The caller went away: the job fails, and nothing is sent. */
  private async cancel(job: Job, metrics: AttemptMetrics): Promise<void> {
    this.logger.log({ jobId: job.id }, 'The caller left; failing the job');
    await this.executor.finish(job, { status: 'failed', reason: 'cancelled' }, metrics);
  }

  /** Records the ending and sends it: the job, or the reason it failed. */
  private async *end(
    job: Job,
    outcome: Outcome,
    metrics: AttemptMetrics,
  ): AsyncGenerator<StreamFrame> {
    const finished = await this.executor.finish(job, outcome, metrics);
    // Already ended elsewhere (the janitor took it for abandoned): report what it is now.
    const [row] = finished
      ? [finished]
      : await asTenant(this.db, job.tenant, (tx) =>
          tx.select().from(jobs).where(eq(jobs.id, job.id)),
        );
    if (row?.status === 'succeeded') yield { event: 'final', data: { job: toJobView(row) } };
    else yield { event: 'error', data: { reason: row?.reason ?? 'provider' } };
  }
}

/**
 * The provider's events until it ends, the caller leaves (`CallerGone`) or the deadline passes (a
 * retryable timeout); an abandoned stream is closed so the provider call stops.
 */
async function* until(
  provider: ModelProvider,
  request: GenerateRequest,
  caller: AbortSignal,
  deadline: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const iterator = provider.stream(request)[Symbol.asyncIterator]();
  const stopped = new Promise<never>((_, reject) => {
    const stop = () => {
      reject(
        caller.aborted
          ? new CallerGone()
          : new ProviderError('timeout', provider.name, `Stream ran past ${STREAM_DEADLINE_MS} ms`),
      );
    };
    if (caller.aborted || deadline.aborted) stop();
    caller.addEventListener('abort', stop, { once: true });
    deadline.addEventListener('abort', stop, { once: true });
  });
  // Rejections after the stream has ended are nobody's concern.
  stopped.catch(() => undefined);
  let done = false;
  try {
    for (;;) {
      const next = await Promise.race([iterator.next(), stopped]);
      if (next.done) {
        done = true;
        return;
      }
      yield next.value;
    }
  } finally {
    if (!done) void Promise.resolve(iterator.return?.()).catch(() => undefined);
  }
}

/**
 * Characters per token of an estimate: fewer than the ~4 of English prose, so that Swahili, JSON
 * and markup are not undercounted and an estimate leans high.
 */
const ESTIMATE_CHARS_PER_TOKEN = 3;

/**
 * An estimate of what a call that ended without its final result cost, since the port reports
 * usage only with that result: the whole request as uncached input, and the text received as
 * output (thinking the provider never sent is not counted). Priced like real usage, it keeps a
 * stream the caller left, or that failed midway, in the tenant's budget; never zero, as the
 * request is never empty.
 */
function estimatedUsage(request: GenerateRequest, received: number): Usage {
  const sent = [
    request.system ?? '',
    ...request.messages.flatMap((message) =>
      typeof message.content === 'string'
        ? [message.content]
        : message.content.map((part) => (part.type === 'text' ? part.text : part.attachment.data)),
    ),
  ].reduce((total, text) => total + text.length, 0);
  return {
    inputTokens: Math.ceil(sent / ESTIMATE_CHARS_PER_TOKEN),
    outputTokens: Math.ceil(received / ESTIMATE_CHARS_PER_TOKEN),
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
}

/** Frames for a job that already exists: its ending, or 409 while it still runs. */
function replay(job: Job, cached: boolean): AnswerStream {
  if (!isTerminal(job.status)) {
    throw new ProblemException({
      type: 'job-in-progress',
      title: 'Job in progress',
      status: HttpStatus.CONFLICT,
      detail: cached
        ? 'An equal request is streaming now; retry once it has ended to be served from the cache.'
        : 'This Idempotency-Key names a stream that is still running.',
    });
  }
  return {
    // eslint-disable-next-line @typescript-eslint/require-await -- frames are already known
    async *frames() {
      const view = toJobView(job);
      if (job.status !== 'succeeded') {
        yield { event: 'error', data: { reason: job.reason ?? 'provider' } };
        return;
      }
      // A stored output is the task's, validated when the job succeeded.
      const text = cached ? answerProse(view.output as AnswerOutput) : '';
      if (text !== '') yield { event: 'delta', data: { text } };
      yield { event: 'final', data: { job: view } };
    },
  };
}

/** The problem for a job ended before any provider call: gate, budget, or no provider. */
function refused(job: Job): ProblemException {
  const reason = job.reason ?? 'provider-unavailable';
  const status =
    reason === 'policy'
      ? HttpStatus.FORBIDDEN
      : reason === 'budget'
        ? HttpStatus.TOO_MANY_REQUESTS
        : HttpStatus.SERVICE_UNAVAILABLE;
  return new ProblemException(
    {
      type: 'task-blocked',
      title: 'Task blocked',
      status,
      detail: `Job ${job.id} ended before any provider call (${reason}).`,
    },
    { reason, jobId: job.id },
  );
}
