import type { components } from './ai-gateway-api.gen.js';

type Schemas = components['schemas'];

/**
 * ai-gateway.yaml `AnswerDeclarantQuestionInput`: what Ask Adili sends. The context the service
 * builds holds no amounts, names, identifiers or descriptions; the question and earlier turns are
 * the declarant's own words, which the gateway minimises before a provider sees them.
 */
export type AnswerInput = Schemas['AnswerDeclarantQuestionInput'];

/** ai-gateway.yaml `AiLabel`, of this task: what an AI-assisted answer is labelled with. */
export type AiLabel = Omit<Schemas['AiLabel'], 'task'> & { task: 'answer-declarant-question' };

/** ai-gateway.yaml `AnswerDeclarantQuestionOutput`: blocks citing the input's passages, or a decline. */
export type AnswerOutput = Omit<Schemas['AnswerDeclarantQuestionOutput'], 'label'> & {
  label: AiLabel;
};

/** ai-gateway.yaml `JobReason`. */
export type AiJobReason = Schemas['JobReason'];

/** ai-gateway.yaml `JobStatus`. */
export type AiJobStatus = Schemas['JobStatus'];

/** ai-gateway.yaml `FeedbackInput`: a rating of a job's output, forwarded as the declarant gave it. */
export type FeedbackInput = Schemas['FeedbackInput'];

/** The task Ask Adili's answers come from. */
export const ANSWER_TASK = 'answer-declarant-question';

/**
 * A streamed answer request (ai-gateway.yaml `TaskRequest` for `streamAnswerDeclarantQuestion`).
 * `tenant` is the Commission the service acts for, sent as `X-Acting-Tenant` (ADR-013 §8.8).
 */
export interface AnswerRequest {
  tenant: string;
  /** `assistant-conversation:<id>`: the job's audit record and events carry it. */
  subjectRef: string;
  input: AnswerInput;
}

/** The job a stream ends with, reduced to what the assistant reads. */
export interface AnswerJob {
  id: string;
  /** The validated output; a streamed answer that failed the gateway's checks is a decline. */
  output: AnswerOutput;
}

/**
 * One server-sent event of the gateway's answer stream (ADR-019): the prose as the model writes
 * it, provisional until the end; then the succeeded job, or why it failed.
 */
export type AnswerFrame =
  | { event: 'delta'; text: string }
  | { event: 'final'; job: AnswerJob }
  | { event: 'error'; reason: AiJobReason };

/**
 * A summary hints job (ai-gateway.yaml `TaskRequest` for `runTask`, a `hints`-mode input of
 * `answer-declarant-question`). `promptVersion` is pinned: it is part of what the hints cache
 * is keyed by.
 */
export interface HintsRequest {
  tenant: string;
  /** `declaration:<id>`: the job's audit record and events carry it. */
  subjectRef: string;
  promptVersion: number;
  input: AnswerInput;
}

/** A hints job as the gateway gives it, reduced to what the service reads. */
export interface HintsJob {
  id: string;
  status: AiJobStatus;
  /** The validated output, once the job succeeded; null before, and when it failed. */
  output: AnswerOutput | null;
}

/** The longest the service waits for a hints job (spec 11: 10 s, then deterministic text only). */
export const HINTS_WAIT_SECONDS = 10;

/**
 * The gateway cannot answer now: unreachable, rate-limited, over budget, no provider, or it
 * answered outside its contract. The assistant answers 503 and the portal offers help search.
 */
export class AiGatewayUnavailable extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AiGatewayUnavailable';
  }
}

/**
 * What the declarations service asks of the ai-gateway's internal API (spec 11, ADR-007, ADR-019):
 * the only component that reaches an AI provider. A Nest token: the service uses
 * `HttpAiGatewayClient`, tests a fake.
 */
export abstract class AiGatewayClient {
  /**
   * `streamAnswerDeclarantQuestion`: opens the stream, throwing `AiGatewayUnavailable` when the
   * gateway does not take it; then its frames, ending with one `final` or `error`. Aborting
   * `signal` (the declarant left) closes the stream, which fails the job as `cancelled`.
   * Idempotent by `idempotencyKey`.
   */
  abstract streamAnswer(
    request: AnswerRequest,
    idempotencyKey: string,
    signal: AbortSignal,
  ): Promise<AsyncIterable<AnswerFrame>>;

  /**
   * `runTask` for a hints input, waiting up to `HINTS_WAIT_SECONDS`: the job as it is once it
   * ended or the wait ran out (queued or running). Idempotent by `idempotencyKey`. Throws
   * `AiGatewayUnavailable` when the gateway does not take it, or refuses it.
   */
  abstract runHints(request: HintsRequest, idempotencyKey: string): Promise<HintsJob>;

  /**
   * `recordFeedback`: records (or replaces) the declarant's rating of the job's output. False
   * when the gateway has no succeeded job with that id of the service's, for the tenant. Throws
   * `AiGatewayUnavailable` when the gateway cannot take it.
   */
  abstract recordFeedback(tenant: string, jobId: string, feedback: FeedbackInput): Promise<boolean>;
}
