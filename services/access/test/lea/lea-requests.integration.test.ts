import { randomUUID } from 'node:crypto';

import {
  accessRequestDecidedDataSchema,
  accessRequestReceivedDataSchema,
} from '@adili/events/contracts/schemas';
import { hasValidCheckCharacter } from '@adili/numbering';
import { APPLICANT, DECLARANT, LAW_ENFORCEMENT } from '@adili/roles';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { RosterCandidateFacts } from '../../src/directory/directory-client.js';
import { accessRequests, leaRequests } from '../../src/db/schema.js';
import { leaRequestWorkflowId } from '../../src/lea/contract.js';
import type { LeaRequest } from '../../src/lea/representation.js';
import type { QueuePage, RosterCandidates } from '../../src/requests/officer-representation.js';
import { type AccessApi, type Caller, startAccessApi } from '../support/access-api.js';
import { contractErrors, okResponse } from '../support/contract.js';
import {
  decideLea,
  givenLeaOfficers,
  LEA_INPUT,
  leaCallers,
  leaRowOf,
  submitLea,
  submitLeaResponse,
  verifyLea,
} from '../support/lea.js';
import { callers, declarantOf, givenCommissions, submitRequest } from '../support/requests.js';

/** Monday 11 January 2027, 10:00 in Nairobi. */
const NOW = '2027-01-11T07:00:00.000Z';
/** Fourteen days later (Regs r.23). */
const DEADLINE = '2027-01-25T07:00:00.000Z';
const VERIFIED_AT = '2027-01-12T07:00:00.000Z';

const PROVENANCE = {
  accountState: 'activated',
  activatedAt: '2027-01-04T07:00:00.000Z',
  agencyLegalBasis: 'National Police Service Act, 2011, s.35',
};

/**
 * Law enforcement requests through the HTTP interface (S11): an officer's submission and its
 * provenance check, who reads what, the Commission's queue, the access officer's verification and
 * the decision rules. The workflow's part (notices, package, reminders, breach) is in
 * `lea-workflow.integration.test.ts` and `lea-request-workflow.test.ts`.
 */
describe('Law enforcement requests (S11)', () => {
  let api: AccessApi;
  let anne: RosterCandidateFacts;
  const { peter, collins } = leaCallers;
  const { officer, supervisor, tscOfficer, eacc } = callers;

  beforeAll(async () => {
    api = await startAccessApi();
    return () => api.close();
  });

  afterEach(() => api.reset());

  function given(): void {
    ({ anne } = givenCommissions(api, NOW));
    givenLeaOfficers(api);
  }

  /** Received; its workflow stopped, so the test drives every step (no reminder, no notice). */
  async function received(caller: Caller = peter, body: unknown = LEA_INPUT): Promise<LeaRequest> {
    const request = await submitLea(api, body, caller);
    await api.endWorkflows([leaRequestWorkflowId(request.id)]);
    return request;
  }

  async function verified(): Promise<LeaRequest> {
    const request = await received();
    api.clock.set(VERIFIED_AT);
    const response = await verifyLea(api, request.id, anne.id);
    expect(response.statusCode, response.body).toBe(200);
    return response.json();
  }

  describe('submit', () => {
    it('S11: a provisioned officer files a written request: LEA reference, received, a register entry and event, no declarant notification', async () => {
      given();

      const response = await submitLeaResponse(api, LEA_INPUT, peter);

      expect(response.statusCode, response.body).toBe(201);
      const body = response.json<LeaRequest>();
      expect(contractErrors(okResponse('/v1/lea/requests', 'post', 201), body)).toEqual([]);
      expect(body).toEqual({
        id: expect.any(String) as unknown,
        reference: expect.stringMatching(/^LEA-PSC-2027-0000001-[0-9A-Z]$/) as unknown,
        commission: { slug: 'psc', name: 'Public Service Commission' },
        agency: { code: 'DCI', name: 'Directorate of Criminal Investigations' },
        officer: { subject: peter.sub, name: 'Peter Mwangi' },
        provenance: { ...PROVENANCE, checkedAt: NOW },
        officerSought: LEA_INPUT.officerSought,
        reason: LEA_INPUT.reason,
        caseReference: LEA_INPUT.caseReference,
        scope: LEA_INPUT.scope,
        status: 'received',
        receivedAt: NOW,
        deadlineAt: DEADLINE,
        breachedAt: null,
        resolvedRosterRecordId: null,
        resolvedName: null,
        verification: null,
        decision: null,
        declarantNotifiedAt: null,
        package: null,
        timeline: [
          {
            id: expect.any(String) as unknown,
            kind: 'received',
            at: NOW,
            actor: 'Peter Mwangi',
            summary: 'Request received',
            reference: body.reference,
          },
        ],
      });
      expect(hasValidCheckCharacter(body.reference)).toBe(true);

      const row = await leaRowOf(api, body.id);
      expect(row).toMatchObject({
        tenant: 'psc',
        officerPersonId: peter.personId,
        officerSubject: peter.sub,
      });
      const received = await api.events('lea.request.received.v1');
      expect(received).toEqual([
        expect.objectContaining({
          tenant: 'psc',
          subject: body.id,
          data: expect.objectContaining({
            subjectKind: 'lea-request',
            reference: body.reference,
            kind: 'received',
            legalBasis: 'act-s36-2',
            personId: null,
            actor: peter.sub,
            decisionDeadlineAt: DEADLINE,
          }) as unknown,
        }),
      ]);
      // Reporting validates Form K and law enforcement receipts with the same schema (S14).
      expect(accessRequestReceivedDataSchema.safeParse(received[0]?.data).success).toBe(true);
      // The declarant is not told: only after a grant (r.23(2)).
      expect(api.notifications.sent).toEqual([]);
      const run = await api.temporal.workflow.getHandle(leaRequestWorkflowId(body.id)).describe();
      expect(run.status.name).toBe('RUNNING');
    });

    it("references count per Commission and year, whichever agency files; each request carries its officer's agency", async () => {
      given();

      const first = await received();
      const second = await received(collins);
      const tsc = await received({ ...peter, sub: peter.sub }, { ...LEA_INPUT, commission: 'tsc' });

      expect(first.reference).toMatch(/^LEA-PSC-2027-0000001-/);
      expect(second.reference).toMatch(/^LEA-PSC-2027-0000002-/);
      expect(second.agency).toEqual({
        code: 'ODPP',
        name: 'Office of the Director of Public Prosecutions',
      });
      expect(tsc.reference).toMatch(/^LEA-TSC-2027-0000001-/);
    });

    it('refuses an account that is not an active officer account of an agency: 403', async () => {
      given();
      const revoked = { ...peter, sub: 'lea-revoked', personId: randomUUID() };
      api.directory.givenLeaOfficer(revoked.personId, revoked.sub, { state: 'revoked' });

      const cases: Caller[] = [
        // An officer token without a person record.
        { sub: peter.sub, roles: [LAW_ENFORCEMENT], tenant: 'lea' },
        // Role law-enforcement outside the lea tenant.
        { ...peter, tenant: 'psc' },
        // A person the directory has no officer for.
        { ...peter, personId: randomUUID() },
        // Peter's person with another account's token.
        { ...peter, sub: 'lea-impostor' },
        revoked,
      ];
      for (const caller of cases) {
        const response = await submitLeaResponse(api, LEA_INPUT, caller);
        expect(response.statusCode, JSON.stringify(caller)).toBe(403);
      }
      // Other roles do not reach the route.
      for (const caller of [callers.mercy, officer, { ...peter, roles: [APPLICANT] }]) {
        expect((await submitLeaResponse(api, LEA_INPUT, caller)).statusCode).toBe(403);
      }
      expect(await api.asPlatform((tx) => tx.select().from(leaRequests))).toEqual([]);
    });

    it('validates the written request: 400 with the fields at fault, nothing stored', async () => {
      given();

      const invalid = await submitLeaResponse(
        api,
        {
          ...LEA_INPUT,
          reason: '  ',
          caseReference: 'x'.repeat(101),
          scope: { ...LEA_INPUT.scope, includeClarifications: true },
          extra: true,
        },
        peter,
      );
      const unknown = await submitLeaResponse(api, { ...LEA_INPUT, commission: 'xyz' }, peter);

      expect(invalid.statusCode).toBe(400);
      const paths = invalid.json<{ errors: { path: string }[] }>().errors.map((e) => e.path);
      expect(paths).toEqual(
        // No clarifications in a scope: the field is not allowed at all.
        expect.arrayContaining(['reason', 'caseReference', 'scope']),
      );
      expect(unknown.statusCode).toBe(400);
      expect(unknown.json()).toMatchObject({ errors: [{ path: 'commission' }] });
      expect(await api.events()).toEqual([]);
    });

    it('needs an Idempotency-Key, and replays the same request for the same key', async () => {
      given();
      const key = randomUUID();

      const without = await api.send('POST', '/v1/lea/requests', peter, LEA_INPUT);
      const first = await api.send('POST', '/v1/lea/requests', peter, LEA_INPUT, {
        'idempotency-key': key,
      });
      const again = await api.send('POST', '/v1/lea/requests', peter, LEA_INPUT, {
        'idempotency-key': key,
      });

      expect(without.statusCode).toBe(400);
      expect(first.statusCode).toBe(201);
      expect(again.json<LeaRequest>().id).toBe(first.json<LeaRequest>().id);
      expect(await api.events('lea.request.received.v1')).toHaveLength(1);
    });

    it('stores nothing when the directory cannot be reached: 503', async () => {
      given();
      api.directory.failCalls(1, 'leaOfficer');

      const response = await submitLeaResponse(api, LEA_INPUT, peter);

      expect(response.statusCode).toBe(503);
      expect(await api.events()).toEqual([]);
    });
  });

  describe('reading', () => {
    it("S11: the officer lists their own requests across Commissions, never another officer's", async () => {
      given();
      const own = await received();
      await received(collins);

      const response = await api.get('/v1/lea/requests', peter);

      expect(response.statusCode).toBe(200);
      const body = response.json<LeaRequest[]>();
      expect(contractErrors(okResponse('/v1/lea/requests', 'get'), body)).toEqual([]);
      expect(body.map((request) => request.id)).toEqual([own.id]);
    });

    it("the filing officer and the Commission's access officer and supervisor read a request; nobody else", async () => {
      given();
      const { id } = await verified();
      const path = `/v1/lea/requests/${id}`;

      const filer = await api.get(path, peter);
      const access = await api.get(path, officer);
      expect(filer.statusCode).toBe(200);
      expect(
        contractErrors(okResponse('/v1/lea/requests/{leaRequestId}', 'get'), filer.json()),
      ).toEqual([]);
      // The officer sees only their own name on the timeline; the Commission sees who verified.
      expect(filer.json<LeaRequest>().timeline.map((entry) => entry.actor)).toEqual([
        'Peter Mwangi',
        null,
      ]);
      expect(access.json<LeaRequest>().timeline.map((entry) => entry.actor)).toEqual([
        'Peter Mwangi',
        officer.name,
      ]);
      expect((await api.get(path, supervisor)).statusCode).toBe(200);

      for (const caller of [collins, tscOfficer, eacc]) {
        expect((await api.get(path, caller)).statusCode, caller.sub).toBe(404);
      }
      expect((await api.get(path, { ...callers.mercy })).statusCode).toBe(403);
      expect(
        (await api.get(path, { sub: 'd', roles: [DECLARANT], tenant: 'psc' })).statusCode,
      ).toBe(403);
      expect((await api.get(`/v1/lea/requests/${randomUUID()}`, peter)).statusCode).toBe(404);
    });
  });

  describe('queue', () => {
    it("S11: the Commission's queue shows law enforcement requests (kind lea) with their 14-day deadline, among Form K requests by deadline", async () => {
      given();
      const lea = await received();
      // Form K received the same instant: due in 30 days, after the 14-day one.
      const formK = await submitRequest(api);

      const all = await api.get('/v1/commissions/psc/access/requests', officer);
      const leaOnly = await api.get('/v1/commissions/psc/access/requests?kind=lea', officer);
      const formKOnly = await api.get('/v1/commissions/psc/access/requests?kind=form-k', officer);
      const received_ = await api.get(
        '/v1/commissions/psc/access/requests?status=received,submitted',
        officer,
      );

      expect(all.statusCode, all.body).toBe(200);
      const page = all.json<QueuePage>();
      expect(
        contractErrors(okResponse('/v1/commissions/{slug}/access/requests', 'get'), page),
      ).toEqual([]);
      expect(page.items.map((item) => item.id)).toEqual([lea.id, formK.id]);
      expect(page.items[0]).toEqual({
        kind: 'lea',
        id: lea.id,
        reference: lea.reference,
        applicantOrAgency: 'Directorate of Criminal Investigations',
        officerSought: 'Anne Njeri Mutua',
        resolvedName: null,
        resolvedFileNumber: null,
        status: 'received',
        submittedAt: NOW,
        deadlineAt: DEADLINE,
        windowEndsAt: null,
        late: false,
        closedAt: null,
      });
      expect(leaOnly.json<QueuePage>().items.map((item) => item.id)).toEqual([lea.id]);
      expect(formKOnly.json<QueuePage>().items.map((item) => item.id)).toEqual([formK.id]);
      expect(received_.json<QueuePage>().items.map((item) => item.id)).toEqual([lea.id, formK.id]);
      expect(
        (
          await api.get('/v1/commissions/psc/access/requests?status=verified', officer)
        ).json<QueuePage>().items,
      ).toEqual([]);
      expect(
        (await api.get('/v1/commissions/tsc/access/requests?kind=lea', officer)).statusCode,
      ).toBe(404);
    });

    it('pages both kinds together by deadline, and marks a request undecided past its deadline late', async () => {
      given();
      const first = await received();
      api.clock.set('2027-01-12T07:00:00.000Z');
      const second = await received();
      const formK = await submitRequest(api);

      api.clock.set('2027-01-26T07:00:00.000Z');
      const one = await api.get('/v1/commissions/psc/access/requests?limit=1', officer);
      const pageOne = one.json<QueuePage>();
      const two = await api.get(
        `/v1/commissions/psc/access/requests?limit=2&cursor=${pageOne.nextCursor ?? ''}`,
        officer,
      );

      expect(pageOne.items.map((item) => [item.id, item.late])).toEqual([[first.id, true]]);
      expect(two.json<QueuePage>().items.map((item) => [item.id, item.late])).toEqual([
        [second.id, false],
        [formK.id, false],
      ]);
      expect(two.json<QueuePage>().nextCursor).toBeNull();
    });

    it('lists open requests of both kinds first by earliest deadline, then decided and closed ones by latest, across pages', async () => {
      given();
      const withdrawn = await received();
      const formK = await submitRequest(api);
      api.clock.set('2027-01-12T07:00:00.000Z');
      const open = await received();
      const denied = await submitRequest(api);
      await api.asPlatform((tx) =>
        tx.update(leaRequests).set({ status: 'withdrawn' }).where(eq(leaRequests.id, withdrawn.id)),
      );
      await api.asPlatform((tx) =>
        tx.update(accessRequests).set({ status: 'denied' }).where(eq(accessRequests.id, denied.id)),
      );

      const ids: string[] = [];
      let cursor: string | null = null;
      do {
        const query = `?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
        const page: QueuePage = (
          await api.get(`/v1/commissions/psc/access/requests${query}`, officer)
        ).json<QueuePage>();
        ids.push(...page.items.map((item) => item.id));
        cursor = page.nextCursor;
      } while (cursor !== null);

      // Open: the LEA one due day 15, then Form K due day 30; closed: Form K due day 31, LEA day 14.
      expect(ids).toEqual([open.id, formK.id, denied.id, withdrawn.id]);
    });

    it('filters both kinds by late and by search', async () => {
      given();
      const withdrawn = await received();
      const formK = await submitRequest(api);
      api.clock.set('2027-01-12T07:00:00.000Z');
      const open = await received();
      await api.asPlatform((tx) =>
        tx.update(leaRequests).set({ status: 'withdrawn' }).where(eq(leaRequests.id, withdrawn.id)),
      );
      api.clock.set('2027-01-31T07:00:00.000Z');
      const list = async (query: string) =>
        (await api.get(`/v1/commissions/psc/access/requests${query}`, officer))
          .json<QueuePage>()
          .items.map((item) => item.id);

      expect(await list('?late=true')).toEqual([open.id]);
      expect(await list('?late=false')).toEqual([formK.id, withdrawn.id]);
      expect(await list(`?search=${open.reference}`)).toEqual([open.id]);
      expect(await list('?search=criminal')).toEqual([open.id, withdrawn.id]);
    });
  });

  describe('roster search', () => {
    const search = (id: string, q: string, caller: Caller = officer) =>
      api.get(`/v1/lea/requests/${id}/roster-candidates?q=${encodeURIComponent(q)}`, caller);

    it("S11: the access officer finds the officer sought on the Commission's roster before verifying", async () => {
      given();
      const pending = api.directory.givenRosterRecord('psc', {
        personnelFileNumber: 'PF-2019-000077',
        fullName: 'Anne Wairimu Njoroge',
        personId: null,
        designation: null,
      });
      api.directory.givenRosterRecord('tsc', { fullName: 'Anne Teacher' });
      const { id } = await received();

      const response = await search(id, 'anne');

      expect(response.statusCode, response.body).toBe(200);
      const found = response.json<RosterCandidates>();
      expect(
        contractErrors(
          okResponse('/v1/lea/requests/{leaRequestId}/roster-candidates', 'get'),
          found,
        ),
      ).toEqual([]);
      expect(found.items.map(({ id: recordId, onboarded }) => ({ recordId, onboarded }))).toEqual([
        { recordId: anne.id, onboarded: true },
        { recordId: pending.id, onboarded: false },
      ]);
      const byFileNumber = (await search(id, 'pf-2011')).json<RosterCandidates>();
      expect(byFileNumber.items.map((item) => item.id)).toEqual([anne.id]);
    });

    it("is the Commission's access officer's: the supervisor 403, anyone else 404 or 403", async () => {
      given();
      const { id } = await received();

      expect((await search(id, 'anne', supervisor)).statusCode).toBe(403);
      expect((await search(id, 'anne', tscOfficer)).statusCode).toBe(404);
      expect((await search(id, 'anne', eacc)).statusCode).toBe(404);
      expect((await search(id, 'anne', peter)).statusCode).toBe(403);
      expect((await search(randomUUID(), 'anne')).statusCode).toBe(404);
      expect((await search(id, ' a ')).statusCode).toBe(400);
    });

    it('answers 503 when the directory cannot be reached', async () => {
      given();
      const { id } = await received();
      api.directory.failCalls(1, 'searchRoster');

      expect((await search(id, 'anne')).statusCode).toBe(503);
    });
  });

  describe('verify', () => {
    it('S11: the access officer records the provenance and reason check and identifies the officer sought', async () => {
      given();
      const { id } = await received();
      api.clock.set(VERIFIED_AT);

      const response = await verifyLea(api, id, anne.id);

      expect(response.statusCode, response.body).toBe(200);
      const body = response.json<LeaRequest>();
      expect(
        contractErrors(okResponse('/v1/lea/requests/{leaRequestId}/verify', 'post'), body),
      ).toEqual([]);
      expect(body).toMatchObject({
        status: 'verified',
        resolvedRosterRecordId: anne.id,
        resolvedName: 'Anne Njeri Mutua',
        verification: {
          by: { subject: officer.sub, name: officer.name },
          at: VERIFIED_AT,
          note: 'Sent from the DCI account of Insp. Peter Mwangi. Reason and case reference stated.',
          provenance: { ...PROVENANCE, checkedAt: VERIFIED_AT },
        },
      });
      expect((await leaRowOf(api, id)).resolvedPersonId).toBe(anne.personId);
      expect(await api.events('lea.request.verified.v1')).toEqual([
        expect.objectContaining({
          data: expect.objectContaining({
            kind: 'verified',
            legalBasis: 'act-s36-2',
            personId: anne.personId,
            actor: officer.sub,
          }) as unknown,
        }),
      ]);
      // Still nobody told: the declarant hears only after a grant.
      expect(api.notifications.sent).toEqual([]);
    });

    it('needs both confirmations, a note and an onboarded roster record of the Commission: 400', async () => {
      given();
      const { id } = await received();
      const notOnboarded = api.directory.givenRosterRecord('psc', { personId: null });
      const tscRecord = api.directory.givenRosterRecord('tsc');

      const unconfirmed = await verifyLea(api, id, anne.id, officer, {
        provenanceConfirmed: false,
        reasonConfirmed: undefined,
        note: '',
      });
      const pending = await verifyLea(api, id, notOnboarded.id);
      const other = await verifyLea(api, id, tscRecord.id);

      expect(unconfirmed.statusCode).toBe(400);
      expect(
        unconfirmed
          .json<{ errors: { path: string }[] }>()
          .errors.map((e) => e.path)
          .sort(),
      ).toEqual(['note', 'provenanceConfirmed', 'reasonConfirmed']);
      expect(pending.json()).toMatchObject({ status: 400, errors: [{ path: 'rosterRecordId' }] });
      expect(other.json()).toMatchObject({ status: 400, errors: [{ path: 'rosterRecordId' }] });
      expect((await leaRowOf(api, id)).status).toBe('received');
    });

    it("is the access officer's, once, on an undecided request from a still active account", async () => {
      given();
      const { id } = await received();

      expect((await verifyLea(api, id, anne.id, supervisor)).statusCode).toBe(403);
      expect((await verifyLea(api, id, anne.id, tscOfficer)).statusCode).toBe(404);
      expect((await verifyLea(api, id, anne.id, eacc)).statusCode).toBe(404);
      expect((await verifyLea(api, id, anne.id, peter)).statusCode).toBe(403);

      // Peter's account revoked since he filed: the provenance no longer holds.
      api.directory.givenLeaOfficer(peter.personId, peter.sub, { state: 'revoked' });
      const inactive = await verifyLea(api, id, anne.id);
      expect(inactive.statusCode).toBe(409);
      expect(inactive.json()).toMatchObject({ code: 'lea-account-inactive' });
      api.directory.givenLeaOfficer(peter.personId, peter.sub, { name: peter.name });

      expect((await verifyLea(api, id, anne.id)).statusCode).toBe(200);
      const again = await verifyLea(api, id, anne.id);
      expect(again.statusCode).toBe(409);
      expect(again.json()).toMatchObject({ code: 'officer-resolved' });
    });
  });

  describe('decide', () => {
    it('S11: a grant needs the request verified (409 not-under-decision); a denial may come before', async () => {
      given();
      const { id } = await received();

      const grant = await decideLea(api, id, { outcome: 'grant', reasons: 'Shown.' });
      expect(grant.statusCode).toBe(409);
      expect(grant.json()).toMatchObject({ code: 'not-under-decision' });

      const deny = await decideLea(api, id, {
        outcome: 'deny',
        grounds: ['not-objectives'],
        reasons: 'The officer sought cannot be identified on the roster.',
      });
      expect(deny.statusCode, deny.body).toBe(200);
      expect(deny.json<LeaRequest>()).toMatchObject({
        status: 'denied',
        decision: { outcome: 'deny', grantedScope: null, grounds: ['not-objectives'] },
      });
    });

    it('S11: grants a verified request with the decided event (outcome, grounds); a decision is final', async () => {
      given();
      const { id } = await verified();

      const response = await decideLea(api, id, {
        outcome: 'partial-grant',
        grantedScope: { ...LEA_INPUT.scope, includeSpouses: false },
        grounds: ['public-interest'],
        reasons: 'Ongoing investigation; the spouse is not named in it.',
      });

      expect(response.statusCode, response.body).toBe(200);
      expect(
        contractErrors(
          okResponse('/v1/lea/requests/{leaRequestId}/decision', 'post'),
          response.json(),
        ),
      ).toEqual([]);
      expect(response.json<LeaRequest>()).toMatchObject({
        status: 'granted',
        decision: {
          outcome: 'partial-grant',
          grantedScope: { ...LEA_INPUT.scope, includeSpouses: false },
          grounds: ['public-interest'],
          decidedBy: { subject: officer.sub, name: officer.name },
        },
      });
      const decided = await api.events('lea.request.decided.v1');
      expect(decided).toEqual([
        expect.objectContaining({
          data: expect.objectContaining({
            outcome: 'partial-grant',
            grounds: ['public-interest'],
            legalBasis: 'act-s36-2',
            personId: anne.personId,
          }) as unknown,
        }),
      ]);
      expect(accessRequestDecidedDataSchema.safeParse(decided[0]?.data).success).toBe(true);
      const again = await decideLea(api, id, {
        outcome: 'deny',
        grounds: ['public-interest'],
        reasons: 'Changed my mind.',
      });
      expect(again.statusCode).toBe(409);
      expect(again.json()).toMatchObject({ code: 'request-decided' });
    });

    it('applies the outcome rules and the roles as for Form K', async () => {
      given();
      const { id } = await verified();

      const groundless = await decideLea(api, id, { outcome: 'deny', reasons: 'No.' });
      const wider = await decideLea(api, id, {
        outcome: 'partial-grant',
        grantedScope: { ...LEA_INPUT.scope, includeChildren: true },
        grounds: ['public-interest'],
        reasons: 'Wider.',
      });

      expect(groundless.json()).toMatchObject({ status: 400, code: 'grounds-required' });
      expect(wider.json()).toMatchObject({ status: 400, code: 'scope-exceeds-request' });
      const body = { outcome: 'grant', reasons: 'Shown.' };
      expect((await decideLea(api, id, body, supervisor)).statusCode).toBe(403);
      expect((await decideLea(api, id, body, tscOfficer)).statusCode).toBe(404);
      expect((await decideLea(api, id, body, peter)).statusCode).toBe(403);
      expect(
        (await api.send('POST', `/v1/lea/requests/${id}/decision`, officer, body)).statusCode,
      ).toBe(400);
      expect((await leaRowOf(api, id)).status).toBe('verified');
    });
  });

  it('a declarant sees no law enforcement request about them before it is granted and they are told', async () => {
    given();
    await verified();

    const notices = await api.get('/v1/me/access-notices', declarantOf(anne));

    expect(notices.statusCode).toBe(200);
    expect(notices.json()).toEqual([]);
  });
});
