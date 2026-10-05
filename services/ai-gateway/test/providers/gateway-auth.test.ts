import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { providerEnvSchema } from '../../src/providers/provider-env.js';
import { createModelProvider } from '../../src/providers/providers.module.js';
import type { StreamEvent } from '../../src/providers/port.js';

interface Seen {
  url: string;
  headers: IncomingHttpHeaders;
  body: Record<string, unknown>;
}

const message = {
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-opus-5-5',
  content: [{ type: 'text', text: '{"summary":"Two assets declared."}' }],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 5 },
};

function sse(): string {
  const events: [string, unknown][] = [
    ['message_start', { type: 'message_start', message: { ...message, content: [] } }],
    [
      'content_block_start',
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    ],
    [
      'content_block_delta',
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } },
    ],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    [
      'message_delta',
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
    ],
    ['message_stop', { type: 'message_stop' }],
  ];
  return events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join('');
}

/** A gateway on loopback that answers like the Messages API and records what it was sent. */
describe('an Anthropic-compatible gateway with a bearer token (self-hosted LLM Gateway)', () => {
  const seen: Seen[] = [];
  let server: Server;
  let baseUrl: string;
  const envKey = process.env.ANTHROPIC_API_KEY;

  beforeAll(async () => {
    server = createServer((request, response) => {
      let raw = '';
      request.on('data', (chunk: Buffer) => (raw += chunk.toString()));
      request.on('end', () => {
        const body = JSON.parse(raw) as Record<string, unknown>;
        seen.push({ url: request.url ?? '', headers: request.headers, body });
        if (body.stream) {
          response.writeHead(200, { 'content-type': 'text/event-stream' });
          response.end(sse());
          return;
        }
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify(message));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  });

  afterEach(() => {
    seen.length = 0;
    if (envKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = envKey;
  });

  const provider = () =>
    createModelProvider(
      providerEnvSchema.parse({
        AI_PROVIDER: 'anthropic',
        ANTHROPIC_AUTH_TOKEN: 'llmgtwy_test',
        ANTHROPIC_BASE_URL: baseUrl,
        ANTHROPIC_STRUCTURED_OUTPUT: 'prompted',
      }),
    );

  it('accepts a token instead of an API key', () => {
    expect(() =>
      providerEnvSchema.parse({ AI_PROVIDER: 'anthropic', ANTHROPIC_AUTH_TOKEN: 'llmgtwy_test' }),
    ).not.toThrow();
  });

  it('sends the token as a bearer and never an x-api-key, even with a key in the environment', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-from-environment';
    const result = await provider().generateStructured({
      model: 'claude-opus-5-5',
      system: 'You summarise synthetic declarations.',
      messages: [{ role: 'user', content: 'Summarise.' }],
      maxOutputTokens: 200,
      schema: {
        type: 'object',
        properties: { summary: { type: 'string' } },
        required: ['summary'],
        additionalProperties: false,
      },
    });

    expect(result).toMatchObject({ output: { summary: 'Two assets declared.' } });
    const [request] = seen;
    expect(request?.url).toBe('/v1/messages');
    expect(request?.headers.authorization).toBe('Bearer llmgtwy_test');
    expect(request?.headers['x-api-key']).toBeUndefined();
    // Prompted structured output: no output_config for a gateway that would drop it.
    expect(request?.body).not.toHaveProperty('output_config');
  });

  it('streams through the gateway', async () => {
    const events: StreamEvent[] = [];
    for await (const event of provider().stream({
      model: 'claude-opus-5-5',
      messages: [{ role: 'user', content: 'Hi' }],
      maxOutputTokens: 50,
    })) {
      events.push(event);
    }
    expect(events).toContainEqual({ type: 'delta', text: 'Hello' });
    expect(seen[0]?.headers.authorization).toBe('Bearer llmgtwy_test');
  });
});
