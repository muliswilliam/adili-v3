import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import {
  AiGatewayUnavailable,
  type AnswerFrame,
  type AnswerInput,
  type AnswerRequest,
} from '../../src/ai-gateway/ai-gateway-client.js';
import { HttpAiGatewayClient } from '../../src/ai-gateway/http-ai-gateway-client.js';

/**
 * The ai-gateway's answer stream (ADR-019) as the declarations service reads it: server-sent
 * events split anyhow across chunks, a request that conforms to the gateway's committed contract,
 * the statuses it does not take, and the ways a stream can end without its last frame.
 */
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats.default(ajv);
const contract = createRequire(import.meta.url).resolve('@adili/schemas/internal/ai-gateway.yaml');
ajv.addSchema(parse(readFileSync(contract, 'utf8')) as object, 'ai-gateway.yaml');

function conforms(schema: string, body: unknown): void {
  const validate = ajv.getSchema(`ai-gateway.yaml#/components/schemas/${schema}`);
  if (!validate) throw new Error(`no ${schema}`);
  expect(validate(body), JSON.stringify(validate.errors)).toBe(true);
}

const input: AnswerInput = {
  kind: 'answer-declarant-question',
  mode: 'answer',
  language: 'en',
  question: "Do I declare my wife's salary?",
  context: {
    declarationType: 'biennial',
    statementDate: '2027-11-01',
    householdCounts: { spouses: 1, children: 0 },
    sectionKey: 'statement:officer',
    residuals: [
      { sectionKey: 'statement:officer', ruleId: 'required', fieldPath: '/assets/0/value' },
    ],
  },
  passages: [{ id: 'p-31', citation: 'Act s.31', text: 'Every public officer shall ...' }],
  history: [],
};

const request: AnswerRequest = {
  tenant: 'psc',
  subjectRef: 'assistant-conversation:0192f1a0-5a11-7000-8000-000000000001',
  input,
};

const KEY = '0192f1a0-5a11-7000-8000-0000000000aa';

const job = {
  id: '0192f1a0-5a11-7000-8000-0000000000bb',
  task: 'answer-declarant-question',
  tenant: 'psc',
  subjectRef: request.subjectRef,
  status: 'succeeded',
  reason: null,
  promptVersion: 1,
  provider: 'anthropic',
  model: 'claude',
  inputHash: 'a',
  outputHash: 'b',
  usage: { tokensIn: 1, tokensOut: 1, costMicros: 1, latencyMs: 1 },
  output: {
    label: {
      aiAssisted: true,
      task: 'answer-declarant-question',
      promptVersion: 1,
      provider: 'anthropic',
      model: 'claude',
      generatedAt: '2027-11-15T09:00:00.000Z',
      disclaimer: 'Not legal advice.',
    },
    declined: false,
    blocks: [{ text: 'Yes.', passageIds: ['p-31'], sectionLink: null }],
    followUps: [],
  },
  createdAt: '2027-11-15T09:00:00.000Z',
  finishedAt: '2027-11-15T09:00:01.000Z',
};

/** A body that sends `chunks` one by one, then ends (or stays open with `open`). */
function sse(chunks: string[], { open = false } = {}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      if (!open) controller.close();
    },
  });
}

interface Sent {
  url: string;
  headers: Headers;
  body: unknown;
  signal: AbortSignal | undefined;
}

function clientAnswering(
  respond: (attempt: number) => Response | Promise<Response>,
  timeouts?: { openMs?: number; deadlineMs?: number; idleMs?: number },
) {
  const sent: Sent[] = [];
  let tokens = 0;
  let invalidated = 0;
  const client = new HttpAiGatewayClient({
    gatewayUrl: 'http://ai-gateway.test/',
    tokens: {
      token: () => Promise.resolve(`token-${String(++tokens)}`),
      invalidate: () => {
        invalidated += 1;
      },
    },
    fetch: (url, init) => {
      sent.push({
        url: url instanceof Request ? url.url : url.toString(),
        headers: new Headers(init?.headers),
        body: JSON.parse(typeof init?.body === 'string' ? init.body : 'null') as unknown,
        signal: init?.signal ?? undefined,
      });
      return Promise.resolve(respond(sent.length));
    },
    timeouts,
  });
  return { client, sent, invalidated: () => invalidated };
}

const streamed = (body: ReadableStream<Uint8Array>) =>
  new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });

async function all(frames: AsyncIterable<AnswerFrame>): Promise<AnswerFrame[]> {
  const read: AnswerFrame[] = [];
  for await (const frame of frames) read.push(frame);
  return read;
}

describe('HttpAiGatewayClient', () => {
  it('sends a contract request acting for the Commission and reads the frames however they are split', async () => {
    const final = `event: final\ndata: ${JSON.stringify({ job })}\n\n`;
    const { client, sent } = clientAnswering(() =>
      streamed(
        sse([
          ': ping\n\n',
          'event: delta\nda',
          'ta: {"text":"Yes"}\n\nevent: delta\r\ndata: {"text":", declare it."}\r\n\r\n',
          final.slice(0, 40),
          final.slice(40),
        ]),
      ),
    );

    const frames = await all(await client.streamAnswer(request, KEY, new AbortController().signal));

    expect(frames).toEqual([
      { event: 'delta', text: 'Yes' },
      { event: 'delta', text: ', declare it.' },
      { event: 'final', job: { id: job.id, output: job.output } },
    ]);
    expect(sent[0]?.url).toBe(
      'http://ai-gateway.test/internal/v1/tasks/answer-declarant-question/stream',
    );
    expect(Object.fromEntries(sent[0]?.headers ?? [])).toMatchObject({
      authorization: 'Bearer token-1',
      'idempotency-key': KEY,
      'x-acting-tenant': 'psc',
      accept: 'text/event-stream',
    });
    conforms('TaskRequest', sent[0]?.body);
    expect(sent[0]?.body).toEqual({
      dataClass: 'synthetic',
      subjectRef: request.subjectRef,
      input,
    });
  });

  it('reads an error frame as the last', async () => {
    const { client } = clientAnswering(() =>
      streamed(
        sse(['event: delta\ndata: {"text":"Ye"}\n\nevent: error\ndata: {"reason":"timeout"}\n\n']),
      ),
    );

    const frames = await all(await client.streamAnswer(request, KEY, new AbortController().signal));

    expect(frames).toEqual([
      { event: 'delta', text: 'Ye' },
      { event: 'error', reason: 'timeout' },
    ]);
  });

  it('retries once with a fresh token after a 401', async () => {
    const { client, sent, invalidated } = clientAnswering((attempt) =>
      attempt === 1
        ? new Response(null, { status: 401 })
        : streamed(sse([`event: final\ndata: ${JSON.stringify({ job })}\n\n`])),
    );

    const frames = await all(await client.streamAnswer(request, KEY, new AbortController().signal));

    expect(frames.map((frame) => frame.event)).toEqual(['final']);
    expect(invalidated()).toBe(1);
    expect(sent.map((each) => each.headers.get('authorization'))).toEqual([
      'Bearer token-1',
      'Bearer token-2',
    ]);
  });

  it('is unavailable when the gateway does not take the stream', async () => {
    for (const status of [400, 403, 409, 429, 500, 503]) {
      const { client } = clientAnswering(
        () =>
          new Response(JSON.stringify({ status }), {
            status,
            headers: { 'content-type': 'application/problem+json' },
          }),
      );
      await expect(
        client.streamAnswer(request, KEY, new AbortController().signal),
      ).rejects.toBeInstanceOf(AiGatewayUnavailable);
    }
    const unreachable = new HttpAiGatewayClient({
      gatewayUrl: 'http://ai-gateway.test',
      tokens: { token: () => Promise.resolve('t'), invalidate: () => undefined },
      fetch: () => Promise.reject(new TypeError('fetch failed')),
    });
    await expect(
      unreachable.streamAnswer(request, KEY, new AbortController().signal),
    ).rejects.toBeInstanceOf(AiGatewayUnavailable);
  });

  it('is unavailable when the gateway does not answer in time', async () => {
    const silent = new HttpAiGatewayClient({
      gatewayUrl: 'http://ai-gateway.test',
      tokens: { token: () => Promise.resolve('t'), invalidate: () => undefined },
      // Answers nothing until the request is aborted, as fetch does.
      fetch: (_url, init) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
      timeouts: { openMs: 20 },
    });

    await expect(
      silent.streamAnswer(request, KEY, new AbortController().signal),
    ).rejects.toBeInstanceOf(AiGatewayUnavailable);
  });

  it('ends with an error frame when the stream breaks the contract or stops without its last frame', async () => {
    for (const chunks of [
      ['event: delta\ndata: {"text":"Ye"}\n\n'],
      ['event: final\ndata: {"job":{"id":"nope"}}\n\n'],
      ['event: delta\ndata: not json\n\n'],
      ['event: error\ndata: {"reason":"exploded"}\n\n'],
    ]) {
      const { client } = clientAnswering(() => streamed(sse(chunks)));
      const frames = await all(
        await client.streamAnswer(request, KEY, new AbortController().signal),
      );
      expect(frames.at(-1)).toEqual({ event: 'error', reason: 'provider' });
    }
  });

  it('ends with an error frame when the stream goes silent', async () => {
    const { client } = clientAnswering(
      () => streamed(sse(['event: delta\ndata: {"text":"Ye"}\n\n'], { open: true })),
      { idleMs: 30 },
    );

    const frames = await all(await client.streamAnswer(request, KEY, new AbortController().signal));

    expect(frames).toEqual([
      { event: 'delta', text: 'Ye' },
      { event: 'error', reason: 'provider' },
    ]);
  });

  it('closes the request and yields nothing more once the declarant leaves', async () => {
    const { client, sent } = clientAnswering(() =>
      streamed(sse(['event: delta\ndata: {"text":"Ye"}\n\n'], { open: true })),
    );
    const left = new AbortController();
    const frames = await client.streamAnswer(request, KEY, left.signal);

    const read: AnswerFrame[] = [];
    for await (const frame of frames) {
      read.push(frame);
      left.abort();
    }

    expect(read).toEqual([{ event: 'delta', text: 'Ye' }]);
    expect(sent[0]?.signal?.aborted).toBe(true);
  });
});
