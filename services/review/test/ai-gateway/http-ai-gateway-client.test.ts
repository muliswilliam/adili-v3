import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';

import { AiGatewayUnavailable, type TaskRequest } from '../../src/ai-gateway/ai-gateway-client.js';
import { HttpAiGatewayClient } from '../../src/ai-gateway/http-ai-gateway-client.js';
import { copilotInputs } from '../../src/copilot/copilot-inputs.js';
import { InternalApiRejected } from '../../src/internal-api/rejected.js';
import { asset, declaration, statement } from '../fixtures/declarations.js';

/** The ai-gateway's contract, to check what the client sends against it. */
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats.default(ajv);
ajv.addSchema(
  parse(
    readFileSync(
      createRequire(import.meta.url).resolve('@adili/schemas/internal/ai-gateway.yaml'),
      'utf8',
    ),
  ) as object,
  'ai-gateway.yaml',
);
const validTaskRequest = ajv.compile({ $ref: 'ai-gateway.yaml#/components/schemas/TaskRequest' });

/** The task and job calls at the client seam, as ai-gateway.yaml has them. */
describe('HttpAiGatewayClient', () => {
  const caseId = '0199b000-0000-7000-8000-0000000000c1';
  const document = declaration([statement('officer', { assets: [asset()] })]);
  const request: TaskRequest = {
    tenant: 'psc',
    dataClass: 'synthetic',
    subjectRef: `review-case:${caseId}`,
    input: copilotInputs({ current: document, previous: null, flags: [], registryStatuses: [] })
      .summarize,
  };
  const job = {
    id: '0199b000-0000-7000-8000-0000000000a1',
    task: 'summarize-declaration',
    tenant: 'psc',
    subjectRef: `review-case:${caseId}`,
    status: 'queued',
    reason: null,
    promptVersion: 1,
    provider: null,
    model: null,
    inputHash: 'abc',
    outputHash: null,
    usage: { tokensIn: 0, tokensOut: 0, costMicros: 0, latencyMs: 0 },
    output: null,
    createdAt: '2028-01-20T08:00:00.000Z',
    finishedAt: null,
  };
  const key = '0199b000-0000-7000-8000-0000000000a9';

  const client = (fetch: typeof globalThis.fetch) =>
    new HttpAiGatewayClient({
      gatewayUrl: 'http://ai.test',
      tokens: { token: () => Promise.resolve('token'), invalidate: vi.fn() },
      fetch,
    });

  it('posts the task with the idempotency key, no wait and the current prompt, and answers the job', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(Response.json(job, { status: 202 })),
    );

    const answer = await client(fetch).runTask('summarize-declaration', request, key);

    expect(answer).toEqual({
      id: job.id,
      task: job.task,
      subjectRef: job.subjectRef,
      status: 'queued',
      reason: null,
      promptVersion: 1,
      output: null,
      finishedAt: null,
    });
    const sent = fetch.mock.calls[0]?.[0] as Request;
    expect(sent.url).toBe('http://ai.test/internal/v1/tasks/summarize-declaration');
    expect(sent.method).toBe('POST');
    expect(Object.fromEntries(sent.headers)).toMatchObject({
      authorization: 'Bearer token',
      'idempotency-key': key,
    });
    const body: unknown = await sent.json();
    expect(body).toEqual({ ...request, promptVersion: null, waitSeconds: 0 });
    expect(validTaskRequest(body), JSON.stringify(validTaskRequest.errors)).toBe(true);
  });

  it('answers a job already finished (200) with its output, and reads a job by id', async () => {
    const finished = {
      ...job,
      status: 'succeeded',
      output: { overview: 'Summary' },
      finishedAt: '2028-01-20T08:00:05.000Z',
    };
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(Response.json(finished, { status: 200 })),
    );

    expect(await client(fetch).runTask('summarize-declaration', request, key)).toMatchObject({
      status: 'succeeded',
      output: { overview: 'Summary' },
    });
    expect(await client(fetch).getJob(job.id)).toMatchObject({ id: job.id, status: 'succeeded' });
    expect((fetch.mock.calls[1]?.[0] as Request).url).toBe(
      `http://ai.test/internal/v1/jobs/${job.id}`,
    );
  });

  it('a job the gateway does not have (404) is null', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(Response.json({ title: 'Not found' }, { status: 404 })),
    );
    expect(await client(fetch).getJob(job.id)).toBeNull();
  });

  it('a request the gateway refuses (400, 404, 422) is rejected; a rate limit, an outage or a body outside the contract is unavailable', async () => {
    for (const status of [400, 404, 422]) {
      const fetch = vi.fn<typeof globalThis.fetch>(() =>
        Promise.resolve(Response.json({ title: 'Refused' }, { status })),
      );
      await expect(
        client(fetch).runTask('summarize-declaration', request, key),
      ).rejects.toBeInstanceOf(InternalApiRejected);
    }
    const answers: (() => Promise<Response>)[] = [
      () => Promise.resolve(Response.json({ title: 'Rate limited' }, { status: 429 })),
      () => Promise.resolve(Response.json({ title: 'Unavailable' }, { status: 503 })),
      () => Promise.reject(new TypeError('fetch failed')),
      () => Promise.resolve(Response.json({ ...job, status: 'unknown' }, { status: 202 })),
    ];
    for (const answer of answers) {
      const fetch = vi.fn<typeof globalThis.fetch>(answer);
      await expect(
        client(fetch).runTask('summarize-declaration', request, key),
      ).rejects.toBeInstanceOf(AiGatewayUnavailable);
    }
  });
});
