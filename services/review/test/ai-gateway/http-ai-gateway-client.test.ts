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
const validFeedbackInput = ajv.compile({
  $ref: 'ai-gateway.yaml#/components/schemas/FeedbackInput',
});

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

  it('posts the task for the tenant it acts for, with the idempotency key, no wait and the current prompt, and answers the job', async () => {
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
      'x-acting-tenant': 'psc',
    });
    const body: unknown = await sent.json();
    expect(body).toEqual({
      dataClass: request.dataClass,
      subjectRef: request.subjectRef,
      input: request.input,
      promptVersion: null,
      waitSeconds: 0,
    });
    expect(validTaskRequest(body), JSON.stringify(validTaskRequest.errors)).toBe(true);
  });

  it('waits for the job when asked, past the default 2 s budget, and refuses a longer wait than its own', async () => {
    const finished = { ...job, status: 'succeeded', output: { items: [] } };
    // Answers after the default budget would have aborted the call.
    const fetch = vi.fn<typeof globalThis.fetch>(
      (_request, init) =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            resolve(Response.json(finished, { status: 200 }));
          }, 2_300);
          init?.signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('aborted'));
          });
        }),
    );

    const answer = await client(fetch).runTask('summarize-declaration', request, key, {
      waitSeconds: 10,
    });

    expect(answer).toMatchObject({ status: 'succeeded' });
    const body: unknown = await (fetch.mock.calls[0]?.[0] as Request).json();
    expect(body).toMatchObject({ waitSeconds: 10 });
    expect(validTaskRequest(body), JSON.stringify(validTaskRequest.errors)).toBe(true);
    expect(() =>
      client(fetch).runTask('summarize-declaration', request, key, { waitSeconds: 11 }),
    ).toThrow(RangeError);
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
    expect(await client(fetch).getJob('psc', job.id)).toMatchObject({
      id: job.id,
      status: 'succeeded',
    });
    const read = fetch.mock.calls[1]?.[0] as Request;
    expect(read.url).toBe(`http://ai.test/internal/v1/jobs/${job.id}`);
    expect(read.headers.get('x-acting-tenant')).toBe('psc');
  });

  it('a job the gateway does not have (404) is null', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(Response.json({ title: 'Not found' }, { status: 404 })),
    );
    expect(await client(fetch).getJob('psc', job.id)).toBeNull();
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

  describe('recordFeedback', () => {
    const feedback = {
      reviewerSubject: 'reviewer-a',
      rating: 'not-helpful',
      reason: 'unclear',
      note: 'Hard to follow.',
    } as const;

    it('puts the rating for the job and answers true once recorded', async () => {
      const fetch = vi.fn<typeof globalThis.fetch>(() =>
        Promise.resolve(
          Response.json({ ...feedback, jobId: job.id, at: '2028-01-20T08:10:00.000Z' }),
        ),
      );

      expect(await client(fetch).recordFeedback('psc', job.id, feedback)).toBe(true);
      const sent = fetch.mock.calls[0]?.[0] as Request;
      expect(sent.url).toBe(`http://ai.test/internal/v1/jobs/${job.id}/feedback`);
      expect(sent.method).toBe('PUT');
      expect(sent.headers.get('x-acting-tenant')).toBe('psc');
      const body: unknown = await sent.json();
      expect(body).toEqual(feedback);
      expect(validFeedbackInput(body), JSON.stringify(validFeedbackInput.errors)).toBe(true);
    });

    it('a job the gateway has no output of (404) is false; 400 is rejected; an outage unavailable', async () => {
      const answering = (status: number) =>
        vi.fn<typeof globalThis.fetch>(() =>
          Promise.resolve(Response.json({ title: 'No' }, { status })),
        );
      expect(await client(answering(404)).recordFeedback('psc', job.id, feedback)).toBe(false);
      await expect(
        client(answering(400)).recordFeedback('psc', job.id, feedback),
      ).rejects.toBeInstanceOf(InternalApiRejected);
      await expect(
        client(answering(503)).recordFeedback('psc', job.id, feedback),
      ).rejects.toBeInstanceOf(AiGatewayUnavailable);
    });
  });

  it("reads a tenant's AI status; an answer outside the contract is unavailable", async () => {
    const status = {
      tenant: 'psc',
      enabled: true,
      providerClass: 'external',
      dataClasses: ['synthetic'],
    };
    const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(Response.json(status)));

    expect(await client(fetch).tenantStatus('psc')).toEqual(status);
    const sent = fetch.mock.calls[0]?.[0] as Request;
    expect(sent.url).toBe('http://ai.test/internal/v1/tenants/psc/status');
    expect(sent.headers.get('x-acting-tenant')).toBe('psc');

    const broken = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(Response.json({ ...status, providerClass: 'cloud' })),
    );
    await expect(client(broken).tenantStatus('psc')).rejects.toBeInstanceOf(AiGatewayUnavailable);
  });
});
