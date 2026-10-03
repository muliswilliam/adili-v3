import type { components } from './ai-gateway-api.gen.js';

type Schemas = components['schemas'];

/** ai-gateway.yaml `ExtractDocumentInput`: what the declarant's document is to be read into. */
export type ExtractDocumentInput = Schemas['ExtractDocumentInput'];
/** ai-gateway.yaml `ExtractDocumentOutput`: the fields read, each with a confidence and page. */
export type ExtractDocumentOutput = Schemas['ExtractDocumentOutput'];
/** What the service keeps of a reading: the output less its AI label (the portal labels it). */
export type ExtractionReading = Omit<ExtractDocumentOutput, 'label'>;
/** ai-gateway.yaml `JobStatus` and `JobReason`. */
export type AiJobStatus = Schemas['JobStatus'];
export type AiJobReason = Schemas['JobReason'];

/** The task the declarations service runs (ai-gateway.yaml `TaskName`). */
export const EXTRACT_DOCUMENT = 'extract-document';

/**
 * An extraction job as the gateway gives it (ai-gateway.yaml `Job`), reduced to what the
 * declarations service reads. `output` is present only once the job succeeded: it holds what the
 * document says, so it is stored encrypted and never logged.
 */
export interface ExtractionJob {
  id: string;
  status: AiJobStatus;
  reason: AiJobReason | null;
  output: ExtractionReading | null;
}

/** Whether a job has ended: its output, or why there is none, is final. */
export function isFinished(job: Pick<ExtractionJob, 'status'>): boolean {
  return job.status === 'succeeded' || job.status === 'failed' || job.status === 'blocked';
}

/** An `extract-document` call (ai-gateway.yaml `TaskRequest`) for the Commission `tenant`. */
export interface ExtractionRequest {
  tenant: string;
  /** `declaration:<declarationId>`: the job's events carry it back. */
  subjectRef: string;
  input: ExtractDocumentInput;
}

/**
 * The ai-gateway is unreachable, rate-limited the call, refused it or answered outside its
 * contract: no job is known to have been recorded.
 */
export class AiGatewayUnavailable extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AiGatewayUnavailable';
  }
}

/**
 * What the declarations service asks of the ai-gateway's internal API (spec 05b, ADR-007): the
 * only component that reaches an AI provider. A Nest token: the service uses
 * `HttpAiGatewayClient`, tests a fake.
 */
export abstract class AiGatewayClient {
  /**
   * `runTask` for `extract-document` with data class `highly-confidential`: the job as created
   * (`queued`), `blocked` when the Commission's policy does not let the document go to a provider,
   * or as it is when an equal request has a live or succeeded job (the gateway's cache).
   * Idempotent by `idempotencyKey`. Throws `AiGatewayUnavailable`.
   */
  abstract extractDocument(
    request: ExtractionRequest,
    idempotencyKey: string,
  ): Promise<ExtractionJob>;

  /**
   * `getJob`: the job with its output once succeeded; null when the gateway has no such job of
   * the tenant's. Throws `AiGatewayUnavailable`.
   */
  abstract getJob(tenant: string, jobId: string): Promise<ExtractionJob | null>;
}
