import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import {
  AiGatewayUnavailable,
  type ExtractionRequest,
} from '../../src/ai-gateway/ai-gateway-client.js';
import { HttpAiGatewayClient } from '../../src/ai-gateway/http-ai-gateway-client.js';

/**
 * The ai-gateway client against the gateway's contract (checked here both ways): an
 * `extract-document` request is a valid `TaskRequest` of data class `highly-confidential` for the
 * Commission in `X-Acting-Tenant`, and the jobs it reads conform to `Job`. Any refusal is
 * `AiGatewayUnavailable`; an unknown job is null.
 */
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats.default(ajv);
const contract = createRequire(import.meta.url).resolve('@adili/schemas/internal/ai-gateway.yaml');
ajv.addSchema(parse(readFileSync(contract, 'utf8')) as object, 'ai-gateway.yaml');

function conforming(schema: string, body: unknown): unknown {
  const validate = ajv.getSchema(`ai-gateway.yaml#/components/schemas/${schema}`);
  if (!validate) throw new Error(`no ${schema}`);
  expect(validate(body), JSON.stringify(validate.errors)).toBe(true);
  return body;
}

const JOB_ID = '0192f1a0-5a11-7000-8000-00000000e001';
const SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function job(overrides: Record<string, unknown> = {}) {
  return conforming('Job', {
    id: JOB_ID,
    task: 'extract-document',
    tenant: 'psc',
    subjectRef: 'declaration:0192f1a0-5a11-7000-8000-00000000e002',
    status: 'queued',
    reason: null,
    promptVersion: 1,
    provider: 'anthropic',
    model: 'claude-opus-5-5',
    inputHash: SHA256,
    outputHash: null,
    usage: { tokensIn: 0, tokensOut: 0, costMicros: 0, latencyMs: 0 },
    output: null,
    createdAt: '2027-11-02T08:55:00.000Z',
    finishedAt: null,
    ...overrides,
  });
}

const reading = {
  label: {
    aiAssisted: true,
    task: 'extract-document',
    promptVersion: 1,
    provider: 'anthropic',
    model: 'claude-opus-5-5',
    generatedAt: '2027-11-02T08:56:00.000Z',
    disclaimer: 'AI-assisted. Read from your document: check every field before you use it.',
  },
  detectedKind: 'logbook',
  fields: [{ name: 'details.registration', value: 'KCB 782M', confidence: 0.97, page: 1 }],
  warnings: [],
};

const request: ExtractionRequest = {
  tenant: 'psc',
  subjectRef: 'declaration:0192f1a0-5a11-7000-8000-00000000e002',
  input: {
    kind: 'extract-document',
    documentKindHint: 'logbook',
    target: { section: 'assets', itemType: 'vehicle' },
    attachment: {
      downloadUrl: 'http://seaweedfs.test/uploads/abc?X-Amz-Signature=1',
      contentType: 'image/jpeg',
      sha256: SHA256,
    },
    language: 'en',
  },
};

function clientAnswering(respond: () => Response) {
  const requests: { method: string; path: string; headers: Headers; body: unknown }[] = [];
  const client = new HttpAiGatewayClient({
    gatewayUrl: 'http://ai-gateway.test/',
    tokens: { token: () => Promise.resolve('token'), invalidate: () => undefined },
    fetch: async (input: string | URL | Request) => {
      const sent = input as Request;
      const text = await sent.text();
      requests.push({
        method: sent.method,
        path: new URL(sent.url).pathname,
        headers: sent.headers,
        body: text ? (JSON.parse(text) as unknown) : null,
      });
      return respond();
    },
  });
  return { client, requests };
}

describe('HttpAiGatewayClient', () => {
  it('asks for a highly-confidential extract-document job for the Commission', async () => {
    const { client, requests } = clientAnswering(() => json(job(), 202));

    const created = await client.extractDocument(request, 'key-1');

    expect(created).toEqual({ id: JOB_ID, status: 'queued', reason: null, output: null });
    const [sent] = requests;
    expect(sent?.path).toBe('/internal/v1/tasks/extract-document');
    expect(sent?.headers.get('x-acting-tenant')).toBe('psc');
    expect(sent?.headers.get('idempotency-key')).toBe('key-1');
    expect(conforming('TaskRequest', sent?.body)).toMatchObject({
      dataClass: 'highly-confidential',
      subjectRef: request.subjectRef,
      input: request.input,
    });
  });

  it("reads a job and its reading once it succeeded, and a blocked one's reason", async () => {
    const succeeded = clientAnswering(() =>
      json(job({ status: 'succeeded', output: reading, outputHash: SHA256 })),
    );
    expect(await succeeded.client.getJob('psc', JOB_ID)).toEqual({
      id: JOB_ID,
      status: 'succeeded',
      reason: null,
      output: { detectedKind: 'logbook', fields: reading.fields, warnings: [] },
    });
    expect(succeeded.requests[0]?.path).toBe(`/internal/v1/jobs/${JOB_ID}`);

    const blocked = clientAnswering(() => json(job({ status: 'blocked', reason: 'policy' })));
    expect(await blocked.client.getJob('psc', JOB_ID)).toMatchObject({
      status: 'blocked',
      reason: 'policy',
    });
  });

  it('answers null for an unknown job and unavailable for a refusal or a malformed answer', async () => {
    const problem = (status: number) => () =>
      new Response(JSON.stringify({ type: 'x', title: 'x', status }), {
        status,
        headers: { 'content-type': 'application/problem+json' },
      });

    expect(await clientAnswering(problem(404)).client.getJob('psc', JOB_ID)).toBeNull();
    for (const status of [400, 422, 429, 500]) {
      await expect(
        clientAnswering(problem(status)).client.extractDocument(request, 'key-1'),
      ).rejects.toBeInstanceOf(AiGatewayUnavailable);
    }
    await expect(
      clientAnswering(() => json(job({ status: 'succeeded', output: null }))).client.getJob(
        'psc',
        JOB_ID,
      ),
    ).rejects.toBeInstanceOf(AiGatewayUnavailable);
  });
});
