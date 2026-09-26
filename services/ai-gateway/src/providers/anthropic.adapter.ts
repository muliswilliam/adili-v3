import Anthropic from '@anthropic-ai/sdk';

import {
  type Attachment,
  type BatchItem,
  type BatchItemOutcome,
  type BatchStatus,
  type ChatMessage,
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

export interface AnthropicAdapterOptions {
  /** A configured SDK client; tests pass one with an in-process `fetch`. */
  client: Anthropic;
}

/** Adapter over the official Anthropic SDK. Vendor types stay inside this file. */
export class AnthropicAdapter implements ModelProvider {
  readonly name = PROVIDER;
  readonly capabilities: ProviderCapabilities = {
    structuredOutput: true,
    streaming: true,
    batch: true,
    promptCaching: true,
    attachments: ['image', 'pdf', 'text'],
  };
  private readonly client: Anthropic;

  constructor(options: AnthropicAdapterOptions) {
    this.client = options.client;
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const response = await this.call(() => this.client.messages.create(toParams(request)));
    return toGenerateResult(response);
  }

  async generateStructured(request: StructuredRequest): Promise<StructuredResult> {
    const response = await this.call(() => this.client.messages.create(toParams(request)));
    return toStructuredResult(response);
  }

  async *stream(request: GenerateRequest): AsyncIterable<StreamEvent> {
    try {
      const stream = this.client.messages.stream(toParams(request));
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
    const batch = await this.call(() =>
      this.client.messages.batches.create({
        requests: items.map((item) => ({
          custom_id: item.customId,
          params: toParams(item.request),
        })),
      }),
    );
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
        all.push(toBatchOutcome(entry));
      }
      return all;
    });
    return { batchId, status: 'ended', outcomes };
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
): Anthropic.MessageCreateParamsNonStreaming {
  const outputConfig: Anthropic.OutputConfig = {};
  if ('schema' in request) {
    outputConfig.format = { type: 'json_schema', schema: request.schema };
  }
  if (request.effort) {
    outputConfig.effort = request.effort;
  }
  return {
    model: request.model,
    max_tokens: request.maxOutputTokens,
    // The system prompt is the stable prefix shared by every job of a task version; cache it.
    ...(request.system !== undefined && {
      system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
    }),
    messages: request.messages.map(toMessageParam),
    ...(Object.keys(outputConfig).length > 0 && { output_config: outputConfig }),
  };
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

function toStructuredResult(message: Anthropic.Message): StructuredResult {
  const base = { model: message.model, usage: toUsage(message.usage) };
  if (message.stop_reason === 'refusal') {
    return { ...base, status: 'refused', refusal: refusalOf(message) };
  }
  if (isTruncated(message)) {
    return { ...base, status: 'truncated' };
  }
  try {
    return { ...base, status: 'completed', output: JSON.parse(textOf(message)) as unknown };
  } catch (error) {
    throw new ProviderError('invalid-response', PROVIDER, 'Structured output is not valid JSON', {
      cause: error,
    });
  }
}

function toBatchOutcome(
  entry: Anthropic.Messages.MessageBatchIndividualResponse,
): BatchItemOutcome {
  const customId = entry.custom_id;
  switch (entry.result.type) {
    case 'succeeded':
      try {
        return { customId, result: toStructuredResult(entry.result.message) };
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
    return fail('timeout', 'Anthropic request aborted');
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
    if (status !== undefined && status < 500) {
      return fail('bad-request', `Anthropic rejected the request (${status})`);
    }
    return fail('unavailable', `Anthropic is unavailable (${status ?? 'no status'})`);
  }
  return fail('unavailable', 'Unexpected Anthropic client failure');
}
