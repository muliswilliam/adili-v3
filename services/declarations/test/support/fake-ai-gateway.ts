import { randomUUID } from 'node:crypto';

import {
  type AiJobReason,
  AiGatewayClient,
  AiGatewayUnavailable,
  type AnswerFrame,
  type AnswerInput,
  type AnswerOutput,
  type AnswerRequest,
  type FeedbackInput,
  type ExtractDocumentOutput,
  type ExtractionJob,
  type ExtractionRequest,
  type HintsJob,
  type HintsRequest,
} from '../../src/ai-gateway/ai-gateway-client.js';

/** What the fake answers a request with: the frames' prose and the job's output, or a failure. */
export type ScriptedAnswer =
  | { kind: 'answer'; output: AnswerOutput; deltas?: string[] }
  | { kind: 'error'; reason: AiJobReason; deltas?: string[] }
  /**
   * The deltas, then nothing until the request is aborted (the declarant left), then the final
   * all the same, as one already on its way would arrive.
   */
  | { kind: 'held'; output: AnswerOutput; deltas: string[] }
  | { kind: 'unavailable' };

/** What the fake answers a hints job with. */
export type ScriptedHints =
  | { kind: 'succeeded'; output: AnswerOutput }
  | { kind: 'running' }
  | { kind: 'failed' }
  | { kind: 'unavailable' };

/** By default: one hint per residual, naming its rule and path, linked to it. */
export function writingHints(input: AnswerInput): AnswerOutput {
  return {
    label: answerLabel(),
    declined: false,
    blocks: input.context.residuals.map((residual) => ({
      text: `${input.language === 'sw' ? 'Kidokezo' : 'Hint'}: ${residual.ruleId} at ${residual.fieldPath}`,
      passageIds: [],
      sectionLink: { sectionKey: residual.sectionKey, fieldPath: residual.fieldPath },
    })),
    followUps: [],
  };
}

/** An answer label as the gateway gives it. */
export function answerLabel(): AnswerOutput['label'] {
  return {
    aiAssisted: true,
    task: 'answer-declarant-question',
    promptVersion: 1,
    provider: 'replay',
    model: 'replay-1',
    generatedAt: '2027-11-15T09:00:00.000Z',
    disclaimer: 'AI-assisted guidance from the Act and Regulations, not legal advice.',
  };
}

/** By default: one block citing the first passage the request retrieved, in its language. */
export function citingFirstPassage(input: AnswerInput): AnswerOutput {
  const first = input.passages[0];
  if (!first) return { label: answerLabel(), declined: true, blocks: [], followUps: [] };
  return {
    label: answerLabel(),
    declined: false,
    blocks: [
      {
        text:
          input.language === 'sw'
            ? `Ndiyo, tangaza gari hilo kama mali (${first.citation}).`
            : `Yes, declare the vehicle as an asset (${first.citation}).`,
        passageIds: [first.id],
        sectionLink: null,
      },
    ],
    followUps: [],
  };
}

/** A job as the fake gateway holds it: the request that made it, and where it stands. */
export interface FakeJob extends ExtractionJob {
  tenant: string;
  subjectRef: string;
  request: ExtractionRequest;
}

/** What a reading of a logbook gives, unless a test says otherwise. */
export function logbookReading(
  overrides: Partial<ExtractDocumentOutput> = {},
): ExtractDocumentOutput {
  return {
    label: {
      aiAssisted: true,
      task: 'extract-document',
      promptVersion: 1,
      provider: 'replay',
      model: 'claude-opus-5-5',
      generatedAt: '2026-10-03T08:00:00.000Z',
      disclaimer: 'AI-assisted. Read from your document: check every field before you use it.',
    },
    detectedKind: 'logbook',
    fields: [
      { name: 'details.registration', value: 'KCB 782M', confidence: 0.97, page: 1 },
      { name: 'details.makeModel', value: 'Toyota Premio', confidence: 0.82, page: 1 },
      { name: 'value.kesCents', value: 95_000_000, confidence: 0.41, page: null },
    ],
    warnings: ['Page 2 could not be read.'],
    ...overrides,
  };
}

/**
 * The ai-gateway's answer stream, hints jobs and feedback, in memory: records each request (the
 * input the gateway would see) and answers it with the script set for it, by default an answer
 * citing the first passage and one hint per residual. A rating is recorded for a job it ran.
 *
 * Document readings (spec 05b): an `extract-document` request makes a `queued` job, unless the
 * Commission is `blocked` (its policy keeps highly-confidential data from providers: the job is
 * `blocked`, `policy`), or an equal request (same tenant, subject and input, the link aside) has
 * a live or succeeded job, which is returned instead (the gateway's cache). `finishReading` ends
 * a job as the gateway's queue would; the test then delivers its event. `readingsUnavailable`
 * fails every reading call, `getJobUnavailable` the job read only.
 */
export class FakeAiGateway extends AiGatewayClient {
  /**
   * Each request: what was sent, the signal it was sent with (aborted when the service cancels
   * the job) and whether the service has closed the stream it got.
   */
  readonly requests: {
    request: AnswerRequest;
    idempotencyKey: string;
    signal: AbortSignal;
    closed: boolean;
  }[] = [];
  readonly hintRequests: { request: HintsRequest; idempotencyKey: string }[] = [];
  readonly feedback: { tenant: string; jobId: string; feedback: FeedbackInput }[] = [];
  /** The jobs it ran (answers that ended, hints), by id: what it knows to rate. */
  private readonly jobs = new Set<string>();
  private script: (input: AnswerInput) => ScriptedAnswer = (input) => ({
    kind: 'answer',
    output: citingFirstPassage(input),
  });
  private hintsScript: (input: AnswerInput) => ScriptedHints = (input) => ({
    kind: 'succeeded',
    output: writingHints(input),
  });
  readonly readingRequests: { request: ExtractionRequest; idempotencyKey: string }[] = [];
  readonly readingJobs = new Map<string, FakeJob>();
  readonly blocked = new Set<string>();
  readingsUnavailable = false;
  getJobUnavailable = false;
  private feedbackDown = false;
  private heldFeedback: Promise<void> | null = null;
  private feedbackHook: (() => Promise<void>) | null = null;

  /** Answers every following request with `script`. */
  answer(script: (input: AnswerInput) => ScriptedAnswer): void {
    this.script = script;
  }

  /** The inputs the gateway received, in order. */
  inputs(): AnswerInput[] {
    return this.requests.map(({ request }) => request.input);
  }

  /** Answers every following hints job with `script`. */
  hints(script: (input: AnswerInput) => ScriptedHints): void {
    this.hintsScript = script;
  }

  /** Makes every following rating fail as unreachable (`true`), or be recorded again. */
  feedbackUnavailable(down = true): void {
    this.feedbackDown = down;
  }

  /**
   * Holds the next rating's answer (it is recorded at once) until the returned function is
   * called: a rating still on its way while another lands.
   */
  holdFeedback(): () => void {
    let release = (): void => undefined;
    this.heldFeedback = new Promise((resolve) => {
      release = resolve;
    });
    return release;
  }

  /**
   * Runs `hook` each time a rating is recorded, before the gateway answers: what happens
   * elsewhere while a rating is on its way.
   */
  onFeedback(hook: () => Promise<void>): void {
    this.feedbackHook = hook;
  }

  /** Forgets every job it ran, as a gateway that no longer knows them. */
  forgetJobs(): void {
    this.jobs.clear();
  }

  reset(): void {
    this.requests.length = 0;
    this.hintRequests.length = 0;
    this.feedback.length = 0;
    this.jobs.clear();
    this.feedbackDown = false;
    this.heldFeedback = null;
    this.feedbackHook = null;
    this.answer((input) => ({ kind: 'answer', output: citingFirstPassage(input) }));
    this.hints((input) => ({ kind: 'succeeded', output: writingHints(input) }));
    this.readingRequests.length = 0;
    this.readingJobs.clear();
    this.blocked.clear();
    this.readingsUnavailable = false;
    this.getJobUnavailable = false;
  }

  runHints(request: HintsRequest, idempotencyKey: string): Promise<HintsJob> {
    this.hintRequests.push({ request: structuredClone(request), idempotencyKey });
    const scripted = this.hintsScript(request.input);
    if (scripted.kind === 'unavailable') {
      return Promise.reject(new AiGatewayUnavailable('The ai-gateway service answered 429'));
    }
    const id = randomUUID();
    this.jobs.add(id);
    if (scripted.kind === 'succeeded') {
      return Promise.resolve({ id, status: 'succeeded', output: scripted.output });
    }
    return Promise.resolve({ id, status: scripted.kind, output: null });
  }

  async recordFeedback(tenant: string, jobId: string, feedback: FeedbackInput): Promise<boolean> {
    if (this.feedbackDown) {
      throw new AiGatewayUnavailable('The ai-gateway service did not answer');
    }
    if (!this.jobs.has(jobId)) return false;
    this.feedback.push({ tenant, jobId, feedback: structuredClone(feedback) });
    const held = this.heldFeedback;
    this.heldFeedback = null;
    if (held) await held;
    if (this.feedbackHook) await this.feedbackHook();
    return true;
  }

  extractDocument(request: ExtractionRequest, idempotencyKey: string): Promise<ExtractionJob> {
    if (this.readingsUnavailable) return Promise.reject(new AiGatewayUnavailable('No answer'));
    this.readingRequests.push({ request, idempotencyKey });
    const cached = [...this.readingJobs.values()].find(
      (job) =>
        job.status !== 'failed' &&
        job.status !== 'blocked' &&
        job.tenant === request.tenant &&
        identity(job.request) === identity(request),
    );
    if (cached) return Promise.resolve(view(cached));
    const blocked = this.blocked.has(request.tenant);
    const job: FakeJob = {
      id: randomUUID(),
      tenant: request.tenant,
      subjectRef: request.subjectRef,
      request,
      status: blocked ? 'blocked' : 'queued',
      reason: blocked ? 'policy' : null,
      output: null,
    };
    this.readingJobs.set(job.id, job);
    return Promise.resolve(view(job));
  }

  getJob(tenant: string, jobId: string): Promise<ExtractionJob | null> {
    if (this.readingsUnavailable || this.getJobUnavailable) {
      return Promise.reject(new AiGatewayUnavailable('No answer'));
    }
    const job = this.readingJobs.get(jobId);
    return Promise.resolve(job?.tenant === tenant ? view(job) : null);
  }

  /** The one reading job the gateway has; fails when there is not exactly one. */
  onlyReadingJob(): FakeJob {
    const [job, ...others] = this.readingJobs.values();
    if (!job || others.length > 0)
      throw new Error(`${String(this.readingJobs.size)} jobs, not one`);
    return job;
  }

  /** Ends the job: succeeded with `output` (null: since purged), or failed with `reason`. */
  finishReading(
    jobId: string,
    outcome:
      { output: ExtractDocumentOutput | null } | { reason: NonNullable<ExtractionJob['reason']> },
  ): FakeJob {
    const job = this.readingJobs.get(jobId);
    if (!job) throw new Error(`No job ${jobId}`);
    if ('output' in outcome) {
      Object.assign(job, { status: 'succeeded', reason: null, output: outcome.output });
    } else {
      Object.assign(job, { status: 'failed', reason: outcome.reason, output: null });
    }
    return job;
  }

  streamAnswer(
    request: AnswerRequest,
    idempotencyKey: string,
    signal: AbortSignal,
  ): Promise<AsyncIterable<AnswerFrame>> {
    const sent = { request: structuredClone(request), idempotencyKey, signal, closed: false };
    this.requests.push(sent);
    const scripted = this.script(request.input);
    if (scripted.kind === 'unavailable') {
      return Promise.reject(new AiGatewayUnavailable('The ai-gateway service answered 503'));
    }
    const each =
      scripted.kind === 'held'
        ? held(scripted, signal)
        : arriving(scripted, signal, (id) => this.jobs.add(id));
    return Promise.resolve(
      (async function* () {
        try {
          yield* each;
        } finally {
          sent.closed = true;
        }
      })(),
    );
  }
}

/** The scripted frames, in turns, as over the network. */
async function* arriving(
  scripted: Extract<ScriptedAnswer, { kind: 'answer' | 'error' }>,
  signal: AbortSignal,
  ran: (jobId: string) => void,
): AsyncIterable<AnswerFrame> {
  for (const frame of frames(scripted, signal, ran)) {
    await Promise.resolve();
    yield frame;
  }
}

/** The deltas in turns, then nothing until the request is aborted, then the final all the same. */
async function* held(
  scripted: Extract<ScriptedAnswer, { kind: 'held' }>,
  signal: AbortSignal,
): AsyncIterable<AnswerFrame> {
  for (const text of scripted.deltas) {
    await Promise.resolve();
    yield { event: 'delta', text };
  }
  if (!signal.aborted) {
    await new Promise((resolve) => {
      signal.addEventListener('abort', resolve, { once: true });
    });
  }
  yield { event: 'final', job: { id: randomUUID(), output: scripted.output } };
}

function* frames(
  scripted: Extract<ScriptedAnswer, { kind: 'answer' | 'error' }>,
  signal: AbortSignal,
  ran: (jobId: string) => void,
): Iterable<AnswerFrame> {
  const deltas =
    scripted.deltas ??
    (scripted.kind === 'answer' ? scripted.output.blocks.map((block) => block.text) : []);
  for (const text of deltas) {
    if (signal.aborted) return;
    yield { event: 'delta', text };
  }
  if (signal.aborted) return;
  if (scripted.kind === 'error') {
    yield { event: 'error', reason: scripted.reason };
    return;
  }
  const id = randomUUID();
  ran(id);
  yield { event: 'final', job: { id, output: scripted.output } };
}

function view({ id, status, reason, output }: FakeJob): ExtractionJob {
  return { id, status, reason, output };
}

/** What the gateway's cache keys a request on: everything but the short-lived link. */
function identity({ tenant, subjectRef, input }: ExtractionRequest): string {
  const { contentType, sha256 } = input.attachment;
  return JSON.stringify({
    tenant,
    subjectRef,
    input: { ...input, attachment: { contentType, sha256 } },
  });
}
