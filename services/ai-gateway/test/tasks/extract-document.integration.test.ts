import { createHash, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { auditRecords, jobs } from '../../src/db/schema.js';
import { DEMO_DOCUMENT_GATE_CHANGE, seedDemoGatePolicies } from '../../src/policy/demo-seed.js';
import { GatePolicies } from '../../src/policy/gate-policies.js';
import type { ContentPart, StructuredRequest, StructuredResult } from '../../src/providers/port.js';
import type { ExtractOutput } from '../../src/tasks/extract-document.js';
import { contractErrors } from '../support/contract.js';
import { testPdf, TINY_PNG } from '../support/documents.js';
import { actingFor, usage } from '../support/inputs.js';
import { ScriptedProvider } from '../support/scripted-provider.js';
import { createTestApp, type TestApp } from '../support/test-app.js';

interface Job {
  id: string;
  status: string;
  reason: string | null;
  output: Record<string, unknown> | null;
  [key: string]: unknown;
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

const TITLE_DEED = [
  'REPUBLIC OF KENYA',
  'THE LAND REGISTRATION ACT, 2012',
  'TITLE DEED',
  'Title Number: NAKURU/NJORO/1187',
  'Approximate Area: 0.405 Ha',
  'Proprietor: WANJIRU AKINYI KAMAU, ID No. 28765432',
];

/** The tokens the gateway puts in the title deed's text layer, in the order it finds them. */
const tokenOf = (request: StructuredRequest, pattern: RegExp): string => {
  const content = request.messages[0]?.content as string;
  const match = pattern.exec(content);
  if (!match?.[1]) throw new Error(`No token for ${pattern.source} in the request`);
  return match[1];
};

/**
 * Reading a document into the form through the internal API (spec 05b S6, S10): the gateway
 * fetches the file once the gate admits the job, sends a digital PDF as its minimised text layer
 * and a scan as an untrusted attachment, and restores the identifiers the model copied.
 */
describe('extract-document', { timeout: 90_000 }, () => {
  const files = new Map<string, Uint8Array>();
  let fetched: string[] = [];
  let server: Server;
  let origin: string;

  let answer: (request: StructuredRequest) => ExtractOutput = () => ({
    detectedKind: 'title-deed',
    fields: [],
    warnings: [],
  });
  const provider = new ScriptedProvider(
    (request): Promise<StructuredResult> =>
      Promise.resolve({
        status: 'completed',
        model: 'claude-opus-5-5',
        output: answer(request),
        usage,
      }),
    'external',
  );
  let t: TestApp;
  let auth: { authorization: string };
  let pdf: Uint8Array;

  beforeAll(async () => {
    server = createServer((request, response) => {
      const path = new URL(request.url ?? '/', 'http://store').pathname;
      fetched.push(path);
      const file = files.get(path);
      if (file) response.writeHead(200).end(file);
      else response.writeHead(403).end('expired');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    pdf = await testPdf([{ lines: TITLE_DEED }]);
    files.set('/clean/title-deed.pdf', pdf);
    files.set('/clean/scan.png', TINY_PNG);

    t = await createTestApp({ provider, documentOrigins: [origin] });
    await seedDemoGatePolicies(t.app.get(GatePolicies), ['psc'], DEMO_DOCUMENT_GATE_CHANGE);
    auth = { authorization: `Bearer ${await t.token({ clientId: 'declarations' })}` };
    return async () => {
      await t.close();
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        }),
      );
    };
  });

  beforeEach(() => {
    fetched = [];
    provider.requests.length = 0;
  });

  const extractInput = (path = '/clean/title-deed.pdf', bytes: Uint8Array = pdf) => ({
    kind: 'extract-document',
    documentKindHint: 'title-deed',
    target: { section: 'assets', itemType: 'land' },
    attachment: {
      downloadUrl: `${origin}${path}?X-Amz-Signature=${randomUUID()}`,
      contentType: path.endsWith('.png') ? 'image/png' : 'application/pdf',
      sha256: sha256(bytes),
    },
    language: 'en',
  });

  const post = (
    input: object,
    {
      tenant = 'psc',
      dataClass = 'highly-confidential',
      subjectRef = `declaration:${randomUUID()}`,
    } = {},
  ) =>
    t.app.inject({
      method: 'POST',
      url: '/internal/v1/tasks/extract-document',
      headers: { ...auth, ...actingFor(tenant), 'idempotency-key': randomUUID() },
      payload: { dataClass, subjectRef, waitSeconds: 10, input },
    });

  const run = async (input: object, options?: Parameters<typeof post>[1]): Promise<Job> => {
    const response = await post(input, options);
    expect(response.statusCode).toBe(200);
    return response.json<Job>();
  };

  it('reads a digital PDF from its minimised text layer and restores what the model copied', async () => {
    answer = (request) => ({
      detectedKind: 'title-deed',
      fields: [
        {
          name: 'details.parcelNumber',
          value: tokenOf(request, /Title Number: (\[\[PARCEL_\d+\]\])/u),
          confidence: 0.97,
          page: 1,
        },
        { name: 'details.size', value: '0.405 Ha', confidence: 0.95, page: 1 },
        { name: 'location.county', value: '032', confidence: 0.8, page: 1 },
      ],
      warnings: [],
    });

    const job = await run(extractInput());

    expect(job).toMatchObject({
      status: 'succeeded',
      output: {
        label: { task: 'extract-document', aiAssisted: true },
        detectedKind: 'title-deed',
        fields: [
          { name: 'details.parcelNumber', value: 'NAKURU/NJORO/1187', confidence: 0.97, page: 1 },
          { name: 'details.size', value: '0.405 Ha' },
          { name: 'location.county', value: '032' },
        ],
      },
    });
    expect(contractErrors('Job', job)).toEqual([]);
    const sent = JSON.stringify(provider.requests[0]?.messages);
    for (const identifier of ['WANJIRU', 'KAMAU', '28765432', 'NAKURU/NJORO/1187', origin]) {
      expect(sent).not.toContain(identifier);
    }
  });

  it('sends a scan as an attachment, wrapped as an untrusted document', async () => {
    answer = () => ({ detectedKind: 'title-deed', fields: [], warnings: ['Page 1 is blurred.'] });

    const job = await run(extractInput('/clean/scan.png', TINY_PNG));

    expect(job).toMatchObject({
      status: 'succeeded',
      output: { warnings: ['Page 1 is blurred.'] },
    });
    const parts = provider.requests[0]?.messages[0]?.content as ContentPart[];
    expect(
      parts.map((part) => (part.type === 'text' ? part.text.slice(0, 22) : part.type)),
    ).toEqual([
      '<untrusted-input>\n{"do',
      '<untrusted-document pa',
      'attachment',
      '</untrusted-document>',
    ]);
  });

  it('blocks a Commission whose gate has not approved highly-confidential data, fetching nothing', async () => {
    const job = await run(extractInput(), { tenant: 'kcomm' });

    expect(job).toMatchObject({ status: 'blocked', reason: 'policy', output: null });
    expect(fetched).toEqual([]);
    expect(provider.requests).toHaveLength(0);
  });

  it('refuses any data class but highly-confidential', async () => {
    const response = await post(extractInput(), { dataClass: 'synthetic' });

    expect(response.statusCode).toBe(400);
  });

  it('fails as document-unavailable when the download link has expired', async () => {
    const job = await run({ ...extractInput('/clean/gone.pdf') });

    expect(job).toMatchObject({ status: 'failed', reason: 'document-unavailable', output: null });
    expect(provider.requests).toHaveLength(0);
    const [audit] = await t.db.select().from(auditRecords).where(eq(auditRecords.jobId, job.id));
    expect(audit).toMatchObject({ outcome: 'failed', reason: 'document-unavailable' });
  });

  it('fails as document-unreadable when the file is not the one named', async () => {
    const input = extractInput();
    const job = await run({
      ...input,
      attachment: { ...input.attachment, sha256: 'c'.repeat(64) },
    });

    expect(job).toMatchObject({ status: 'failed', reason: 'document-unreadable' });
    expect(provider.requests).toHaveLength(0);
  });

  it('serves a document read again through a fresh link from the cache', async () => {
    answer = () => ({ detectedKind: 'title-deed', fields: [], warnings: [] });
    const subjectRef = `declaration:${randomUUID()}`;

    const first = await run(extractInput(), { subjectRef });
    const again = await run(extractInput(), { subjectRef });

    expect(again.id).toBe(first.id);
    expect(provider.requests).toHaveLength(1);
  });

  it('fails a reading with a field the target item type does not have', async () => {
    answer = () => ({
      detectedKind: 'logbook',
      fields: [{ name: 'details.registration', value: 'KDK 482M', confidence: 0.9, page: 1 }],
      warnings: [],
    });

    const job = await run(extractInput());

    expect(job).toMatchObject({ status: 'failed', reason: 'validation', output: null });
  });

  it('fails a reading that holds an account number, recording why', async () => {
    answer = () => ({
      detectedKind: 'title-deed',
      fields: [
        { name: 'description', value: 'Land, account 0102938475610', confidence: 0.9, page: 1 },
      ],
      warnings: [],
    });

    const job = await run(extractInput());

    expect(job).toMatchObject({ status: 'failed', reason: 'validation', output: null });
    const [row] = await t.db.select().from(jobs).where(eq(jobs.id, job.id));
    expect(row?.violations).toEqual([{ kind: 'account-number', field: 0 }]);
  });
});
