/**
 * The vendor-agnostic provider port (ADR-007). Everything above this seam (jobs, policy, tasks)
 * speaks these neutral types; adapters translate them to one vendor's API. No vendor type may
 * appear in this module or be re-exported through it.
 */

export type JsonSchema = Record<string, unknown>;

export type AttachmentKind = 'image' | 'pdf' | 'text';

/** A file sent to the model inline. `data` is base64 for images and PDFs, plain UTF-8 for text. */
export interface Attachment {
  kind: AttachmentKind;
  mediaType: string;
  data: string;
  /** Shown to the model as the document title where the vendor supports it. */
  name?: string;
}

export type ContentPart =
  { type: 'text'; text: string } | { type: 'attachment'; attachment: Attachment };

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string | ContentPart[];
}

export type Effort = 'low' | 'medium' | 'high';

export interface GenerateRequest {
  /** Vendor model id, decided by the routing table, never by the caller. */
  model: string;
  /** Stable instructions; adapters that support prompt caching cache it. */
  system?: string;
  messages: ChatMessage[];
  maxOutputTokens: number;
  effort?: Effort;
}

export interface StructuredRequest extends GenerateRequest {
  /** JSON Schema the output must conform to. */
  schema: JsonSchema;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  /** Input tokens served from the provider's prompt cache. */
  cacheReadTokens: number;
  /** Input tokens written to the provider's prompt cache. */
  cacheWriteTokens: number;
}

interface ResultBase {
  /** Model that actually served the request. */
  model: string;
  usage: Usage;
}

/**
 * - `completed`: the model finished normally.
 * - `truncated`: the output limit was reached; the output is partial (text) or absent (structured).
 * - `refused`: the model declined; no output.
 */
export type GenerateResult = ResultBase &
  (
    | { status: 'completed'; text: string }
    | { status: 'truncated'; text: string }
    | { status: 'refused'; refusal: Refusal }
  );

export type StructuredResult = ResultBase &
  (
    | { status: 'completed'; output: unknown }
    | { status: 'truncated' }
    | { status: 'refused'; refusal: Refusal }
  );

export interface Refusal {
  category: string | null;
  explanation: string | null;
}

export type StreamEvent =
  { type: 'delta'; text: string } | { type: 'final'; result: GenerateResult };

export interface BatchItem {
  /** Caller-chosen id, unique within the batch; results are keyed by it. */
  customId: string;
  request: StructuredRequest;
}

export type BatchItemOutcome =
  { customId: string; result: StructuredResult } | { customId: string; error: ProviderErrorKind };

export type BatchStatus =
  | { batchId: string; status: 'processing' }
  | { batchId: string; status: 'ended'; outcomes: BatchItemOutcome[] };

export interface ProviderCapabilities {
  structuredOutput: boolean;
  streaming: boolean;
  batch: boolean;
  promptCaching: boolean;
  attachments: readonly AttachmentKind[];
}

export interface ModelProvider {
  /** Provider id recorded on jobs (`anthropic`, `replay`...). */
  readonly name: string;
  readonly capabilities: ProviderCapabilities;
  generate(request: GenerateRequest): Promise<GenerateResult>;
  generateStructured(request: StructuredRequest): Promise<StructuredResult>;
  /** Text deltas, then exactly one `final` event. */
  stream(request: GenerateRequest): AsyncIterable<StreamEvent>;
  submitBatch(items: BatchItem[]): Promise<{ batchId: string }>;
  pollBatch(batchId: string): Promise<BatchStatus>;
}

/**
 * - `timeout`, `rate-limited`, `unavailable`: transient, safe to retry.
 * - `bad-request`: the request is wrong for this provider or model; retrying will not help.
 * - `auth`: credentials missing, invalid or not permitted.
 * - `invalid-response`: the provider answered with something the adapter cannot interpret.
 * - `cancelled`: the caller aborted the request; not retried.
 * - `internal`: an unexpected failure outside the provider's client, such as an adapter bug.
 */
export type ProviderErrorKind =
  | 'timeout'
  | 'rate-limited'
  | 'unavailable'
  | 'bad-request'
  | 'auth'
  | 'invalid-response'
  | 'cancelled'
  | 'internal';

const RETRYABLE: ReadonlySet<ProviderErrorKind> = new Set([
  'timeout',
  'rate-limited',
  'unavailable',
]);

/** Every adapter failure surfaces as this; messages never contain prompt or output content. */
export class ProviderError extends Error {
  override readonly name = 'ProviderError';
  readonly retryable: boolean;
  /** From the provider's `retry-after` header when rate limited. */
  readonly retryAfterSeconds: number | undefined;

  constructor(
    readonly kind: ProviderErrorKind,
    readonly provider: string,
    message: string,
    options: { retryAfterSeconds?: number; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.retryable = RETRYABLE.has(kind);
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}
