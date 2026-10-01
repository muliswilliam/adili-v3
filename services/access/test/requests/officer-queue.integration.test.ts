import { randomUUID } from 'node:crypto';

import { APPLICANT } from '@adili/roles';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { accessRequests } from '../../src/db/schema.js';
import type { QueuePage } from '../../src/requests/officer-representation.js';
import type { OfficerRequestView } from '../../src/requests/officer-view.js';
import type { AccessRequestStatus } from '../../src/requests/schema.js';
import { type AccessApi, type Caller, startAccessApi } from '../support/access-api.js';
import { contractErrors, okResponse } from '../support/contract.js';
import { callers, COMPLETE, givenCommissions, submitRequest } from '../support/requests.js';

const NOW = '2027-03-04T09:00:00.000Z';
const QUEUE = '/v1/commissions/psc/access/requests';

describe("The Commission's queue and a request as its access officer reads it (S16)", () => {
  let api: AccessApi;
  const { officer, supervisor, tscOfficer, eacc } = callers;

  beforeAll(async () => {
    api = await startAccessApi();
    return () => api.close();
  });

  afterEach(() => api.reset());

  /** Requests received a day apart from `NOW` on, so their deadlines are a day apart too. */
  async function received(count: number): Promise<string[]> {
    const ids: string[] = [];
    for (let day = 0; day < count; day += 1) {
      api.clock.set(new Date(Date.parse(NOW) + day * 24 * 60 * 60 * 1000).toISOString());
      ids.push((await submitRequest(api)).id);
    }
    return ids;
  }

  async function setStatus(id: string, status: AccessRequestStatus): Promise<void> {
    await api.asPlatform((tx) =>
      tx.update(accessRequests).set({ status }).where(eq(accessRequests.id, id)),
    );
  }

  const queue = (query = '', caller: Caller = officer) => api.get(`${QUEUE}${query}`, caller);

  it('lists requests earliest deadline first with what the officer works from', async () => {
    givenCommissions(api, NOW);
    const [first, second] = await received(2);

    const response = await queue();

    expect(response.statusCode, response.body).toBe(200);
    const page = response.json<QueuePage>();
    expect(
      contractErrors(okResponse('/v1/commissions/{slug}/access/requests', 'get'), page),
    ).toEqual([]);
    expect(page.items.map((item) => item.id)).toEqual([first, second]);
    expect(page.items[0]).toEqual({
      kind: 'form-k',
      id: first,
      reference: expect.stringMatching(/^ARQ-PSC-2027-0000001-/) as unknown,
      applicantOrAgency: 'Mercy Wanjiku Kamau',
      officerSought: 'Anne Njeri Mutua',
      resolvedName: null,
      status: 'submitted',
      submittedAt: NOW,
      deadlineAt: '2027-04-03T09:00:00.000Z',
      windowEndsAt: null,
      late: false,
    });
    expect(page.nextCursor).toBeNull();
  });

  it('pages by deadline with the cursor', async () => {
    givenCommissions(api, NOW);
    const ids = await received(3);

    const first = (await queue('?limit=2')).json<QueuePage>();
    const second = (
      await queue(`?limit=2&cursor=${encodeURIComponent(first.nextCursor ?? '')}`)
    ).json<QueuePage>();

    expect(first.items.map((item) => item.id)).toEqual(ids.slice(0, 2));
    expect(second.items.map((item) => item.id)).toEqual(ids.slice(2));
    expect(second.nextCursor).toBeNull();
  });

  it('flags a request late once its deadline passed undecided, but not a closed one', async () => {
    givenCommissions(api, NOW);
    const [open, withdrawn] = await received(2);
    await setStatus(withdrawn ?? '', 'withdrawn');
    api.clock.set('2027-04-10T09:00:00.000Z');

    const page = (await queue()).json<QueuePage>();

    expect(page.items.map((item) => [item.id, item.late])).toEqual([
      [open, true],
      [withdrawn, false],
    ]);
  });

  it('filters by status, one or several', async () => {
    givenCommissions(api, NOW);
    const [submitted, unresolved, withdrawn] = await received(3);
    await setStatus(unresolved ?? '', 'officer-unresolved');
    await setStatus(withdrawn ?? '', 'withdrawn');

    const open = (await queue('?status=submitted,officer-unresolved')).json<QueuePage>();
    const closed = (await queue('?status=withdrawn')).json<QueuePage>();
    const bad = await queue('?status=submitted,lost');

    expect(open.items.map((item) => item.id)).toEqual([submitted, unresolved]);
    expect(closed.items.map((item) => item.id)).toEqual([withdrawn]);
    expect(bad.statusCode).toBe(400);
  });

  it('has no law enforcement requests yet, and answers 400 for an unknown cursor', async () => {
    givenCommissions(api, NOW);
    await received(1);

    expect((await queue('?kind=lea')).json<QueuePage>().items).toEqual([]);
    expect((await queue('?kind=form-k')).json<QueuePage>().items).toHaveLength(1);
    expect((await queue('?cursor=nonsense')).statusCode).toBe(400);
  });

  it("S16: the supervisor reads the queue; another Commission's officer, EACC and applicants do not", async () => {
    givenCommissions(api, NOW);
    await received(1);
    await submitRequest(api, { ...COMPLETE, responsibleCommission: 'tsc' });

    const asSupervisor = await queue('', supervisor);
    const asTsc = await queue('', tscOfficer);
    const tscQueue = await api.get('/v1/commissions/tsc/access/requests', tscOfficer);
    const asEacc = await queue('', eacc);
    const asApplicant = await queue('', { sub: 'a', roles: [APPLICANT], personId: randomUUID() });

    expect(asSupervisor.json<QueuePage>().items).toHaveLength(1);
    expect(asTsc.statusCode).toBe(404);
    expect(tscQueue.json<QueuePage>().items.map((item) => item.reference)).toEqual([
      expect.stringMatching(/^ARQ-TSC-/) as unknown,
    ]);
    expect(asEacc.statusCode).toBe(404);
    expect(asApplicant.statusCode).toBe(403);
  });

  it('gives the access officer and the supervisor the full request; 404 to anyone else', async () => {
    givenCommissions(api, NOW);
    const { id } = await submitRequest(api);
    const url = `/v1/access/requests/${id}/officer`;

    const response = await api.get(url, officer);
    const asSupervisor = await api.get(url, supervisor);

    expect(response.statusCode, response.body).toBe(200);
    const view = response.json<OfficerRequestView>();
    expect(
      contractErrors(okResponse('/v1/access/requests/{requestId}/officer', 'get'), view),
    ).toEqual([]);
    expect(view).toMatchObject({
      id,
      status: 'submitted',
      applicantIdentityStatus: 'verified',
      resolvedRosterRecordId: null,
      representations: null,
      windowEndsAt: null,
      formK: { partII: { name: 'Anne Njeri Mutua' } },
      timeline: [{ kind: 'received', actor: 'Mercy Wanjiku Kamau' }],
    });
    expect(asSupervisor.statusCode).toBe(200);
    expect((await api.get(url, tscOfficer)).statusCode).toBe(404);
    expect((await api.get(url, eacc)).statusCode).toBe(404);
    expect((await api.get(`/v1/access/requests/${randomUUID()}/officer`, officer)).statusCode).toBe(
      404,
    );
  });
});
