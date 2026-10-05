import { describe, expect, it, vi } from 'vitest';

import { AiGatewayUnavailable, type TaskRequest } from '../../src/ai-gateway/ai-gateway-client.js';
import { HttpAiGatewayClient } from '../../src/ai-gateway/http-ai-gateway-client.js';
import { DeclarationsUnavailable } from '../../src/declarations/declarations-client.js';
import { HttpDeclarationsClient } from '../../src/declarations/http-declarations-client.js';
import { DirectoryUnavailable } from '../../src/directory/directory-client.js';
import { HttpDirectoryClient } from '../../src/directory/http-directory-client.js';
import { DocumentsUnavailable } from '../../src/documents/documents-client.js';
import { HttpDocumentsClient } from '../../src/documents/http-documents-client.js';
import {
  HttpIntegrationGatewayClient,
  ICMS_LEGAL_BASIS,
} from '../../src/integration-gateway/http-integration-gateway-client.js';
import { IntegrationGatewayUnavailable } from '../../src/integration-gateway/integration-gateway-client.js';
import { InternalApiRejected } from '../../src/internal-api/internal-api.js';
import { HttpNotificationsClient } from '../../src/notifications/http-notifications-client.js';
import { HttpReviewClient } from '../../src/review/http-review-client.js';

const tokens = { token: () => Promise.resolve('token'), invalidate: vi.fn() };

type Fetch = typeof globalThis.fetch;

/** The URL, headers and JSON body of the n-th request a fetch mock got from the client. */
async function request(fetch: ReturnType<typeof vi.fn<Fetch>>, n = 0) {
  const [input] = fetch.mock.calls[n] ?? [];
  const sent = (input as Request).clone();
  const text = await sent.text();
  return {
    url: sent.url,
    method: sent.method,
    headers: Object.fromEntries(sent.headers),
    body: text === '' ? undefined : (JSON.parse(text) as unknown),
  };
}

describe('HttpDeclarationsClient', () => {
  it('pulls officer details in pages of 1,000 obligation ids for the Commission', async () => {
    const fetch = vi.fn<Fetch>(async (input) => {
      const { obligationIds } = (await (input as Request).clone().json()) as {
        obligationIds: string[];
      };
      return Response.json({
        items: obligationIds.slice(0, 1).map((obligationId) => ({
          obligationId,
          name: 'Officer Kamau',
          designation: 'Clerk',
          fileNumber: 'PSC/1',
          appointmentDate: '2020-01-01',
          exitDate: null,
        })),
      });
    });
    const client = new HttpDeclarationsClient({
      declarationsUrl: 'http://declarations.test',
      tokens,
      fetch,
    });
    const ids = Array.from(
      { length: 1_500 },
      (_, i) => `0199b000-0000-7000-8000-${String(i).padStart(12, '0')}`,
    );

    const officers = await client.officerDetails('psc', ids);

    expect(officers.map((officer) => officer.obligationId)).toEqual([ids[0], ids[1_000]]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(await request(fetch, 0)).toMatchObject({
      url: 'http://declarations.test/internal/v1/obligations/details',
      method: 'POST',
      headers: { 'x-acting-tenant': 'psc', authorization: 'Bearer token' },
    });
    expect(
      ((await request(fetch, 1)).body as { obligationIds: string[] }).obligationIds,
    ).toHaveLength(500);
  });

  it('is unavailable when declarations answers outside its contract', async () => {
    const fetch = vi.fn<Fetch>(() => Promise.resolve(Response.json({ items: [{ name: 1 }] })));
    const client = new HttpDeclarationsClient({
      declarationsUrl: 'http://declarations.test',
      tokens,
      fetch,
    });

    await expect(
      client.officerDetails('psc', ['0199b000-0000-7000-8000-000000000001']),
    ).rejects.toBeInstanceOf(DeclarationsUnavailable);
  });
});

describe('HttpReviewClient', () => {
  it('pulls clarification details by id for the Commission', async () => {
    const clarificationId = '0199b000-0000-7000-8000-0000000000c1';
    const fetch = vi.fn<Fetch>(() =>
      Promise.resolve(
        Response.json({
          items: [
            {
              clarificationId,
              reference: 'CLR-PSC-2027-0000001-4',
              name: 'Declarant Achieng',
              designation: 'Accountant',
              identifier: 'PSC/2',
              requirementLabels: ['Source of income'],
            },
          ],
        }),
      ),
    );
    const client = new HttpReviewClient({ reviewUrl: 'http://review.test', tokens, fetch });

    expect(await client.clarificationDetails('psc', [clarificationId])).toHaveLength(1);
    expect(await request(fetch)).toMatchObject({
      url: 'http://review.test/internal/v1/review/clarifications/details',
      body: { clarificationIds: [clarificationId] },
    });
  });

  it("reads a referral's ICMS payload for the Commission; null when review knows none, rejected on 409", async () => {
    const referralId = '0199b000-0000-7000-8000-0000000000f1';
    const payload = {
      reference: 'RFL-PSC-2028-0000001-5',
      grounds: 'two-missed-cycles',
      groundsLabel: 'Two missed declaration cycles',
      commission: { name: 'Public Service Commission', issuerCode: 'PSC' },
      declarant: { name: 'Declarant Achieng', nationalId: '12345678' },
      narrative: 'Missed two cycles.',
    };
    const fetch = vi
      .fn<Fetch>()
      .mockResolvedValueOnce(Response.json(payload))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 409 }));
    const client = new HttpReviewClient({ reviewUrl: 'http://review.test', tokens, fetch });

    expect(await client.referralIcmsPayload('psc', referralId, 'analyst-e')).toEqual(payload);
    expect(await request(fetch)).toMatchObject({
      url: `http://review.test/internal/v1/review/referrals/${referralId}/icms-payload`,
      method: 'GET',
      headers: { 'x-acting-tenant': 'psc', 'x-acting-subject': 'analyst-e' },
    });
    expect(await client.referralIcmsPayload('psc', referralId, 'analyst-e')).toBeNull();
    // 409: no roster record of the declarant; sending it again changes nothing.
    await expect(client.referralIcmsPayload('psc', referralId, 'analyst-e')).rejects.toBeInstanceOf(
      InternalApiRejected,
    );
  });
});

describe('HttpIntegrationGatewayClient', () => {
  const referral = {
    referralReference: 'RFL-PSC-2028-0000001-5',
    nationalId: '12345678',
    fullName: 'Declarant Achieng',
    referringCommission: 'PSC',
    grounds: 'Two missed declaration cycles',
    details: 'Missed two cycles.',
  };
  const registered = {
    referralReference: referral.referralReference,
    caseNumber: 'ICMS/2028/000001',
    status: 'registered',
    registeredAt: '2028-03-10T08:00:00.000Z',
    sentAt: '2028-03-10T08:00:00.000Z',
  };

  it('submits a referral to ICMS with the legal basis (201 and 200 alike)', async () => {
    const fetch = vi
      .fn<Fetch>()
      .mockResolvedValueOnce(Response.json(registered, { status: 201 }))
      .mockResolvedValueOnce(Response.json(registered, { status: 200 }));
    const client = new HttpIntegrationGatewayClient({
      gatewayUrl: 'http://gateway.test',
      tokens,
      fetch,
    });

    expect(await client.submitReferral(referral)).toEqual(registered);
    expect(await client.submitReferral(referral)).toEqual(registered);
    expect(await request(fetch)).toMatchObject({
      url: 'http://gateway.test/internal/v1/icms/referrals',
      method: 'POST',
      headers: { 'x-legal-basis': ICMS_LEGAL_BASIS },
      body: referral,
    });
  });

  it('is unavailable while ICMS is down (503) and rejected on a 400 or a 409', async () => {
    const fetch = vi
      .fn<Fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 400 }))
      .mockResolvedValueOnce(new Response(null, { status: 409 }));
    const client = new HttpIntegrationGatewayClient({
      gatewayUrl: 'http://gateway.test',
      tokens,
      fetch,
    });

    await expect(client.submitReferral(referral)).rejects.toBeInstanceOf(
      IntegrationGatewayUnavailable,
    );
    await expect(client.submitReferral(referral)).rejects.toBeInstanceOf(InternalApiRejected);
    await expect(client.submitReferral(referral)).rejects.toBeInstanceOf(InternalApiRejected);
  });

  it('reads a registration by referral reference; null for none', async () => {
    const fetch = vi
      .fn<Fetch>()
      .mockResolvedValueOnce(Response.json({ ...registered, status: 'pending', caseNumber: null }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    const client = new HttpIntegrationGatewayClient({
      gatewayUrl: 'http://gateway.test',
      tokens,
      fetch,
    });

    expect(await client.getReferral(referral.referralReference)).toMatchObject({
      status: 'pending',
      caseNumber: null,
    });
    expect(await request(fetch)).toMatchObject({
      url: 'http://gateway.test/internal/v1/icms/referrals/RFL-PSC-2028-0000001-5',
      method: 'GET',
    });
    expect(await client.getReferral(referral.referralReference)).toBeNull();
  });
});

describe('HttpAiGatewayClient', () => {
  const task: TaskRequest = {
    tenant: 'eacc',
    dataClass: 'restricted',
    subjectRef: 'national-report:0199b000-0000-7000-8000-0000000000c1',
    promptVersion: 1,
    input: {
      kind: 'narrate-compliance-report',
      fy: 2028,
      totals: { commissions: 1 },
      rates: { filingRate: 0.9 },
      commissionTable: [{ code: 'psc', commissionName: 'Public Service Commission', figures: {} }],
      priorYears: [],
      candidates: [],
      section: 'overview',
      language: 'en',
    },
  };
  const job = {
    id: '0199b000-0000-7000-8000-0000000000a1',
    task: 'narrate-compliance-report',
    tenant: 'eacc',
    subjectRef: task.subjectRef,
    status: 'succeeded',
    reason: null,
    promptVersion: 1,
    output: { label: {}, paragraphs: [] },
    createdAt: '2028-08-20T08:00:00.000Z',
    finishedAt: '2028-08-20T08:00:05.000Z',
  };
  const key = '0199b000-0000-7000-8000-0000000000a9';
  const client = (fetch: Fetch) =>
    new HttpAiGatewayClient({ gatewayUrl: 'http://ai.test', tokens, fetch });

  it('posts the task for EACC with the idempotency key and the wait, and answers the job', async () => {
    const fetch = vi.fn<Fetch>().mockResolvedValueOnce(Response.json(job, { status: 200 }));

    const answer = await client(fetch).runTask('narrate-compliance-report', task, key, {
      waitSeconds: 20,
    });

    expect(answer).toMatchObject({ id: job.id, status: 'succeeded', output: job.output });
    const { tenant, ...body } = task;
    expect(await request(fetch)).toMatchObject({
      url: 'http://ai.test/internal/v1/tasks/narrate-compliance-report',
      method: 'POST',
      headers: { 'idempotency-key': key, 'x-acting-tenant': tenant },
      body: { ...body, waitSeconds: 20 },
    });
  });

  it('refuses a wait over 20 s; unavailable on a 503 or 429, rejected on a 4xx', async () => {
    const fetch = vi
      .fn<Fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(new Response(null, { status: 422 }));
    const gateway = client(fetch);

    expect(() =>
      gateway.runTask('narrate-compliance-report', task, key, { waitSeconds: 21 }),
    ).toThrow(RangeError);
    for (const error of [AiGatewayUnavailable, AiGatewayUnavailable, InternalApiRejected]) {
      await expect(gateway.runTask('narrate-compliance-report', task, key)).rejects.toBeInstanceOf(
        error,
      );
    }
  });

  it('reads a job for the tenant; null for none', async () => {
    const fetch = vi
      .fn<Fetch>()
      .mockResolvedValueOnce(Response.json({ ...job, status: 'running', output: null }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));

    expect(await client(fetch).getJob('eacc', job.id)).toMatchObject({ status: 'running' });
    expect(await request(fetch)).toMatchObject({
      url: `http://ai.test/internal/v1/jobs/${job.id}`,
      method: 'GET',
      headers: { 'x-acting-tenant': 'eacc' },
    });
    expect(await client(fetch).getJob('eacc', job.id)).toBeNull();
  });
});

describe('HttpDirectoryClient', () => {
  it('reads staff with a role of the Commission', async () => {
    const fetch = vi.fn<Fetch>(() =>
      Promise.resolve(
        Response.json({ items: [{ subject: 'sub-1', email: 'supervisor@psc.go.ke' }] }),
      ),
    );
    const client = new HttpDirectoryClient({
      directoryUrl: 'http://directory.test',
      tokens,
      fetch,
    });

    expect(await client.staffWithRole('psc', 'supervisor')).toEqual([
      { subject: 'sub-1', email: 'supervisor@psc.go.ke' },
    ]);
    expect((await request(fetch)).url).toBe(
      'http://directory.test/internal/v1/commissions/psc/staff?role=supervisor',
    );
  });

  it('reads a Commission once, then from its cache until it expires', async () => {
    const fetch = vi.fn<Fetch>(() =>
      Promise.resolve(
        Response.json({ slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission' }),
      ),
    );
    let now = 0;
    const client = new HttpDirectoryClient({
      directoryUrl: 'http://directory.test',
      tokens,
      fetch,
      cacheTtlMs: 1_000,
      now: () => now,
    });

    await client.getCommission('psc');
    await client.getCommission('psc');
    expect(fetch).toHaveBeenCalledOnce();
    expect(await request(fetch)).toMatchObject({
      url: 'http://directory.test/internal/v1/commissions/psc',
      headers: { 'x-acting-tenant': 'psc' },
    });
    now = 1_001;
    await client.getCommission('psc');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('lists every Commission as platform reference data, acting for no tenant', async () => {
    const fetch = vi.fn<Fetch>(() =>
      Promise.resolve(
        Response.json({
          items: [
            { slug: 'jsc', issuerCode: 'JSC', name: 'Judicial Service Commission', type: 'hosted' },
            { slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission', type: 'hosted' },
          ],
        }),
      ),
    );
    const client = new HttpDirectoryClient({
      directoryUrl: 'http://directory.test',
      tokens,
      fetch,
    });

    expect(await client.listCommissions()).toEqual([
      { slug: 'jsc', issuerCode: 'JSC', name: 'Judicial Service Commission' },
      { slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission' },
    ]);
    const sent = await request(fetch);
    expect(sent.url).toBe('http://directory.test/internal/v1/commissions');
    // Platform reference data: no tenant to act for.
    expect(sent.headers).not.toHaveProperty('x-acting-tenant');
  });

  it('is unavailable when the Commission list is outside its contract', async () => {
    const fetch = vi.fn<Fetch>(() => Promise.resolve(Response.json({ items: [{ slug: 'psc' }] })));
    const client = new HttpDirectoryClient({
      directoryUrl: 'http://directory.test',
      tokens,
      fetch,
    });

    await expect(client.listCommissions()).rejects.toBeInstanceOf(DirectoryUnavailable);
  });
});

describe('HttpNotificationsClient', () => {
  it('sends a templated email to an address with the idempotency key', async () => {
    const fetch = vi.fn<Fetch>(() =>
      Promise.resolve(
        Response.json(
          { id: '0199b000-0000-7000-8000-0000000000e1', status: 'sent', error: null },
          { status: 201 },
        ),
      ),
    );
    const client = new HttpNotificationsClient({
      notificationsUrl: 'http://notifications.test',
      tokens,
      fetch,
    });

    const sent = await client.send({
      to: 'supervisor@psc.go.ke',
      template: 'form-m-draft-ready-email',
      params: { financialYear: '2027/2028', dueDate: '2028-07-31' },
      tenant: 'psc',
      idempotencyKey: 'key-1',
    });

    expect(sent.status).toBe('sent');
    expect(await request(fetch)).toMatchObject({
      url: 'http://notifications.test/internal/v1/messages',
      headers: { 'idempotency-key': 'key-1' },
      body: {
        channel: 'email',
        recipient: { kind: 'address', to: 'supervisor@psc.go.ke' },
        template: 'form-m-draft-ready-email',
        tenant: 'psc',
      },
    });
  });
});

describe('HttpDocumentsClient', () => {
  const request0 = {
    type: 'compliance-report-receipt',
    templateVersion: 1,
    issuerTenant: 'psc',
    subjectRef: 'compliance-report:0199b000-0000-7000-8000-00000000a001',
    subjectPersonId: null,
    payload: {
      reference: 'RPT-PSC-2027-0000001-4',
      sha256: '3f'.repeat(32),
      submittedAt: '2028-07-20T07:00:00.000Z',
      commissionName: 'Public Service Commission',
      issuerCode: 'PSC',
      financialYear: '2027/2028',
      dueDate: '2028-07-31',
      late: false,
      source: 'hosted',
    },
    idempotencyKey: '5b2d8e61-9c4f-4a07-8e13-6f2a9d4c7b18',
  } as const;

  it('issues a document for the Commission with the idempotency key, the tenant in X-Acting-Tenant only', async () => {
    const fetch = vi.fn<Fetch>(() =>
      Promise.resolve(
        Response.json(
          { id: '0199b000-0000-7000-8000-00000000d001', verificationId: 'ADL-7Q4K' },
          { status: 201 },
        ),
      ),
    );
    const client = new HttpDocumentsClient({
      documentsUrl: 'http://documents.test',
      tokens,
      fetch,
    });

    const issued = await client.issue(request0);

    expect(issued).toEqual({
      id: '0199b000-0000-7000-8000-00000000d001',
      verificationId: 'ADL-7Q4K',
    });
    const { idempotencyKey, issuerTenant, ...body } = request0;
    expect(await request(fetch)).toEqual({
      url: 'http://documents.test/internal/v1/documents/issue',
      method: 'POST',
      headers: expect.objectContaining({
        'x-acting-tenant': issuerTenant,
        'idempotency-key': idempotencyKey,
      }) as Record<string, string>,
      body,
    });
  });

  it('is rejected when documents refuses the request', async () => {
    const fetch = vi.fn<Fetch>(() => Promise.resolve(new Response(null, { status: 400 })));
    const client = new HttpDocumentsClient({
      documentsUrl: 'http://documents.test',
      tokens,
      fetch,
    });

    await expect(client.issue(request0)).rejects.toBeInstanceOf(InternalApiRejected);
  });

  const revocation = {
    documentId: '0199b000-0000-7000-8000-00000000d001',
    issuerTenant: 'eacc',
    reason: 'withdrawn',
    idempotencyKey: '7c1e4b52-0d3a-4f86-9b27-3e5a8d1c6f40',
  } as const;

  const clientAnswering = (response: () => Response) => {
    const fetch = vi.fn<Fetch>(() => Promise.resolve(response()));
    return {
      fetch,
      client: new HttpDocumentsClient({ documentsUrl: 'http://documents.test', tokens, fetch }),
    };
  };

  it('revokes a document of the tenant with the reason and the idempotency key', async () => {
    const { fetch, client } = clientAnswering(() =>
      Response.json({ id: revocation.documentId, verificationId: 'ADL-7Q4K' }),
    );

    await client.revoke(revocation);

    expect(await request(fetch)).toEqual({
      url: `http://documents.test/internal/v1/documents/${revocation.documentId}/revoke`,
      method: 'POST',
      headers: expect.objectContaining({
        'x-acting-tenant': 'eacc',
        'idempotency-key': revocation.idempotencyKey,
      }) as Record<string, string>,
      body: { reason: 'withdrawn' },
    });
  });

  it('takes a document revoked already as done', async () => {
    const { client } = clientAnswering(() =>
      Response.json({ type: 'document-revoked', status: 409 }, { status: 409 }),
    );

    await expect(client.revoke(revocation)).resolves.toBeUndefined();
  });

  it('is rejected when documents refuses the revocation, unavailable when it fails', async () => {
    for (const status of [400, 403, 404, 422]) {
      const { client } = clientAnswering(() => new Response(null, { status }));
      await expect(client.revoke(revocation), String(status)).rejects.toBeInstanceOf(
        InternalApiRejected,
      );
    }
    const { client } = clientAnswering(() => new Response(null, { status: 502 }));
    await expect(client.revoke(revocation)).rejects.toBeInstanceOf(DocumentsUnavailable);
  });
});
