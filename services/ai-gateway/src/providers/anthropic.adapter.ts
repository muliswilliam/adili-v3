import Anthropic from '@anthropic-ai/sdk';
import { transformJSONSchema } from '@anthropic-ai/sdk/lib/transform-json-schema';

import { pdfToPageImages } from './pdf-pages.js';
import {
  type Attachment,
  type AttachmentKind,
  type BatchItem,
  type BatchItemOutcome,
  type BatchStatus,
  type ChatMessage,
  type ContentPart,
  type GenerateRequest,
  type GenerateResult,
  type ModelProvider,
  type ProviderCapabilities,
  ProviderError,
  type ProviderErrorKind,
  type Refusal,
  type StreamEvent,
  type StructuredRequest,
  type StructuredResult,
  type Usage,
} from './port.js';

const PROVIDER = 'anthropic';

/**
 * How structured output is obtained. `native` sends the schema as `output_config.format`, which
 * the API enforces. `prompted` is for Anthropic-compatible gateways that drop that field: the
 * schema goes into the system prompt and a single fenced JSON answer is accepted. The job
 * validates the output against the task schema either way.
 */
export type StructuredOutputMode = 'native' | 'prompted';

export interface AnthropicAdapterOptions {
  /** A configured SDK client; tests pass one with an in-process `fetch`. */
  client: Anthropic;
  /** Defaults to `native`. */
  structuredOutput?: StructuredOutputMode;
  /**
   * What the endpoint takes inline; defaults to the API's image, PDF and text. Without `pdf` (a
   * gateway that drops `document` blocks), each PDF goes as one image per page.
   */
  attachments?: readonly AttachmentKind[];
}

/** What the Anthropic API takes inline. */
export const ANTHROPIC_ATTACHMENTS: readonly AttachmentKind[] = ['image', 'pdf', 'text'];

/** Adapter over the official Anthropic SDK. Vendor types stay inside this file. */
export class AnthropicAdapter implements ModelProvider {
  readonly name = PROVIDER;
  readonly providerClass = 'external';
  readonly capabilities: ProviderCapabilities;
  private readonly client: Anthropic;
  private readonly mode: StructuredOutputMode;

  constructor(options: AnthropicAdapterOptions) {
    this.client = options.client;
    this.mode = options.structuredOutput ?? 'native';
    this.capabilities = {
      structuredOutput: true,
      streaming: true,
      batch: true,
      promptCaching: true,
      attachments: options.attachments ?? ANTHROPIC_ATTACHMENTS,
    };
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const prepared = await this.prepare(request);
    const response = await this.call(() =>
      this.client.messages.create(toParams(prepared, this.mode)),
    );
    return toGenerateResult(response);
  }

  async generateStructured(request: StructuredRequest): Promise<StructuredResult> {
    const prepared = await this.prepare(request);
    const response = await this.call(() =>
      this.client.messages.create(toParams(prepared, this.mode)),
    );
    return toStructuredResult(response, this.mode);
  }

  async *stream(request: GenerateRequest): AsyncIterable<StreamEvent> {
    const prepared = await this.prepare(request);
    try {
      const stream = this.client.messages.stream(toParams(prepared, this.mode));
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield { type: 'delta', text: event.delta.text };
        }
      }
      yield { type: 'final', result: toGenerateResult(await stream.finalMessage()) };
    } catch (error) {
      throw toProviderError(error);
    }
  }

  async submitBatch(items: BatchItem[]): Promise<{ batchId: string }> {
    const requests = await Promise.all(
      items.map(async (item) => ({
        custom_id: item.customId,
        params: toParams(await this.prepare(item.request), this.mode),
      })),
    );
    const batch = await this.call(() => this.client.messages.batches.create({ requests }));
    return { batchId: batch.id };
  }

  async pollBatch(batchId: string): Promise<BatchStatus> {
    const batch = await this.call(() => this.client.messages.batches.retrieve(batchId));
    if (batch.processing_status !== 'ended') {
      return { batchId, status: 'processing' };
    }
    const outcomes = await this.call(async () => {
      const all: BatchItemOutcome[] = [];
      for await (const entry of await this.client.messages.batches.results(batchId)) {
        all.push(toBatchOutcome(entry, this.mode));
      }
      return all;
    });
    return { batchId, status: 'ended', outcomes };
  }

  /**
   * The request as this endpoint can take it: PDFs as page images when it takes no PDFs. The
   * request the caller built (and a replay recording's key) is left as it is.
   */
  private async prepare<T extends GenerateRequest | StructuredRequest>(request: T): Promise<T> {
    if (this.capabilities.attachments.includes('pdf')) return request;
    const messages = await Promise.all(request.messages.map((message) => pdfsAsImages(message)));
    return { ...request, messages };
  }

  private async call<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      throw toProviderError(error);
    }
  }
}

function toParams(
  request: GenerateRequest | StructuredRequest,
  mode: StructuredOutputMode,
): Anthropic.MessageCreateParamsNonStreaming {
  const outputConfig: Anthropic.OutputConfig = {};
  const prompted = 'schema' in request && mode === 'prompted';
  if ('schema' in request && !prompted) {
    // Structured outputs enforce a subset of JSON Schema; the SDK moves the rest (length and
    // count limits, unsupported formats) into descriptions. The job validates them afterwards.
    outputConfig.format = { type: 'json_schema', schema: transformJSONSchema(request.schema) };
  }
  if (request.effort) {
    outputConfig.effort = request.effort;
  }
  const system = prompted
    ? [request.system, schemaInstruction(request.schema)].filter(Boolean).join('\n\n')
    : request.system;
  return {
    model: request.model,
    max_tokens: request.maxOutputTokens,
    // The system prompt is the stable prefix shared by every job of a task version; cache it.
    ...(system !== undefined && {
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    }),
    messages: request.messages.map(toMessageParam),
    ...(Object.keys(outputConfig).length > 0 && { output_config: outputConfig }),
  };
}

/** Prompted structured output: the schema the API would otherwise enforce, stated as a rule. */
function schemaInstruction(schema: StructuredRequest['schema']): string {
  return [
    'Reply with exactly one JSON object that conforms to this JSON Schema, and nothing else:',
    JSON.stringify(schema),
  ].join('\n');
}

/** A whole answer in one Markdown code fence, as models write JSON when nothing enforces it. */
const FENCED = /^\s*```(?:json)?\s*\n([\s\S]*?)\n?```\s*$/;

async function pdfsAsImages(message: ChatMessage): Promise<ChatMessage> {
  if (typeof message.content === 'string') return message;
  const parts = await Promise.all(
    message.content.map(async (part): Promise<ContentPart[]> => {
      if (part.type !== 'attachment' || part.attachment.kind !== 'pdf') return [part];
      try {
        const pages = await pdfToPageImages(part.attachment);
        // Image blocks carry no title: name the document in the text before its pages.
        const { name } = part.attachment;
        const heading: ContentPart[] =
          name === undefined
            ? []
            : [{ type: 'text', text: `${name}: ${pages.length} page image(s), in order.` }];
        return [
          ...heading,
          ...pages.map((attachment) => ({ type: 'attachment' as const, attachment })),
        ];
      } catch (error) {
        throw new ProviderError('bad-request', PROVIDER, 'The PDF cannot be sent as page images', {
          cause: error,
        });
      }
    }),
  );
  return { ...message, content: parts.flat() };
}

function toMessageParam(message: ChatMessage): Anthropic.MessageParam {
  if (typeof message.content === 'string') {
    return { role: message.role, content: message.content };
  }
  return {
    role: message.role,
    content: message.content.map((part): Anthropic.ContentBlockParam =>
      part.type === 'text' ? { type: 'text', text: part.text } : toAttachmentBlock(part.attachment),
    ),
  };
}

function toAttachmentBlock(
  attachment: Attachment,
): Anthropic.ImageBlockParam | Anthropic.DocumentBlockParam {
  const title = attachment.name === undefined ? {} : { title: attachment.name };
  switch (attachment.kind) {
    case 'image':
      return {
        type: 'image',
        source: {
          type: 'base64',
          media_type: attachment.mediaType as Anthropic.Base64ImageSource['media_type'],
          data: attachment.data,
        },
      };
    case 'pdf':
      return {
        type: 'document',
        ...title,
        source: { type: 'base64', media_type: 'application/pdf', data: attachment.data },
      };
    case 'text':
      return {
        type: 'document',
        ...title,
        source: { type: 'text', media_type: 'text/plain', data: attachment.data },
      };
  }
}

function toUsage(usage: Anthropic.Usage): Usage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
  };
}

function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

function refusalOf(message: Anthropic.Message): Refusal {
  return {
    category: message.stop_details?.category ?? null,
    explanation: message.stop_details?.explanation ?? null,
  };
}

function isTruncated(message: Anthropic.Message): boolean {
  return (
    message.stop_reason === 'max_tokens' || message.stop_reason === 'model_context_window_exceeded'
  );
}

function toGenerateResult(message: Anthropic.Message): GenerateResult {
  const base = { model: message.model, usage: toUsage(message.usage) };
  if (message.stop_reason === 'refusal') {
    return { ...base, status: 'refused', refusal: refusalOf(message) };
  }
  return {
    ...base,
    status: isTruncated(message) ? 'truncated' : 'completed',
    text: textOf(message),
  };
}

function toStructuredResult(
  message: Anthropic.Message,
  mode: StructuredOutputMode,
): StructuredResult {
  const base = { model: message.model, usage: toUsage(message.usage) };
  if (message.stop_reason === 'refusal') {
    return { ...base, status: 'refused', refusal: refusalOf(message) };
  }
  if (isTruncated(message)) {
    return { ...base, status: 'truncated' };
  }
  const text = textOf(message);
  const json = mode === 'prompted' ? (FENCED.exec(text)?.[1] ?? text) : text;
  try {
    return { ...base, status: 'completed', output: JSON.parse(json) as unknown };
  } catch (error) {
    throw new ProviderError('invalid-response', PROVIDER, 'Structured output is not valid JSON', {
      cause: error,
    });
  }
}

function toBatchOutcome(
  entry: Anthropic.Messages.MessageBatchIndividualResponse,
  mode: StructuredOutputMode,
): BatchItemOutcome {
  const customId = entry.custom_id;
  switch (entry.result.type) {
    case 'succeeded':
      try {
        return { customId, result: toStructuredResult(entry.result.message, mode) };
      } catch (error) {
        return { customId, error: toProviderError(error).kind };
      }
    case 'errored':
      return { customId, error: errorTypeKind(entry.result.error.error.type) };
    case 'expired':
      return { customId, error: 'timeout' };
    case 'canceled':
      return { customId, error: 'unavailable' };
  }
}

/** Maps the API's error `type` (batch results carry no HTTP status). */
function errorTypeKind(type: string): ProviderErrorKind {
  switch (type) {
    case 'authentication_error':
    case 'permission_error':
    case 'billing_error':
      return 'auth';
    case 'rate_limit_error':
      return 'rate-limited';
    case 'timeout_error':
      return 'timeout';
    case 'invalid_request_error':
    case 'not_found_error':
    case 'request_too_large':
      return 'bad-request';
    default:
      return 'unavailable';
  }
}

function retryAfterSeconds(headers: Headers | undefined): number | undefined {
  const value = Number(headers?.get('retry-after'));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/** SDK errors checked most specific first; messages carry the status, never request content. */
function toProviderError(error: unknown): ProviderError {
  if (error instanceof ProviderError) {
    return error;
  }
  const fail = (kind: ProviderErrorKind, message: string, retryAfter?: number) =>
    new ProviderError(kind, PROVIDER, message, { cause: error, retryAfterSeconds: retryAfter });

  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return fail('timeout', 'Anthropic request timed out');
  }
  if (error instanceof Anthropic.APIUserAbortError) {
    return fail('cancelled', 'Anthropic request aborted');
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return fail('unavailable', 'Could not reach Anthropic');
  }
  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError
  ) {
    return fail('auth', `Anthropic rejected the credentials (${error.status})`);
  }
  if (error instanceof Anthropic.RateLimitError) {
    return fail('rate-limited', 'Anthropic rate limit reached', retryAfterSeconds(error.headers));
  }
  if (error instanceof Anthropic.APIError) {
    const status: number | undefined = error.status as number | undefined;
    // Anthropic documents 408 and 409 as transient, like 5xx.
    if (status === 408) {
      return fail('timeout', 'Anthropic timed out handling the request (408)');
    }
    if (status === 409) {
      return fail('unavailable', 'Anthropic reported a conflict (409)');
    }
    if (status !== undefined && status < 500) {
      return fail('bad-request', `Anthropic rejected the request (${status})`);
    }
    return fail('unavailable', `Anthropic is unavailable (${status ?? 'no status'})`);
  }
  // Not an SDK error, so not the provider's doing: retrying would repeat it.
  return fail('internal', 'Unexpected failure in the Anthropic adapter');
}
