import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';

import {
  AnthropicAdapter,
  type AnthropicAdapterOptions,
} from '../../src/providers/anthropic.adapter.js';
import {
  ProviderError,
  type StreamEvent,
  type StructuredRequest,
} from '../../src/providers/port.js';
import { TASKS } from '../../src/tasks/registry.js';

interface Captured {
  method: string;
  url: string;
  body: Record<string, unknown> | undefined;
}

type Handler = (request: Captured, signal: AbortSignal | undefined) => Response | Promise<Response>;

/** The real SDK over an in-process fetch, so request shapes and error classes are the SDK's own. */
function fakeAnthropic(
  handler: Handler,
  options: { timeout?: number } & Omit<AnthropicAdapterOptions, 'client'> = {},
) {
  const { timeout = 5_000, ...adapterOptions } = options;
  const requests: Captured[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const captured: Captured = {
      method: init?.method ?? 'GET',
      url: String(input instanceof Request ? input.url : input),
      body:
        typeof init?.body === 'string'
          ? (JSON.parse(init.body) as Record<string, unknown>)
          : undefined,
    };
    requests.push(captured);
    return handler(captured, init?.signal ?? undefined);
  };
  const client = new Anthropic({
    apiKey: 'test-key',
    baseURL: 'http://anthropic.test',
    fetch,
    maxRetries: 0,
    timeout,
  });
  return { adapter: new AnthropicAdapter({ client, ...adapterOptions }), requests };
}

/** The nth captured request; fails the test when it was never sent. */
function nth(requests: Captured[], index: number): Captured {
  const request = requests[index];
  if (!request) {
    throw new Error(`request ${index} was not sent`);
  }
  return request;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function message(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5',
    content: [{ type: 'text', text: '{"summary":"Two assets declared."}' }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    stop_details: null,
    usage: {
      input_tokens: 120,
      output_tokens: 30,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 2048,
    },
    ...overrides,
  };
}

function apiError(status: number, type: string) {
  return json({ type: 'error', error: { type, message: 'nope' } }, status);
}

const schema = {
  type: 'object',
  properties: { summary: { type: 'string' } },
  required: ['summary'],
  additionalProperties: false,
};

const structured: StructuredRequest = {
  model: 'claude-opus-5',
  system: 'You summarise synthetic declarations.',
  messages: [{ role: 'user', content: 'Summarise [[PERSON_1]].' }],
  maxOutputTokens: 2000,
  schema,
};

describe('AnthropicAdapter', () => {
  it('requests structured output with the system prompt cached', async () => {
    const { adapter, requests } = fakeAnthropic(() => json(message()));

    const result = await adapter.generateStructured({ ...structured, effort: 'low' });

    expect(requests).toHaveLength(1);
    expect(nth(requests, 0).url).toBe('http://anthropic.test/v1/messages');
    expect(nth(requests, 0).body).toEqual({
      model: 'claude-opus-5',
      max_tokens: 2000,
      system: [
        {
          type: 'text',
          text: 'You summarise synthetic declarations.',
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: 'Summarise [[PERSON_1]].' }],
      output_config: { format: { type: 'json_schema', schema }, effort: 'low' },
    });
    expect(result).toEqual({
      status: 'completed',
      output: { summary: 'Two assets declared.' },
      model: 'claude-opus-5',
      usage: { inputTokens: 120, outputTokens: 30, cacheReadTokens: 2048, cacheWriteTokens: 0 },
    });
  });

  it('sends constraints structured outputs cannot enforce as schema descriptions', async () => {
    const { adapter, requests } = fakeAnthropic(() => json(message()));

    await adapter.generateStructured({
      ...structured,
      schema: {
        type: 'object',
        properties: {
          summary: { type: 'string', maxLength: 1200 },
          refs: { type: 'array', items: { type: 'string', format: 'uuid' }, minItems: 2 },
        },
        required: ['summary', 'refs'],
      },
    });

    const outputConfig = nth(requests, 0).body?.output_config as { format: { schema: unknown } };
    expect(outputConfig.format.schema).toEqual({
      type: 'object',
      properties: {
        summary: { type: 'string', description: '{maxLength: 1200}' },
        refs: {
          type: 'array',
          items: { type: 'string', format: 'uuid' },
          description: '{minItems: 2}',
        },
      },
      required: ['summary', 'refs'],
      additionalProperties: false,
    });
  });

  it.each(Object.values(TASKS))('accepts the output schema of task $name', async (task) => {
    const { adapter, requests } = fakeAnthropic(() => json(message()));

    await adapter.generateStructured({ ...structured, schema: task.outputJsonSchema });

    const outputConfig = nth(requests, 0).body?.output_config as { format: { schema: unknown } };
    expect(JSON.stringify(outputConfig.format.schema)).not.toMatch(/"(maxLength|minLength)"/);
  });

  it('generates text and sends attachments as vendor content blocks', async () => {
    const { adapter, requests } = fakeAnthropic(() =>
      json(
        message({
          content: [
            { type: 'text', text: 'First part. ' },
            { type: 'text', text: 'Second part.' },
          ],
        }),
      ),
    );

    const result = await adapter.generate({
      model: 'claude-opus-5',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'attachment',
              attachment: { kind: 'image', mediaType: 'image/png', data: 'iVBO' },
            },
            {
              type: 'attachment',
              attachment: {
                kind: 'pdf',
                mediaType: 'application/pdf',
                data: 'JVBE',
                name: 'Title deed',
              },
            },
            {
              type: 'attachment',
              attachment: { kind: 'text', mediaType: 'text/plain', data: 'plain notes' },
            },
            { type: 'text', text: 'Describe these.' },
          ],
        },
      ],
      maxOutputTokens: 500,
    });

    expect(result).toMatchObject({ status: 'completed', text: 'First part. Second part.' });
    const body = nth(requests, 0).body ?? {};
    expect(body.system).toBeUndefined();
    expect(body.output_config).toBeUndefined();
    expect(body.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBO' } },
          {
            type: 'document',
            title: 'Title deed',
            source: { type: 'base64', media_type: 'application/pdf', data: 'JVBE' },
          },
          {
            type: 'document',
            source: { type: 'text', media_type: 'text/plain', data: 'plain notes' },
          },
          { type: 'text', text: 'Describe these.' },
        ],
      },
    ]);
  });

  it('maps a refusal stop reason to refused', async () => {
    const { adapter } = fakeAnthropic(() =>
      json(
        message({
          content: [],
          stop_reason: 'refusal',
          stop_details: { type: 'refusal', category: 'cyber', explanation: 'Declined.' },
        }),
      ),
    );

    expect(await adapter.generateStructured(structured)).toMatchObject({
      status: 'refused',
      refusal: { category: 'cyber', explanation: 'Declined.' },
    });
    expect(await adapter.generate(structured)).toMatchObject({ status: 'refused' });
  });

  it('reports truncation without partial structured output', async () => {
    const { adapter } = fakeAnthropic(() =>
      json(message({ content: [{ type: 'text', text: '{"summ' }], stop_reason: 'max_tokens' })),
    );

    const result = await adapter.generateStructured(structured);
    expect(result).toMatchObject({ status: 'truncated' });
    expect(result).not.toHaveProperty('output');
    expect(await adapter.generate(structured)).toMatchObject({
      status: 'truncated',
      text: '{"summ',
    });
  });

  it('types unparseable structured output as an invalid response', async () => {
    const { adapter } = fakeAnthropic(() =>
      json(message({ content: [{ type: 'text', text: 'not json' }] })),
    );

    await expect(adapter.generateStructured(structured)).rejects.toMatchObject({
      kind: 'invalid-response',
      retryable: false,
    });
  });

  it('rejects fenced JSON when structured output is native', async () => {
    const { adapter } = fakeAnthropic(() =>
      json(message({ content: [{ type: 'text', text: '```json\n{"summary":"x"}\n```' }] })),
    );

    await expect(adapter.generateStructured(structured)).rejects.toMatchObject({
      kind: 'invalid-response',
    });
  });

  it('asks for the schema in the system prompt when structured output is prompted', async () => {
    const { adapter, requests } = fakeAnthropic(
      () =>
        json(
          message({
            content: [{ type: 'text', text: '```json\n{"summary":"Two assets declared."}\n```' }],
          }),
        ),
      { structuredOutput: 'prompted' },
    );

    const result = await adapter.generateStructured({ ...structured, effort: 'low' });

    const body = nth(requests, 0).body;
    expect(body).toMatchObject({ output_config: { effort: 'low' } });
    expect(body?.output_config).not.toHaveProperty('format');
    const [system] = body?.system as { text: string; cache_control: unknown }[];
    expect(system?.text).toMatch(/^You summarise synthetic declarations\.\n\n/);
    expect(system?.text).toContain(JSON.stringify(schema));
    expect(system?.cache_control).toEqual({ type: 'ephemeral' });
    expect(result).toMatchObject({
      status: 'completed',
      output: { summary: 'Two assets declared.' },
    });
  });

  it('still types prompted output that is not one JSON object as an invalid response', async () => {
    const { adapter } = fakeAnthropic(
      () => json(message({ content: [{ type: 'text', text: 'Here you go: {"summary":"x"}' }] })),
      { structuredOutput: 'prompted' },
    );

    await expect(adapter.generateStructured(structured)).rejects.toMatchObject({
      kind: 'invalid-response',
    });
  });

  it.each([
    [401, 'authentication_error', 'auth', false],
    [403, 'permission_error', 'auth', false],
    [400, 'invalid_request_error', 'bad-request', false],
    [404, 'not_found_error', 'bad-request', false],
    [408, 'timeout_error', 'timeout', true],
    [409, 'conflict_error', 'unavailable', true],
    [500, 'api_error', 'unavailable', true],
    [529, 'overloaded_error', 'unavailable', true],
  ])('types HTTP %i as %s', async (status, type, kind, retryable) => {
    const { adapter } = fakeAnthropic(() => apiError(status, type));

    const error = await adapter.generateStructured(structured).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ kind, retryable, provider: 'anthropic' });
  });

  it('types rate limiting with the retry-after delay', async () => {
    const { adapter } = fakeAnthropic(() =>
      json({ type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }, 429, {
        'retry-after': '17',
      }),
    );

    await expect(adapter.generate(structured)).rejects.toMatchObject({
      kind: 'rate-limited',
      retryable: true,
      retryAfterSeconds: 17,
    });
  });

  it('types connection failures as unavailable', async () => {
    const { adapter } = fakeAnthropic(() => {
      throw new TypeError('fetch failed');
    });

    await expect(adapter.generate(structured)).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it.each([
    ['a caller abort', new Anthropic.APIUserAbortError(), 'cancelled'],
    ['a failure outside the SDK', new TypeError('adapter bug'), 'internal'],
  ])('does not retry %s', async (_case, thrown, kind) => {
    const client = {
      messages: {
        create: () => Promise.reject(thrown),
      },
    } as unknown as Anthropic;
    const adapter = new AnthropicAdapter({ client });

    await expect(adapter.generate(structured)).rejects.toMatchObject({ kind, retryable: false });
  });

  it('types a request that exceeds the client timeout as timeout', async () => {
    const { adapter } = fakeAnthropic(
      (_request, signal) =>
        new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
      { timeout: 20 },
    );

    await expect(adapter.generate(structured)).rejects.toMatchObject({
      kind: 'timeout',
      retryable: true,
    });
  });

  it('streams text deltas then the final result', async () => {
    const events = [
      { type: 'message_start', message: message({ content: [], stop_reason: null }) },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello ' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'there.' } },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null, stop_details: null },
        usage: { output_tokens: 4 },
      },
      { type: 'message_stop' },
    ];
    const sse = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
    const { adapter, requests } = fakeAnthropic(
      () => new Response(sse, { headers: { 'content-type': 'text/event-stream' } }),
    );

    const received: StreamEvent[] = [];
    for await (const event of adapter.stream(structured)) {
      received.push(event);
    }

    expect(nth(requests, 0).body).toMatchObject({ stream: true });
    expect(received).toEqual([
      { type: 'delta', text: 'Hello ' },
      { type: 'delta', text: 'there.' },
      {
        type: 'final',
        result: {
          status: 'completed',
          text: 'Hello there.',
          model: 'claude-opus-5',
          usage: { inputTokens: 120, outputTokens: 4, cacheReadTokens: 2048, cacheWriteTokens: 0 },
        },
      },
    ]);
  });

  it('types errors raised while opening a stream', async () => {
    const { adapter } = fakeAnthropic(() => apiError(529, 'overloaded_error'));

    const drain = async () => {
      const events: StreamEvent[] = [];
      for await (const event of adapter.stream(structured)) {
        events.push(event);
      }
    };
    await expect(drain()).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('submits batches and maps per-item outcomes once ended', async () => {
    const batch = (status: string) => ({
      id: 'msgbatch_1',
      type: 'message_batch',
      processing_status: status,
      request_counts: { processing: 0, succeeded: 1, errored: 1, canceled: 0, expired: 0 },
      created_at: '2026-09-27T00:00:00Z',
      expires_at: '2026-09-28T00:00:00Z',
      ended_at: status === 'ended' ? '2026-09-27T01:00:00Z' : null,
      archived_at: null,
      cancel_initiated_at: null,
      results_url:
        status === 'ended' ? 'http://anthropic.test/v1/messages/batches/msgbatch_1/results' : null,
    });
    let status = 'in_progress';
    const { adapter, requests } = fakeAnthropic((request) => {
      if (request.url.endsWith('/results')) {
        const lines = [
          { custom_id: 'a', result: { type: 'succeeded', message: message() } },
          {
            custom_id: 'b',
            result: {
              type: 'errored',
              error: { type: 'error', error: { type: 'overloaded_error', message: 'x' } },
            },
          },
          { custom_id: 'c', result: { type: 'expired' } },
        ];
        return new Response(lines.map((l) => JSON.stringify(l)).join('\n'), {
          headers: { 'content-type': 'application/binary' },
        });
      }
      return json(batch(status));
    });

    const { batchId } = await adapter.submitBatch([
      { customId: 'a', request: structured },
      { customId: 'b', request: structured },
      { customId: 'c', request: structured },
    ]);
    expect(batchId).toBe('msgbatch_1');
    expect(nth(requests, 0).url).toBe('http://anthropic.test/v1/messages/batches');
    const sent = nth(requests, 0).body?.requests as {
      custom_id: string;
      params: Record<string, unknown>;
    }[];
    expect(sent.map((r) => r.custom_id)).toEqual(['a', 'b', 'c']);
    expect(sent[0]?.params).toMatchObject({
      model: 'claude-opus-5',
      output_config: { format: { type: 'json_schema', schema } },
    });

    expect(await adapter.pollBatch(batchId)).toEqual({ batchId, status: 'processing' });

    status = 'ended';
    expect(await adapter.pollBatch(batchId)).toEqual({
      batchId,
      status: 'ended',
      outcomes: [
        {
          customId: 'a',
          result: {
            status: 'completed',
            output: { summary: 'Two assets declared.' },
            model: 'claude-opus-5',
            usage: {
              inputTokens: 120,
              outputTokens: 30,
              cacheReadTokens: 2048,
              cacheWriteTokens: 0,
            },
          },
        },
        { customId: 'b', error: 'unavailable' },
        { customId: 'c', error: 'timeout' },
      ],
    });
  });

  it('declares its capabilities', () => {
    const { adapter } = fakeAnthropic(() => json(message()));
    expect(adapter.name).toBe('anthropic');
    expect(adapter.capabilities).toEqual({
      structuredOutput: true,
      streaming: true,
      batch: true,
      promptCaching: true,
      attachments: ['image', 'pdf', 'text'],
    });
  });
});
