import { randomUUID } from 'node:crypto';

import { ACCESS_REQUEST_IDENTIFIED } from '@adili/events/contracts';
import { accessRequestIdentifiedDataSchema } from '@adili/events/contracts/schemas';
import { asc, eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { accessRegister } from '../../src/db/schema.js';
import { accessRequestWorkflowId } from '../../src/requests/contract.js';
import type { RosterCandidates } from '../../src/requests/officer-representation.js';
import type { OfficerRequestView } from '../../src/requests/officer-view.js';
import { type AccessApi, type Caller, startAccessApi } from '../support/access-api.js';
import { contractErrors, okResponse } from '../support/contract.js';
import {
  callers,
  COMPLETE,
  givenCommissions,
  resolve,
  rowOf,
  submitRequest,
  untilNotified,
} from '../support/requests.js';

const NOW = '2027-03-04T09:00:00.000Z';
/** Resolved on the evening of 9 March in Nairobi (UTC 9 March 18:30, Nairobi 21:30). */
const RESOLVED_AT = '2027-03-09T18:30:00.000Z';

describe('Resolving the officer a request names (S3)', () => {
  let api: AccessApi;
  const { mercy, officer, supervisor, tscOfficer, eacc } = callers;

  beforeAll(async () => {
    api = await startAccessApi();
    return () => api.close();
  });

  afterEach(() => api.reset());

  const workflowOf = (id: string) => api.temporal.workflow.getHandle(accessRequestWorkflowId(id));

  describe('to a roster record', () => {
    it('S3: records the record and its declarant; the workflow notifies the declarant and opens the 7-day window', async () => {
      const { anne } = givenCommissions(api, NOW);
      const { id, reference } = await submitRequest(api);
      api.clock.set(RESOLVED_AT);

      const response = await resolve(api, id, anne.id);

      expect(response.statusCode, response.body).toBe(200);
      const view = response.json<OfficerRequestView>();
      expect(
        contractErrors(okResponse('/v1/access/requests/{requestId}/resolve', 'post'), view),
      ).toEqual([]);
      expect(view).toMatchObject({
        resolvedRosterRecordId: anne.id,
        resolvedName: 'Anne Njeri Mutua',
        resolvedFileNumber: 'PF-2011-004512',
      });

      const row = await untilNotified(api, id);
      expect(row).toMatchObject({
        status: 'awaiting-representations',
        resolvedRosterRecordId: anne.id,
        resolvedPersonId: anne.personId,
        resolvedName: 'Anne Njeri Mutua',
        resolvedBy: officer.sub,
        resolvedAt: new Date(RESOLVED_AT),
        notifiedAt: new Date(RESOLVED_AT),
        windowEndsAt: new Date('2027-03-16T18:30:00.000Z'),
      });
      const messages = await api.eventually(() =>
        api.notifications.sent.length >= 2 ? api.notifications.sent : undefined,
      );
      const params = {
        reference,
        commissionName: 'Public Service Commission',
        // The window ends at 21:30 on 16 March in Nairobi.
        respondBy: '2027-03-16',
        signInUrl: 'http://localhost:3010/access/notices',
      };
      expect(messages).toEqual([
        {
          channel: 'email',
          recipient: { kind: 'person', personId: anne.personId },
          template: 'access-request-notified-email',
          params,
          tenant: 'psc',
          idempotencyKey: expect.any(String) as unknown,
        },
        {
          channel: 'sms',
          recipient: { kind: 'person', personId: anne.personId },
          template: 'access-request-notified-sms',
          params,
          tenant: 'psc',
          idempotencyKey: expect.any(String) as unknown,
        },
      ]);

      const [notified] = await api.events('access.request.notified.v1');
      expect(notified).toMatchObject({
        subject: id,
        tenant: 'psc',
        data: {
          kind: 'notified',
          reference,
          personId: anne.personId,
          actor: null,
          legalBasis: 'act-s36-1',
          windowEndsAt: '2027-03-16T18:30:00.000Z',
        },
      });
      const officerView = (
        await api.get(`/v1/access/requests/${id}/officer`, officer)
      ).json<OfficerRequestView>();
      expect(officerView.timeline.map((entry) => entry.kind)).toEqual([
        'received',
        'identified',
        'notified',
      ]);
      expect(officerView.windowEndsAt).toBe('2027-03-16T18:30:00.000Z');
      // Notified: the window is the request's own now.
      expect(officerView.representationWindowDays).toBeNull();
    });

    it("S3: before identifying, the officer sees the Commission's representation window in force (null when the directory is down)", async () => {
      givenCommissions(api, NOW);
      api.directory.givenAccessPolicy('psc', { representationWindowDays: 10 });
      const { id } = await submitRequest(api);

      const view = await api.get(`/v1/access/requests/${id}/officer`, officer);
      api.directory.failCalls(1, 'accessPolicy');
      const down = await api.get(`/v1/access/requests/${id}/officer`, officer);

      expect(view.json<OfficerRequestView>().representationWindowDays).toBe(10);
      expect(
        contractErrors(okResponse('/v1/access/requests/{requestId}/officer', 'get'), view.json()),
      ).toEqual([]);
      expect(down.statusCode).toBe(200);
      expect(down.json<OfficerRequestView>().representationWindowDays).toBeNull();
    });

    it('S3: the register records who identified the declarant, as which roster record', async () => {
      const { anne } = givenCommissions(api, NOW);
      const { id, reference } = await submitRequest(api);
      api.clock.set(RESOLVED_AT);

      expect((await resolve(api, id, anne.id)).statusCode).toBe(200);

      const entries = await api.asPlatform((tx) =>
        tx
          .select()
          .from(accessRegister)
          .where(eq(accessRegister.subjectId, id))
          .orderBy(asc(accessRegister.at), asc(accessRegister.id)),
      );
      expect(entries.find((entry) => entry.kind === 'identified')).toMatchObject({
        subjectKind: 'access-request',
        reference,
        personId: anne.personId,
        actor: officer.sub,
        actorName: 'Peter Access',
        legalBasis: 'act-s36-1',
        at: new Date(RESOLVED_AT),
        details: { rosterRecordId: anne.id },
      });
      const [identified] = await api.events(ACCESS_REQUEST_IDENTIFIED);
      expect(accessRequestIdentifiedDataSchema.parse(identified?.data)).toMatchObject({
        kind: 'identified',
        actor: officer.sub,
        personId: anne.personId,
        rosterRecordId: anne.id,
      });
      // The notice that follows is the workflow's, as before.
      await untilNotified(api, id);
      expect(
        (await api.events('access.request.notified.v1')).map((event) => event.data.actor),
      ).toEqual([null]);
    });

    it('S3: once only: a second resolution is 409 `officer-resolved`', async () => {
      const { anne } = givenCommissions(api, NOW);
      const { id } = await submitRequest(api);
      await resolve(api, id, anne.id);

      const again = await resolve(api, id, anne.id);
      const cannot = await resolve(api, id, null);

      expect(again.statusCode).toBe(409);
      expect(again.json()).toMatchObject({ code: 'officer-resolved' });
      expect(cannot.statusCode).toBe(409);
    });

    it('answers 400 at rosterRecordId for a record the Commission does not have, and changes nothing', async () => {
      givenCommissions(api, NOW);
      const tscRecord = api.directory.givenRosterRecord('tsc');
      const { id } = await submitRequest(api);

      const unknown = await resolve(api, id, randomUUID());
      const otherCommission = await resolve(api, id, tscRecord.id);

      for (const response of [unknown, otherCommission]) {
        expect(response.statusCode, response.body).toBe(400);
        expect(response.json()).toMatchObject({ errors: [{ path: 'rosterRecordId' }] });
      }
      expect((await rowOf(api, id)).resolvedRosterRecordId).toBeNull();
    });

    it('answers 400 for a body without rosterRecordId or with more', async () => {
      const { anne } = givenCommissions(api, NOW);
      const { id } = await submitRequest(api);
      const url = `/v1/access/requests/${id}/resolve`;

      expect((await api.send('POST', url, officer, {})).statusCode).toBe(400);
      expect(
        (await api.send('POST', url, officer, { rosterRecordId: anne.id, note: 'x' })).statusCode,
      ).toBe(400);
    });

    it('answers 503 when the directory cannot be reached, and records nothing', async () => {
      const { anne } = givenCommissions(api, NOW);
      const { id } = await submitRequest(api);
      api.directory.failCalls(1, 'rosterRecord');

      const response = await resolve(api, id, anne.id);

      expect(response.statusCode).toBe(503);
      expect((await rowOf(api, id)).resolvedRosterRecordId).toBeNull();
    });
  });

  describe('as unidentifiable', () => {
    it('S3: closes the request as cannot-identify with Form M decline reason `other`, and the applicant is told', async () => {
      givenCommissions(api, NOW);
      const { id, reference } = await submitRequest(api);
      api.clock.set(RESOLVED_AT);

      const response = await resolve(api, id, null);

      expect(response.statusCode, response.body).toBe(200);
      expect(response.json<OfficerRequestView>()).toMatchObject({
        status: 'cannot-identify',
        resolvedRosterRecordId: null,
        timeline: [{ kind: 'received' }, { kind: 'cannot-identify', actor: 'Peter Access' }],
      });
      const [event] = await api.events('access.request.cannot-identify.v1');
      expect(event).toMatchObject({
        subject: id,
        tenant: 'psc',
        data: {
          kind: 'cannot-identify',
          reference,
          declineReason: 'other',
          personId: null,
          actor: officer.sub,
          legalBasis: 'act-s36-1',
        },
      });
      const messages = await api.eventually(() =>
        api.notifications.sent.length >= 2 ? api.notifications.sent : undefined,
      );
      expect(
        messages.map((message) => [message.channel, message.template, message.recipient]),
      ).toEqual([
        ['email', 'access-decision-applicant-email', { kind: 'person', personId: mercy.personId }],
        ['sms', 'access-decision-applicant-sms', { kind: 'person', personId: mercy.personId }],
      ]);
      expect(messages[0]?.params).toEqual({
        reference,
        commissionName: 'Public Service Commission',
        outcome: 'cannot-identify',
        signInUrl: 'http://localhost:3010/access/requests',
      });
      // The run ends there.
      await api.eventually(async () =>
        (await workflowOf(id).describe()).status.name === 'COMPLETED' ? true : undefined,
      );
      expect(await workflowOf(id).result()).toEqual({ outcome: 'cannot-identify' });
    });

    it('a closed request cannot be resolved: 409 `request-closed`', async () => {
      const { anne } = givenCommissions(api, NOW);
      const { id } = await submitRequest(api);
      await resolve(api, id, null);

      const response = await resolve(api, id, anne.id);

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: 'request-closed' });
    });
  });

  describe('who may resolve', () => {
    it("S16: only the Commission's access officer: the supervisor gets 403, another Commission and EACC 404", async () => {
      const { anne } = givenCommissions(api, NOW);
      const { id } = await submitRequest(api);

      expect((await resolve(api, id, anne.id, supervisor)).statusCode).toBe(403);
      expect((await resolve(api, id, anne.id, tscOfficer)).statusCode).toBe(404);
      expect((await resolve(api, id, anne.id, eacc)).statusCode).toBe(404);
      expect((await resolve(api, randomUUID(), anne.id)).statusCode).toBe(404);
      expect((await rowOf(api, id)).resolvedRosterRecordId).toBeNull();
    });

    it("waits for a passport applicant's verification: 409 while held", async () => {
      const { anne } = givenCommissions(api, NOW);
      api.directory.givenApplicant(mercy.personId, 'pending-verification');
      const { id, status } = await submitRequest(api);
      expect(status).toBe('pending-applicant-verification');

      const response = await resolve(api, id, anne.id);

      expect(response.statusCode).toBe(409);
    });
  });

  describe('roster search', () => {
    const search = (id: string, q: string, caller: Caller = officer) =>
      api.get(`/v1/access/requests/${id}/roster-candidates?q=${encodeURIComponent(q)}`, caller);

    it("finds the Commission's records by name or file number, saying which can be chosen", async () => {
      const { anne } = givenCommissions(api, NOW);
      const pending = api.directory.givenRosterRecord('psc', {
        personnelFileNumber: 'PF-2019-000077',
        fullName: 'Anne Wairimu Njoroge',
        personId: null,
        designation: null,
      });
      api.directory.givenRosterRecord('tsc', { fullName: 'Anne Teacher' });
      const { id } = await submitRequest(api);

      const response = await search(id, 'anne');

      expect(response.statusCode, response.body).toBe(200);
      const found = response.json<RosterCandidates>();
      expect(
        contractErrors(
          okResponse('/v1/access/requests/{requestId}/roster-candidates', 'get'),
          found,
        ),
      ).toEqual([]);
      expect(found.items).toEqual([
        {
          id: anne.id,
          personnelFileNumber: 'PF-2011-004512',
          fullName: 'Anne Njeri Mutua',
          designation: 'Deputy Director, Land Administration',
          reportingEntity: 'Ministry of Lands and Physical Planning',
          state: 'onboarded',
          onboarded: true,
        },
        {
          id: pending.id,
          personnelFileNumber: 'PF-2019-000077',
          fullName: 'Anne Wairimu Njoroge',
          designation: null,
          reportingEntity: null,
          state: 'not_onboarded',
          onboarded: false,
        },
      ]);
      const byFileNumber = (await search(id, 'pf-2011')).json<RosterCandidates>();
      expect(byFileNumber.items.map((item) => item.id)).toEqual([anne.id]);
      expect(api.directory.calls).toContainEqual({ method: 'searchRoster', slug: 'psc' });
    });

    it('is for the access officer of the Commission; a search of under 2 characters is 400', async () => {
      givenCommissions(api, NOW);
      const { id } = await submitRequest(api);

      expect((await search(id, 'anne', supervisor)).statusCode).toBe(403);
      expect((await search(id, 'anne', tscOfficer)).statusCode).toBe(404);
      expect((await search(id, 'anne', eacc)).statusCode).toBe(404);
      expect((await search(id, ' a ')).statusCode).toBe(400);
      expect(
        (await api.get(`/v1/access/requests/${id}/roster-candidates`, officer)).statusCode,
      ).toBe(400);
    });

    it('answers 503 when the directory cannot be reached', async () => {
      givenCommissions(api, NOW);
      const { id } = await submitRequest(api);
      api.directory.failCalls(1, 'searchRoster');

      expect((await search(id, 'anne')).statusCode).toBe(503);
    });
  });

  describe("the request's workflow", () => {
    it('starts at receipt for every request, held for verification or not (its reminders count from receipt)', async () => {
      givenCommissions(api, NOW);
      const submitted = await submitRequest(api);
      api.directory.givenApplicant(mercy.personId, 'pending-verification');
      const held = await submitRequest(api, { ...COMPLETE, responsibleCommission: 'tsc' });

      expect(held.status).toBe('pending-applicant-verification');
      expect((await workflowOf(submitted.id).describe()).status.name).toBe('RUNNING');
      expect((await workflowOf(held.id).describe()).status.name).toBe('RUNNING');
    });

    it("S2: a held request's workflow goes on once the access officer verifies the applicant: the officer named is resolved and the declarant notified", async () => {
      const { anne } = givenCommissions(api, NOW);
      api.directory.givenApplicant(mercy.personId, 'pending-verification');
      const held = await submitRequest(api);

      const verified = await api.send(
        'POST',
        `/v1/access/requests/${held.id}/verify-applicant`,
        officer,
        { verified: true, note: 'Passport particulars checked.' },
      );
      expect(verified.statusCode, verified.body).toBe(200);
      const resolved = await resolve(api, held.id, anne.id);
      expect(resolved.statusCode, resolved.body).toBe(200);

      expect(await untilNotified(api, held.id)).toMatchObject({
        status: 'awaiting-representations',
      });
    });

    it('S8: ends when the applicant withdraws', async () => {
      givenCommissions(api, NOW);
      const { id } = await submitRequest(api);

      const withdrawn = await api.send('POST', `/v1/access/requests/${id}/withdraw`, mercy);

      expect(withdrawn.statusCode).toBe(200);
      await api.eventually(async () =>
        (await workflowOf(id).describe()).status.name === 'COMPLETED' ? true : undefined,
      );
      expect(await workflowOf(id).result()).toEqual({ outcome: 'withdrawn' });
    });
  });
});
