import type { components } from './ai-gateway-api.gen.js';

type Schemas = components['schemas'];

/** ai-gateway.yaml `SummarizeDeclarationInput`. */
export type SummarizeDeclarationInput = Schemas['SummarizeDeclarationInput'];
/** ai-gateway.yaml `ExplainFlagsInput`. */
export type ExplainFlagsInput = Schemas['ExplainFlagsInput'];
/** ai-gateway.yaml `FlagInput`. */
export type FlagInput = Schemas['FlagInput'];
/** ai-gateway.yaml `ChangeInput`. */
export type ChangeInput = Schemas['ChangeInput'];
/** ai-gateway.yaml `SourceRef`. */
export type SourceRef = Schemas['SourceRef'];

/** The tasks the review service runs (ai-gateway.yaml `TaskName`). */
export type ReviewTask = 'summarize-declaration' | 'explain-flags';

/** ai-gateway.yaml `DataClass`: how sensitive the input is; the gateway's gate decides who may see it. */
export type DataClass = Schemas['DataClass'];

/** ai-gateway.yaml `JobStatus` and `JobReason`. */
export type AiJobStatus = Schemas['JobStatus'];
export type AiJobReason = Schemas['JobReason'];

/** ai-gateway.yaml `TenantAiStatus`: the tenant's routed provider class and what it may see. */
export type TenantAiStatus = Schemas['TenantAiStatus'];

/** The inputs of the tasks the review service runs. */
export type ReviewTaskInput = SummarizeDeclarationInput | ExplainFlagsInput;

/** A task call (ai-gateway.yaml `TaskRequest`), narrowed to the inputs the review service sends. */
export interface TaskRequest {
  tenant: string;
  dataClass: DataClass;
  /** `review-case:<caseId>`: the events of the job carry it back. */
  subjectRef: string;
  input: ReviewTaskInput;
}

/**
 * A job as the gateway gives it (ai-gateway.yaml `Job`), reduced to what the review service reads.
 * `output` is the validated task output, present only once the job succeeded; it holds declaration
 * content and is stored encrypted, never logged.
 */
export interface AiJob {
  id: string;
  task: string;
  subjectRef: string;
  status: AiJobStatus;
  reason: AiJobReason | null;
  promptVersion: number;
  output: Record<string, unknown> | null;
  finishedAt: string | null;
}

/** Whether a job has ended: its output, or why there is none, is final. */
export function isFinished(job: Pick<AiJob, 'status'>): boolean {
  return job.status === 'succeeded' || job.status === 'failed' || job.status === 'blocked';
}

/**
 * The ai-gateway is unreachable, rate-limited the call or answered outside its contract: no job
 * was recorded as requested. Activities retry with backoff; requests answer 503.
 */
export class AiGatewayUnavailable extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AiGatewayUnavailable';
  }
}

/**
 * What the review service asks of the ai-gateway's internal API (spec 07c, ADR-007): the only
 * component that reaches an AI provider. A Nest token: the service uses `HttpAiGatewayClient`,
 * tests a fake.
 */
export abstract class AiGatewayClient {
  /**
   * `runTask` with no wait: the job as created (queued), or as it is when the request was already
   * answered (a replay of the key, or a cached result). Idempotent by `idempotencyKey`. Throws
   * `AiGatewayUnavailable` when the gateway cannot take it and `InternalApiRejected` when it
   * refuses the request.
   */
  abstract runTask(task: ReviewTask, request: TaskRequest, idempotencyKey: string): Promise<AiJob>;

  /** `getJob`: the job with its output once succeeded; null when the gateway has no such job. */
  abstract getJob(jobId: string): Promise<AiJob | null>;

  /** `getTenantAiStatus`: whether AI assistance is enabled for the tenant, and for which data. */
  abstract tenantStatus(tenant: string): Promise<TenantAiStatus>;
}
