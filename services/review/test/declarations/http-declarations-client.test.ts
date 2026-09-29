import { describe, expect, it, vi } from 'vitest';

import { DeclarationsUnavailable } from '../../src/declarations/declarations-client.js';
import { HttpDeclarationsClient } from '../../src/declarations/http-declarations-client.js';

const DECLARATION = '0199b000-0000-7000-8000-000000000001';
const VERSION = '0199b000-0000-7000-8000-000000000002';
const PERSON = '0199b000-0000-7000-8000-000000000003';
const CASE = '0199b000-0000-7000-8000-000000000004';
const ROSTER_RECORD = '0199b000-0000-7000-8000-000000000005';
const REPORTING_ENTITY = '0199b000-0000-7000-8000-000000000006';

const document = {
  declarationId: DECLARATION,
  versionId: VERSION,
  version: 1,
  personId: PERSON,
  rosterRecordId: ROSTER_RECORD,
  reportingEntityId: REPORTING_ENTITY,
  reference: 'DEC-PSC-2027-0000001-7',
  type: 'biennial',
  statementDate: '2027-11-01',
  submittedAt: '2027-12-10T09:00:00.000Z',
  late: false,
  dueDate: '2027-12-31',
  declarantName: 'James Otieno',
  personnelFileNumber: 'PSC/0001',
  document: { schemaVersion: 'declaration.v1' },
  attachments: [],
};

function client(...responses: Response[]) {
  const fetch = vi.fn<typeof globalThis.fetch>();
  for (const response of responses) fetch.mockResolvedValueOnce(response);
  const tokens = { token: vi.fn(() => Promise.resolve('service-token')), invalidate: vi.fn() };
  return {
    fetch,
    tokens,
    declarations: new HttpDeclarationsClient({
      declarationsUrl: 'http://declarations.test/',
      tokens,
      fetch,
    }),
  };
}

const json = (body: unknown, status = 200) => Response.json(body, { status });

describe('HttpDeclarationsClient', () => {
  it('reads a version document with the service token, the tenant, the acting subject and the case', async () => {
    const { declarations, fetch } = client(json(document));

    const pulled = await declarations.getVersionDocument(DECLARATION, 1, {
      tenant: 'psc',
      actingSubject: 'reviewer-a',
      caseId: CASE,
    });

    expect(pulled).toEqual(document);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect((url as URL).href).toBe(
      `http://declarations.test/internal/v1/declarations/${DECLARATION}/versions/1/document`,
    );
    expect(init?.headers).toMatchObject({
      authorization: 'Bearer service-token',
      'x-acting-tenant': 'psc',
      'x-acting-subject': 'reviewer-a',
      'x-review-case': CASE,
    });
  });

  it('looks up the previous version by person, tenant and version; 404 is none', async () => {
    const previous = {
      declarationId: DECLARATION,
      versionId: VERSION,
      version: 1,
      statementDate: '2025-11-01',
      submittedAt: '2025-12-01T09:00:00.000Z',
    };
    const { declarations, fetch } = client(json(previous), json({ title: 'Not Found' }, 404));

    expect(await declarations.findPreviousVersion(PERSON, 'psc', VERSION)).toEqual(previous);
    expect(await declarations.findPreviousVersion(PERSON, 'psc', VERSION)).toBeNull();
    const url = fetch.mock.calls[0]?.[0] as URL;
    expect(url.pathname).toBe('/internal/v1/declarations/previous-version');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      personId: PERSON,
      tenant: 'psc',
      beforeVersionId: VERSION,
    });
  });

  it('reads a filing obligation with the Commission as acting tenant; 404 is none', async () => {
    const obligation = {
      obligationId: VERSION,
      rosterRecordId: CASE,
      personId: PERSON,
      type: 'biennial',
      cycleKey: 'biennial:2027',
      dueDate: '2027-12-31',
      status: 'overdue',
      declarantName: 'James Otieno',
      personnelFileNumber: 'PSC/0001',
    };
    const { declarations, fetch } = client(json(obligation), new Response(null, { status: 404 }));

    expect(await declarations.getObligation(VERSION, 'psc')).toEqual(obligation);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect((url as URL).href).toBe(`http://declarations.test/internal/v1/obligations/${VERSION}`);
    expect(init?.headers).toMatchObject({ 'x-acting-tenant': 'psc' });
    expect(await declarations.getObligation(VERSION, 'psc')).toBeNull();
  });

  it("S16: reads a person's obligation history at the Commission; 404 is none", async () => {
    const history = [
      {
        obligationId: VERSION,
        type: 'biennial',
        cycleKey: 'biennial:2025',
        status: 'overdue',
        dueDate: '2025-12-31',
        filedAt: null,
        late: false,
      },
      {
        obligationId: CASE,
        type: 'biennial',
        cycleKey: 'biennial:2027',
        status: 'filed',
        dueDate: '2027-12-31',
        filedAt: '2027-12-20T09:00:00.000Z',
        late: false,
      },
    ];
    const { declarations, fetch } = client(json(history), new Response(null, { status: 404 }));

    expect(await declarations.listPersonObligations(PERSON, 'psc')).toEqual(history);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect((url as URL).href).toBe(
      `http://declarations.test/internal/v1/persons/${PERSON}/obligations?tenant=psc`,
    );
    expect(init?.headers).toMatchObject({
      authorization: 'Bearer service-token',
      'x-acting-tenant': 'psc',
    });
    expect(await declarations.listPersonObligations(PERSON, 'psc')).toEqual([]);
  });

  it('a person obligation history outside the contract is unavailable', async () => {
    const { declarations } = client(json([{ obligationId: VERSION, status: 'late' }]));

    await expect(declarations.listPersonObligations(PERSON, 'psc')).rejects.toThrow(
      DeclarationsUnavailable,
    );
  });

  it('retries once with a fresh token after a 401', async () => {
    const { declarations, tokens, fetch } = client(json({}, 401), json(document));

    await declarations.getVersionDocument(DECLARATION, 1, {
      tenant: 'psc',
      actingSubject: 'system:review',
    });

    expect(tokens.invalidate).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('is unavailable on a server error, an unreachable service or a body outside the contract', async () => {
    const context = { tenant: 'psc', actingSubject: 'system:review' };
    const failing = client(json({}, 503));
    await expect(failing.declarations.getVersionDocument(DECLARATION, 1, context)).rejects.toThrow(
      DeclarationsUnavailable,
    );

    const offContract = client(json({ ...document, personId: 'not-a-uuid' }));
    await expect(
      offContract.declarations.getVersionDocument(DECLARATION, 1, context),
    ).rejects.toThrow(DeclarationsUnavailable);

    const unreachable = client();
    unreachable.fetch.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(
      unreachable.declarations.getVersionDocument(DECLARATION, 1, context),
    ).rejects.toThrow(DeclarationsUnavailable);
  });
});
