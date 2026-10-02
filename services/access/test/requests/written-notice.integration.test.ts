import { randomUUID } from 'node:crypto';

import { createEnvelope } from '@adili/events';
import {
  ACCESS_REQUEST_IDENTIFIED,
  ACCESS_REQUEST_NOTIFIED,
  ACCESS_REQUEST_REPRESENTATIONS,
} from '@adili/events/contracts';
import {
  accessRequestIdentifiedDataSchema,
  accessRequestNotifiedDataSchema,
  accessRequestRepresentationsDataSchema,
} from '@adili/events/contracts/schemas';
import { ACCESS_OFFICER, DECLARANT } from '@adili/roles';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { accessRegister, representations } from '../../src/db/schema.js';
import type { RosterCandidateFacts } from '../../src/directory/directory-client.js';
import type { AccessHistoryEntry } from '../../src/history/representation.js';
import type { DeclarantNotice, FormKDeclarantNotice } from '../../src/notices/representation.js';
import { AccessRequestActivities } from '../../src/requests/activities.js';
import { onboardedNoticeWorkflowId } from '../../src/onboarded-notices/contract.js';
import { accessRequestWorkflowId } from '../../src/requests/contract.js';
import {
  DECLARANT_ONBOARDED,
  DeclarantOnboardedConsumer,
} from '../../src/requests/declarant-onboarded.consumer.js';
import type { OfficerRequestView } from '../../src/requests/officer-view.js';
import { type AccessApi, type Caller, startAccessApi } from '../support/access-api.js';
import { contractErrors, okResponse } from '../support/contract.js';
import {
  callers,
  decide,
  ENDED_TRANSACTION,
  givenCommissions,
  notifiedRequest,
  resolve,
  rowOf,
  submitRequest,
} from '../support/requests.js';

/** Thursday 4 March 2027, 12:00 in Nairobi: Mercy's Form K is received. */
const NOW = '2027-03-04T09:00:00.000Z';
/** The officer is identified on 5 March, 10:00 in Nairobi. */
const RESOLVED_AT = '2027-03-05T07:00:00.000Z';
/** The written notice is recorded on 8 March, 12:00 in Nairobi... */
const RECORDED_AT = '2027-03-08T09:00:00.000Z';
/** ...served on 6 March: notified from the start of that day in Nairobi... */
const NOTIFIED_ON = '2027-03-06';
const NOTIFIED_AT = '2027-03-05T21:00:00.000Z';
/** ...and the window ends at the end of 13 March, the seventh day after it, in Nairobi. */
const WINDOW_ENDS_AT = '2027-03-13T21:00:00.000Z';
const OBJECTION = 'I object: the land was allocated before I joined the department.';

/**
 * Spec 10 decision 2 (r.22(2)): the officer a Form K names is on the roster but has not
 * onboarded. The access officer resolves the request to their record all the same; the workflow
 * has them invited to onboard; the access officer serves the notice in writing and records the
 * day, from which the window for representations runs, and enters the representations they
 * receive in writing. Once the officer onboards, the request is linked to them by the roster
 * record: their notices and who-accessed history show it. Onboarding before the written notice
 * has them notified online.
 */
describe('An officer with no account: written notice and representations received in writing', () => {
  let api: AccessApi;
  let consumer: DeclarantOnboardedConsumer;
  const { officer, supervisor, tscOfficer } = callers;

  beforeAll(async () => {
    api = await startAccessApi();
    consumer = api.app.get(DeclarantOnboardedConsumer);
    return () => api.close();
  });

  afterEach(() => api.reset());

  /** Anne (onboarded) and John Bwire Otieno, on the PSC roster with no account. */
  function givenRoster(): { anne: RosterCandidateFacts; bwire: RosterCandidateFacts } {
    const { anne } = givenCommissions(api, NOW);
    const bwire = api.directory.givenRosterRecord('psc', {
      personnelFileNumber: 'PF-2014-007731',
      fullName: 'John Bwire Otieno',
      personId: null,
    });
    return { anne, bwire };
  }

  /** Mercy's request, resolved to Bwire on 5 March; the workflow has invited him to onboard. */
  async function resolvedToBwire() {
    const roster = givenRoster();
    const { id, reference } = await submitRequest(api);
    api.clock.set(RESOLVED_AT);
    const response = await resolve(api, id, roster.bwire.id);
    expect(response.statusCode, response.body).toBe(200);
    await api.eventually(async () => (await rowOf(api, id)).declarantInvitedAt !== null);
    return { ...roster, id, reference, view: response.json<OfficerRequestView>() };
  }

  const recordNotice = (id: string, body: unknown, caller: Caller = officer) =>
    api.send('POST', `/v1/access/requests/${id}/written-notice`, caller, body);

  const enter = (id: string, body: unknown, caller: Caller = officer) =>
    api.send('PUT', `/v1/access/requests/${id}/representations`, caller, body);

  /** Bwire's request, the written notice served on 6 March recorded on 8 March. */
  async function noticeServed() {
    const resolved = await resolvedToBwire();
    api.clock.set(RECORDED_AT);
    const response = await recordNotice(resolved.id, { notifiedOn: NOTIFIED_ON });
    expect(response.statusCode, response.body).toBe(200);
    return { ...resolved, view: response.json<OfficerRequestView>() };
  }

  /** The directory's event: the roster record's officer onboarded as `personId`. */
  const onboarded = (recordId: string, personId: string) =>
    consumer.onboarded(
      createEnvelope('adili/directory', {
        type: DECLARANT_ONBOARDED,
        subject: recordId,
        tenant: 'psc',
        data: {
          personId,
          ofr: 'OFR-2027-0000001-K',
          rosterRecordId: recordId,
          keycloakUserId: randomUUID(),
          linked: false,
        },
      }),
    );

  const declarant = (personId: string): Caller => ({
    sub: `declarant-${personId}`,
    roles: [DECLARANT],
    tenant: 'psc',
    personId,
  });

  const entriesOf = (id: string) =>
    api.asPlatform((tx) =>
      tx.select().from(accessRegister).where(eq(accessRegister.subjectId, id)),
    );

  describe('resolving to a record with no account', () => {
    it('keeps the record with no declarant, invites the officer to onboard once, and notifies no one online', async () => {
      const { bwire, id, view } = await resolvedToBwire();

      expect(
        contractErrors(okResponse('/v1/access/requests/{requestId}/resolve', 'post'), view),
      ).toEqual([]);
      expect(view).toMatchObject({
        status: 'submitted',
        resolvedRosterRecordId: bwire.id,
        resolvedName: 'John Bwire Otieno',
        declarantOnboarded: false,
        notice: null,
      });
      const row = await rowOf(api, id);
      expect(row).toMatchObject({
        status: 'submitted',
        resolvedRosterRecordId: bwire.id,
        resolvedPersonId: null,
        notifiedAt: null,
      });
      expect(api.directory.invitations).toEqual([
        { slug: 'psc', recordId: bwire.id, idempotencyKey: expect.any(String) as unknown },
      ]);
      const identified = (await entriesOf(id)).find((entry) => entry.kind === 'identified');
      expect(identified).toMatchObject({
        personId: null,
        details: { rosterRecordId: bwire.id, onboarded: false },
      });
      const [event] = await api.events(ACCESS_REQUEST_IDENTIFIED);
      expect(accessRequestIdentifiedDataSchema.parse(event?.data)).toMatchObject({
        personId: null,
        rosterRecordId: bwire.id,
      });
      expect(api.notifications.sent.map((message) => message.template)).not.toContain(
        'access-request-notified-email',
      );

      // The officer's view says so, and the invitation is recorded.
      const read = await api.get(`/v1/access/requests/${id}/officer`, officer);
      expect(read.json<OfficerRequestView>()).toMatchObject({
        declarantOnboarded: false,
        declarantInvitedAt: expect.any(String) as unknown,
      });
    });

    it('the access officers are reminded to record the written notice', async () => {
      const { id } = await resolvedToBwire();
      api.directory.givenStaff('psc', ACCESS_OFFICER, {
        subject: officer.sub,
        email: 'access@psc.go.ke',
      });
      api.clock.set('2027-03-24T09:00:00.000Z');

      await api.app.get(AccessRequestActivities).remindOfficer({
        tenant: 'psc',
        requestId: id,
        submittedAt: NOW,
        transactionId: ENDED_TRANSACTION,
        day: 20,
      });

      const reminder = api.notifications.sent.find(
        (message) => message.template === 'access-officer-reminder-email',
      );
      expect(reminder?.params).toMatchObject({ task: 'record-notice' });
    });
  });

  describe('recording the written notice (r.22(2))', () => {
    it('opens the window from the day it was served, to the end of the seventh day after it, with its register entry and event', async () => {
      const { id, view } = await noticeServed();

      expect(
        contractErrors(okResponse('/v1/access/requests/{requestId}/written-notice', 'post'), view),
      ).toEqual([]);
      expect(view).toMatchObject({
        status: 'awaiting-representations',
        windowEndsAt: WINDOW_ENDS_AT,
        declarantOnboarded: false,
        notice: {
          channel: 'written',
          notifiedAt: NOTIFIED_AT,
          notifiedOn: NOTIFIED_ON,
          recordedBy: 'Peter Access',
        },
      });
      expect(view.timeline.at(-1)).toMatchObject({
        kind: 'notified',
        actor: 'Peter Access',
        summary: 'Declarant notified in writing',
        inWriting: true,
      });
      expect(await rowOf(api, id)).toMatchObject({
        status: 'awaiting-representations',
        notifiedAt: new Date(NOTIFIED_AT),
        windowEndsAt: new Date(WINDOW_ENDS_AT),
        writtenNotice: {
          notifiedOn: NOTIFIED_ON,
          by: officer.sub,
          byName: 'Peter Access',
          at: RECORDED_AT,
        },
      });
      const [event] = await api.events(ACCESS_REQUEST_NOTIFIED);
      expect(accessRequestNotifiedDataSchema.parse(event?.data)).toMatchObject({
        channel: 'written',
        notifiedOn: NOTIFIED_ON,
        windowEndsAt: WINDOW_ENDS_AT,
        actor: officer.sub,
        personId: null,
      });
    });

    it('once only: 409 declarant-notified', async () => {
      const { id } = await noticeServed();

      const again = await recordNotice(id, { notifiedOn: NOTIFIED_ON });

      expect(again.statusCode).toBe(409);
      expect(again.json()).toMatchObject({ code: 'declarant-notified' });
    });

    it('400 at notifiedOn for a day in the future or before the officer was identified', async () => {
      const { id } = await resolvedToBwire();
      api.clock.set(RECORDED_AT);

      const future = await recordNotice(id, { notifiedOn: '2027-03-09' });
      const before = await recordNotice(id, { notifiedOn: '2027-03-04' });
      const extra = await recordNotice(id, { notifiedOn: NOTIFIED_ON, note: 'by hand' });

      for (const response of [future, before]) {
        expect(response.statusCode, response.body).toBe(400);
        expect(response.json()).toMatchObject({ errors: [{ path: 'notifiedOn' }] });
      }
      expect(extra.statusCode).toBe(400);
      expect((await rowOf(api, id)).notifiedAt).toBeNull();
      // The day the officer was identified, and today, are both fine.
      expect((await recordNotice(id, { notifiedOn: '2027-03-05' })).statusCode).toBe(200);
    });

    it("is the access officer's: supervisor 403, another Commission 404", async () => {
      const { id } = await resolvedToBwire();

      expect((await recordNotice(id, { notifiedOn: '2027-03-05' }, supervisor)).statusCode).toBe(
        403,
      );
      expect((await recordNotice(id, { notifiedOn: '2027-03-05' }, tscOfficer)).statusCode).toBe(
        404,
      );
    });

    it('409 before the officer is identified, and for a declarant with an account (notified online)', async () => {
      const { anne } = givenRoster();
      const { id: unresolved } = await submitRequest(api);
      const online = await notifiedRequest(api, anne);

      const early = await recordNotice(unresolved, { notifiedOn: '2027-03-04' });
      const notified = await recordNotice(online.id, { notifiedOn: '2027-03-04' });

      expect(early.statusCode).toBe(409);
      expect(notified.statusCode).toBe(409);
      expect(notified.json()).toMatchObject({ code: 'declarant-notified' });
    });
  });

  describe('representations received in writing', () => {
    it("are entered by the access officer on the declarant's behalf, with the letter's scan, shown as received in writing", async () => {
      const { id } = await noticeServed();
      const scan = api.documents.givenUpload('psc', {
        uploadedBy: officer.sub,
        fileName: 'bwire-letter.pdf',
      });

      const response = await enter(id, {
        stance: 'object',
        text: OBJECTION,
        attachments: [scan.id],
      });

      expect(response.statusCode, response.body).toBe(200);
      const view = response.json<OfficerRequestView>();
      expect(
        contractErrors(okResponse('/v1/access/requests/{requestId}/representations', 'put'), view),
      ).toEqual([]);
      expect(view.representations).toMatchObject({
        stance: 'object',
        text: OBJECTION,
        attachments: [{ uploadId: scan.id, fileName: 'bwire-letter.pdf' }],
        receivedInWriting: true,
        recordedBy: 'Peter Access',
      });
      expect(view.timeline.at(-1)).toMatchObject({
        kind: 'representations',
        actor: 'Peter Access',
        summary: 'Representations received in writing',
        inWriting: true,
      });
      expect(api.documents.linked).toContain(scan.id);
      const [event] = await api.events(ACCESS_REQUEST_REPRESENTATIONS);
      expect(accessRequestRepresentationsDataSchema.parse(event?.data)).toMatchObject({
        receivedInWriting: true,
        actor: officer.sub,
        personId: null,
      });
      const [row] = await api.asPlatform((tx) =>
        tx.select().from(representations).where(eq(representations.requestId, id)),
      );
      expect(row).toMatchObject({ personId: null, recordedBy: officer.sub });

      // The supervisor reads them; the officer can download the scan.
      const read = await api.get(`/v1/access/requests/${id}/officer`, supervisor);
      expect(read.json<OfficerRequestView>().representations?.receivedInWriting).toBe(true);
      const download = await api.get(
        `/v1/access/requests/${id}/representations/attachments/${scan.id}/download`,
        officer,
      );
      expect(download.statusCode, download.body).toBe(200);
    });

    it('consent received in writing sends the request under decision at once', async () => {
      const { id } = await noticeServed();

      const response = await enter(id, { stance: 'consent', text: '', attachments: [] });

      expect(response.statusCode, response.body).toBe(200);
      expect(response.json<OfficerRequestView>().status).toBe('under-decision');
    });

    it("refuses another's upload (400), the supervisor (403), after the window (409), and a declarant notified online (409)", async () => {
      const { id, anne } = await noticeServed();
      const others = api.documents.givenUpload('psc', { uploadedBy: 'someone-else' });

      const foreign = await enter(id, { stance: 'context', text: 'x', attachments: [others.id] });
      const asSupervisor = await enter(
        id,
        { stance: 'context', text: 'x', attachments: [] },
        supervisor,
      );
      expect(foreign.statusCode).toBe(400);
      expect(foreign.json()).toMatchObject({ errors: [{ path: 'attachments.0' }] });
      expect(asSupervisor.statusCode).toBe(403);

      api.clock.set(WINDOW_ENDS_AT);
      const late = await enter(id, { stance: 'context', text: 'x', attachments: [] });
      expect(late.statusCode).toBe(409);
      expect(late.json()).toMatchObject({ code: 'representations-closed' });

      api.clock.set(NOW);
      const online = await notifiedRequest(api, anne);
      const forOnline = await enter(online.id, { stance: 'context', text: 'x', attachments: [] });
      expect(forOnline.statusCode).toBe(409);
    });
  });

  describe('the officer onboards later', () => {
    it('the request is linked to them by the roster record: their notice, the representations received in writing and their history show it', async () => {
      const { bwire, id, reference } = await noticeServed();
      const scan = api.documents.givenUpload('psc', { uploadedBy: officer.sub });
      expect(
        (await enter(id, { stance: 'object', text: OBJECTION, attachments: [scan.id] })).statusCode,
      ).toBe(200);
      const personId = api.directory.onboard(bwire.id);

      await onboarded(bwire.id, personId);

      expect(await rowOf(api, id)).toMatchObject({ resolvedPersonId: personId });
      const bwireCaller = declarant(personId);
      const notices = await api.get('/v1/me/access-notices', bwireCaller);
      expect(notices.statusCode, notices.body).toBe(200);
      const [notice] = notices.json<DeclarantNotice[]>();
      expect(notice).toMatchObject({
        requestId: id,
        reference,
        notifiedAt: NOTIFIED_AT,
        noticeChannel: 'written',
        windowEndsAt: WINDOW_ENDS_AT,
        canRespond: true,
        representations: {
          stance: 'object',
          receivedInWriting: true,
          // Staff are not named to the declarant.
          recordedBy: null,
        },
      });

      const history = await api.get('/v1/me/access-history', bwireCaller);
      const entries = history.json<AccessHistoryEntry[]>();
      expect(entries.map((entry) => [entry.kind, entry.inWriting, entry.actor])).toEqual([
        ['representations', true, null],
        ['notified', true, null],
      ]);

      // They may amend online while the window is open, keeping the officer's scan.
      const amended = await api.send(
        'PUT',
        `/v1/me/access-notices/${id}/representations`,
        bwireCaller,
        { stance: 'context', text: 'Further context, online.', attachments: [scan.id] },
      );
      expect(amended.statusCode, amended.body).toBe(200);
      expect(amended.json<FormKDeclarantNotice>().representations).toMatchObject({
        receivedInWriting: false,
        attachments: [{ uploadId: scan.id }],
      });
    });

    it('onboarded while the window is open: told online too, with the last day of the window', async () => {
      const { bwire, id, reference } = await noticeServed();
      const personId = api.directory.onboard(bwire.id);

      await onboarded(bwire.id, personId);

      const sent = await api.eventually(() => {
        const found = api.notifications.sent.filter((message) =>
          message.template.startsWith('access-request-notified-'),
        );
        return found.length === 2 ? found : undefined;
      });
      expect(sent.map((message) => message.template).sort()).toEqual([
        'access-request-notified-email',
        'access-request-notified-sms',
      ]);
      for (const message of sent) {
        expect(message).toMatchObject({
          recipient: { kind: 'person', personId },
          tenant: 'psc',
          // The window ends at the end of 13 March in Nairobi.
          params: { reference, respondBy: '2027-03-13' },
        });
      }
      // Still the written notice: no second notification, window unchanged.
      expect(await rowOf(api, id)).toMatchObject({
        notifiedAt: new Date(NOTIFIED_AT),
        windowEndsAt: new Date(WINDOW_ENDS_AT),
      });
      expect((await entriesOf(id)).filter((entry) => entry.kind === 'notified')).toHaveLength(1);
    });

    it('onboarded after the decision: told the outcome online', async () => {
      const { bwire, id } = await noticeServed();
      // Their consent, received in writing, closes the window; the request is decided (a
      // denial: no package to wait on).
      expect((await enter(id, { stance: 'consent', text: '', attachments: [] })).statusCode).toBe(
        200,
      );
      const decided = await decide(api, id, {
        outcome: 'deny',
        grounds: ['frivolous-vexatious'],
        reasons: 'No reason connected to public duties.',
      });
      expect(decided.statusCode, decided.body).toBe(200);
      // The decision's notices went out while Bwire had no account: to the applicant alone.
      await api.temporal.workflow.getHandle(accessRequestWorkflowId(id)).result();
      expect(
        api.notifications.sent.filter((message) => message.template.startsWith('access-decision-')),
      ).toHaveLength(2);
      const personId = api.directory.onboard(bwire.id);

      await onboarded(bwire.id, personId);

      const sent = await api.eventually(() =>
        api.notifications.sent.find(
          (message) => message.template === 'access-decision-declarant-email',
        ),
      );
      expect(sent).toMatchObject({
        recipient: { kind: 'person', personId },
        params: { outcome: 'denied' },
      });
      expect(
        api.notifications.sent.filter((message) =>
          message.template.startsWith('access-request-notified-'),
        ),
      ).toEqual([]);
    });

    it('onboarded after the window closed, before the decision: nothing now, the decision tells them', async () => {
      const { bwire, id } = await noticeServed();
      expect((await enter(id, { stance: 'consent', text: '', attachments: [] })).statusCode).toBe(
        200,
      );
      const personId = api.directory.onboard(bwire.id);

      await onboarded(bwire.id, personId);

      const run: unknown = await api.temporal.workflow
        .getHandle(onboardedNoticeWorkflowId(id))
        .result();
      expect(run).toEqual({ outcome: 'not-relevant' });
      expect(
        api.notifications.sent.filter(
          (message) =>
            message.recipient.kind === 'person' && message.recipient.personId === personId,
        ),
      ).toEqual([]);
    });

    it('onboarded before any written notice: the declarant is notified online', async () => {
      const { bwire, id } = await resolvedToBwire();
      const personId = api.directory.onboard(bwire.id);

      await onboarded(bwire.id, personId);

      const row = await api.eventually(async () => {
        const found = await rowOf(api, id);
        return found.notifiedAt === null ? undefined : found;
      });
      expect(row).toMatchObject({
        status: 'awaiting-representations',
        resolvedPersonId: personId,
        writtenNotice: null,
      });
      const sent = await api.eventually(() =>
        api.notifications.sent.find(
          (message) => message.template === 'access-request-notified-email',
        ),
      );
      expect(sent.recipient).toEqual({ kind: 'person', personId });
      const view = await api.get(`/v1/access/requests/${id}/officer`, officer);
      expect(view.json<OfficerRequestView>()).toMatchObject({
        declarantOnboarded: true,
        notice: { channel: 'online', notifiedOn: null, recordedBy: null },
      });
    });

    it('the event lost: the workflow reads the record from the directory and links it itself', async () => {
      const { bwire, id } = await resolvedToBwire();
      const personId = api.directory.onboard(bwire.id);

      // Only the workflow is told (as by its six-hourly read).
      await api.temporal.workflow.getHandle(accessRequestWorkflowId(id)).signal('onboarded');

      const row = await api.eventually(async () => {
        const found = await rowOf(api, id);
        return found.notifiedAt === null ? undefined : found;
      });
      expect(row.resolvedPersonId).toBe(personId);
    });
  });
});
