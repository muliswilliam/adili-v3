import { describe, expect, it, vi } from 'vitest';

import { DeclarationsUnavailable } from '../../src/declarations/declarations-client.js';
import { HttpDeclarationsClient } from '../../src/declarations/http-declarations-client.js';
import { HttpDirectoryClient } from '../../src/directory/http-directory-client.js';
import { HttpDocumentsClient } from '../../src/documents/http-documents-client.js';
import { InternalApiRejected } from '../../src/internal-api/internal-api.js';
import { HttpNotificationsClient } from '../../src/notifications/http-notifications-client.js';
import { HttpReviewClient } from '../../src/review/http-review-client.js';

const tokens = { token: () => Promise.resolve('token'), invalidate: vi.fn() };

type Fetch = typeof globalThis.fetch;

/** The URL, headers and JSON body of the n-th call of a fetch mock. */
function request(fetch: ReturnType<typeof vi.fn<Fetch>>, n = 0) {
  const [url, init] = fetch.mock.calls[n] ?? [];
  return {
    url: (url as URL).href,
    method: init?.method,
    headers: init?.headers as Record<string, string>,
    body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
  };
}

describe('HttpDeclarationsClient', () => {
  it('pulls officer details in pages of 1,000 obligation ids for the Commission', async () => {
    const fetch = vi.fn<Fetch>((_url, init) => {
      const { obligationIds } = JSON.parse(init?.body as string) as { obligationIds: string[] };
      return Promise.resolve(
        Response.json({
          items: obligationIds.slice(0, 1).map((obligationId) => ({
            obligationId,
            name: 'Officer Kamau',
            designation: 'Clerk',
            fileNumber: 'PSC/1',
            appointmentDate: '2020-01-01',
            exitDate: null,
          })),
        }),
      );
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
    expect(request(fetch, 0)).toMatchObject({
      url: 'http://declarations.test/internal/v1/obligations/details',
      method: 'POST',
      headers: { 'x-acting-tenant': 'psc', authorization: 'Bearer token' },
    });
    expect((request(fetch, 1).body as { obligationIds: string[] }).obligationIds).toHaveLength(500);
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
    expect(request(fetch)).toMatchObject({
      url: 'http://review.test/internal/v1/review/clarifications/details',
      body: { clarificationIds: [clarificationId] },
    });
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
    expect(request(fetch).url).toBe(
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
    now = 1_001;
    await client.getCommission('psc');
    expect(fetch).toHaveBeenCalledTimes(2);
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
    expect(request(fetch)).toMatchObject({
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
    disclosureLevel: 'restricted',
    issuerTenant: 'psc',
    subjectRef: 'compliance-report:0199b000-0000-7000-8000-00000000a001',
    subjectPersonId: null,
    payload: { reference: 'RPT-PSC-2027-0000001-4' },
    publicPayload: {
      reference: 'RPT-PSC-2027-0000001-4',
      type: 'compliance-report-receipt',
      issuer: 'PSC',
      issuedAt: '2028-07-20T07:00:00.000Z',
    },
    idempotencyKey: '5b2d8e61-9c4f-4a07-8e13-6f2a9d4c7b18',
  } as const;

  it('issues a document for the Commission with the idempotency key', async () => {
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
    const { idempotencyKey, ...body } = request0;
    expect(request(fetch)).toEqual({
      url: 'http://documents.test/internal/v1/documents/issue',
      method: 'POST',
      headers: expect.objectContaining({
        'x-acting-tenant': 'psc',
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
});
