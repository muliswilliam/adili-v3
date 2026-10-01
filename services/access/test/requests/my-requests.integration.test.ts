import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { ACCESS_OFFICER, APPLICANT, DECLARANT } from '@adili/roles';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { accessRegister, accessRequests } from '../../src/db/schema.js';
import type { AccessRequestStatus } from '../../src/requests/schema.js';
import { type AccessApi, type Caller, startAccessApi } from '../support/access-api.js';
import { contractErrors, okResponse } from '../support/contract.js';

const fixtures = createRequire(import.meta.url);
const COMPLETE = JSON.parse(
  readFileSync(
    fixtures.resolve('@adili/schemas/forms/fixtures/form-k.v1/valid/complete.json'),
    'utf8',
  ),
) as Record<string, unknown>;

const NOW = '2027-03-04T09:00:00.000Z';

interface Request {
  id: string;
  reference: string;
  status: string;
  formK: Record<string, unknown>;
  timeline: { kind: string; actor: string | null }[];
}

describe('My requests and withdraw (S8)', () => {
  let api: AccessApi;
  const mercy: Caller = {
    sub: 'applicant-mercy',
    roles: [APPLICANT],
    personId: randomUUID(),
    name: 'Mercy Wanjiku Kamau',
  };
  const other: Caller = { sub: 'applicant-other', roles: [APPLICANT], personId: randomUUID() };

  beforeAll(async () => {
    api = await startAccessApi();
    return () => api.close();
  });

  afterEach(() => api.reset());

  function given(): void {
    api.directory.givenCommission('psc', 'Public Service Commission');
    api.directory.givenCommission('tsc', 'Teachers Service Commission');
    api.directory.givenApplicant(mercy.personId ?? '');
    api.directory.givenApplicant(other.personId ?? '');
    api.clock.set(NOW);
  }

  async function submit(caller: Caller = mercy, body: unknown = COMPLETE): Promise<Request> {
    const response = await api.send('POST', '/v1/access/requests', caller, body, {
      'idempotency-key': randomUUID(),
    });
    expect(response.statusCode).toBe(201);
    return response.json<Request>();
  }

  async function setStatus(id: string, status: AccessRequestStatus): Promise<void> {
    await api.asPlatform((tx) =>
      tx.update(accessRequests).set({ status }).where(eq(accessRequests.id, id)),
    );
  }

  const withdraw = (id: string, caller: Caller = mercy) =>
    api.send('POST', `/v1/access/requests/${id}/withdraw`, caller);

  it("lists the applicant's own requests, latest first, with their Form K", async () => {
    given();
    const first = await submit();
    api.clock.set('2027-03-05T09:00:00.000Z');
    const second = await submit(mercy, { ...COMPLETE, responsibleCommission: 'tsc' });
    await submit(other);

    const response = await api.get('/v1/access/requests', mercy);

    expect(response.statusCode).toBe(200);
    const body = response.json<Request[]>();
    expect(contractErrors(okResponse('/v1/access/requests', 'get'), body)).toEqual([]);
    expect(body.map((request) => request.id)).toEqual([second.id, first.id]);
    expect(body[1]).toEqual(first);
    expect(body[0]?.formK).toMatchObject({ responsibleCommission: 'tsc' });
  });

  it('lists nothing for an applicant without requests', async () => {
    given();
    await submit();

    const response = await api.get('/v1/access/requests', other);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });

  it('gets one of their requests; another applicant gets 404', async () => {
    given();
    const request = await submit();

    const own = await api.get(`/v1/access/requests/${request.id}`, mercy);
    const theirs = await api.get(`/v1/access/requests/${request.id}`, other);
    const none = await api.get(`/v1/access/requests/${randomUUID()}`, mercy);

    expect(own.statusCode).toBe(200);
    expect(
      contractErrors(okResponse('/v1/access/requests/{requestId}', 'get'), own.json()),
    ).toEqual([]);
    expect(own.json()).toEqual(request);
    expect(theirs.statusCode).toBe(404);
    expect(none.statusCode).toBe(404);
  });

  it('only applicants read requests: a declarant or an access officer gets 403', async () => {
    given();
    const request = await submit();

    const declarant = { sub: 'd', roles: [DECLARANT], personId: mercy.personId };
    const officer = { sub: 'o', roles: [ACCESS_OFFICER], tenant: 'psc' };
    for (const caller of [declarant, officer]) {
      expect((await api.get('/v1/access/requests', caller)).statusCode).toBe(403);
      expect((await api.get(`/v1/access/requests/${request.id}`, caller)).statusCode).toBe(403);
      expect((await withdraw(request.id, caller)).statusCode).toBe(403);
    }
  });

  it("the applicant's timeline names only them and leaves out the declarant's representations", async () => {
    given();
    const request = await submit();
    await api.asTenant({ tenant: 'psc', subject: 'test' }, (tx) =>
      tx
        .insert(accessRegister)
        .values([
          registerRow(request, 'notified', null, null, '2027-03-06T09:00:00.000Z'),
          registerRow(
            request,
            'representations',
            'declarant-anne',
            'Anne Njeri Mutua',
            '2027-03-07T09:00:00.000Z',
          ),
          registerRow(request, 'decided', 'officer-1', 'Peter Access', '2027-03-20T09:00:00.000Z'),
        ]),
    );

    const response = await api.get(`/v1/access/requests/${request.id}`, mercy);

    expect(response.json<Request>().timeline).toEqual([
      expect.objectContaining({ kind: 'received', actor: 'Mercy Wanjiku Kamau' }),
      expect.objectContaining({ kind: 'notified', actor: null }),
      expect.objectContaining({ kind: 'decided', actor: null }),
    ]);
  });

  it.each([
    'submitted',
    'pending-applicant-verification',
    'officer-unresolved',
    'awaiting-representations',
    'under-decision',
  ] as const)(
    'S8: a request %s is withdrawn, with its register entry and event',
    async (status) => {
      given();
      const request = await submit();
      await setStatus(request.id, status);
      api.clock.set('2027-03-06T10:00:00.000Z');

      const response = await withdraw(request.id);

      expect(response.statusCode).toBe(200);
      const body = response.json<Request>();
      expect(
        contractErrors(okResponse('/v1/access/requests/{requestId}/withdraw', 'post'), body),
      ).toEqual([]);
      expect(body.status).toBe('withdrawn');
      expect(body.timeline).toEqual([
        expect.objectContaining({ kind: 'received' }),
        expect.objectContaining({
          kind: 'withdrawn',
          actor: 'Mercy Wanjiku Kamau',
          summary: 'Request withdrawn',
        }),
      ]);
      const [row] = await api.asPlatform((tx) => tx.select().from(accessRequests));
      expect(row?.status).toBe('withdrawn');
      const events = await api.events('access.request.withdrawn.v1');
      expect(events).toEqual([
        expect.objectContaining({
          tenant: 'psc',
          subject: request.id,
          data: expect.objectContaining({
            kind: 'withdrawn',
            reference: request.reference,
            actor: 'applicant-mercy',
            at: '2027-03-06T10:00:00.000Z',
            legalBasis: 'act-s36-1',
          }) as unknown,
        }),
      ]);
    },
  );

  it.each(['granted', 'partially-granted', 'denied'] as const)(
    'S8: a %s request cannot be withdrawn: 409 request-decided, nothing changes',
    async (status) => {
      given();
      const request = await submit();
      await setStatus(request.id, status);

      const response = await withdraw(request.id);

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: 'request-decided' });
      await expectUnchanged(request.id, status);
    },
  );

  it.each(['withdrawn', 'cannot-identify'] as const)(
    'S8: a %s request is closed: 409 request-closed',
    async (status) => {
      given();
      const request = await submit();
      await setStatus(request.id, status);

      const response = await withdraw(request.id);

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: 'request-closed' });
      await expectUnchanged(request.id, status);
    },
  );

  it("another applicant cannot withdraw someone's request: 404", async () => {
    given();
    const request = await submit();

    const response = await withdraw(request.id, other);

    expect(response.statusCode).toBe(404);
    await expectUnchanged(request.id, 'submitted');
  });

  it('withdrawing twice: the second is 409 request-closed', async () => {
    given();
    const request = await submit();

    expect((await withdraw(request.id)).statusCode).toBe(200);
    const again = await withdraw(request.id);

    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: 'request-closed' });
    expect(await api.events('access.request.withdrawn.v1')).toHaveLength(1);
  });

  async function expectUnchanged(id: string, status: AccessRequestStatus): Promise<void> {
    const [row] = await api.asPlatform((tx) =>
      tx.select().from(accessRequests).where(eq(accessRequests.id, id)),
    );
    expect(row?.status).toBe(status);
    expect(await api.events('access.request.withdrawn.v1')).toEqual([]);
  }
});

function registerRow(
  request: Request,
  kind: 'notified' | 'representations' | 'decided',
  actor: string | null,
  actorName: string | null,
  at: string,
): typeof accessRegister.$inferInsert {
  return {
    id: randomUUID(),
    tenant: 'psc',
    subjectKind: 'access-request',
    subjectId: request.id,
    reference: request.reference,
    personId: null,
    kind,
    actor,
    actorName,
    legalBasis: 'act-s36-1',
    at: new Date(at),
  };
}
