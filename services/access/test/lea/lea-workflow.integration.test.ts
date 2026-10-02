import { createEnvelope, type EventEnvelope } from '@adili/events';
import { DOCUMENT_DOWNLOADED, type DocumentDownloadedData } from '@adili/events/contracts';
import { ACCESS_OFFICER } from '@adili/roles';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { DisclosureDocument } from '../../src/declarations/declarations-client.js';
import type { RosterCandidateFacts } from '../../src/directory/directory-client.js';
import { LeaRequestActivities } from '../../src/lea/activities.js';
import { leaRequestWorkflowId, type LeaRequestWorkflowInput } from '../../src/lea/contract.js';
import type { LeaRequest, LeaRequestRow } from '../../src/lea/representation.js';
import type { DeclarantNotice } from '../../src/notices/representation.js';
import type { QueuePage } from '../../src/requests/officer-representation.js';
import { DownloadsConsumer } from '../../src/requests/downloads.consumer.js';
import { type AccessApi, startAccessApi } from '../support/access-api.js';
import { contractErrors, okResponse } from '../support/contract.js';
import {
  decideLea,
  givenLeaOfficers,
  LEA_INPUT,
  leaCallers,
  leaRowOf,
  submitLea,
  verifyLea,
  withdrawLea,
} from '../support/lea.js';
import { callers, declarantOf, ENDED_TRANSACTION, givenCommissions } from '../support/requests.js';

/** Monday 11 January 2027, 10:00 in Nairobi. */
const NOW = '2027-01-11T07:00:00.000Z';
const DEADLINE = '2027-01-25T07:00:00.000Z';
/** Decided on 18 January, 15:00 in Nairobi; the package downloadable for 14 days. */
const DECIDED_AT = '2027-01-18T12:00:00.000Z';
const EXPIRES_AT = '2027-02-01T12:00:00.000Z';
const VERIFICATION_ID = 'ADL-7Q4K-M2XR-9HTC-2B7F-Q3ZD-9KMV-8P';
const GRANT_REASONS = 'Written request from a provisioned DCI account; ongoing investigation.';

function disclosureOf(reference: string): DisclosureDocument {
  return {
    schemaVersion: 'disclosure.v1',
    grantReference: reference,
    personName: 'Anne Njeri Mutua',
    commission: { slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission' },
    versions: [],
  };
}

/**
 * `LeaRequestWorkflow` on the compose Temporal with the service's activities (S11): after a grant
 * the agency's officer is told, then the declarant (only now, r.23(2)), and the officer's package
 * is issued with legal basis `act-s36-2`; after a denial only the officer is told. Downloads are
 * registered; the day-10 reminder and the day-14 breach flag are run as activities here (their
 * timing is `lea-request-workflow.test.ts`'s, with time skipping).
 */
describe('LeaRequestWorkflow and its activities (S11)', () => {
  let api: AccessApi;
  let activities: LeaRequestActivities;
  let consumer: DownloadsConsumer;
  let anne: RosterCandidateFacts;
  const { peter } = leaCallers;
  const { officer } = callers;

  beforeAll(async () => {
    api = await startAccessApi();
    activities = api.app.get(LeaRequestActivities);
    consumer = api.app.get(DownloadsConsumer);
    return () => api.close();
  });

  afterEach(() => api.reset());

  /** Peter's request to the PSC about Anne, verified on 12 January. */
  async function verified(): Promise<LeaRequest> {
    ({ anne } = givenCommissions(api, NOW));
    givenLeaOfficers(api);
    const request = await submitLea(api);
    api.clock.set('2027-01-12T07:00:00.000Z');
    const response = await verifyLea(api, request.id, anne.id);
    expect(response.statusCode, response.body).toBe(200);
    api.declarations.givenDisclosure(anne.personId ?? '', disclosureOf(request.reference));
    api.clock.set(DECIDED_AT);
    return response.json();
  }

  const untilSent = (...templates: string[]) =>
    api.eventually(() =>
      templates.every((template) => api.notifications.sent.some((m) => m.template === template))
        ? api.notifications.sent
        : undefined,
    );

  const untilPackaged = (id: string): Promise<LeaRequestRow> =>
    api.eventually(async () => {
      const row = await leaRowOf(api, id);
      return row.packageDocumentId === null ? undefined : row;
    });

  it('S11: a grant: the officer told, then the declarant (r.23(2)), the package issued to the officer with legal basis act-s36-2 and watermarked with the agency, then announced', async () => {
    const { id, reference } = await verified();

    const response = await decideLea(api, id, { outcome: 'grant', reasons: GRANT_REASONS });
    expect(response.statusCode, response.body).toBe(200);

    const row = await untilPackaged(id);
    const sent = await untilSent('access-package-ready-email', 'access-package-ready-sms');
    expect(sent.map((message) => message.template)).toEqual([
      'lea-decision-email',
      'lea-decision-sms',
      'lea-grant-notice-email',
      'lea-grant-notice-sms',
      'access-package-ready-email',
      'access-package-ready-sms',
    ]);
    expect(sent[0]).toMatchObject({
      recipient: { kind: 'person', personId: peter.personId },
      tenant: 'psc',
      params: {
        reference,
        commissionName: 'Public Service Commission',
        outcome: 'granted',
        signInUrl: `http://localhost:3020/lea/requests/${id}`,
      },
    });
    expect(sent[2]).toMatchObject({
      recipient: { kind: 'person', personId: anne.personId },
      params: {
        reference,
        commissionName: 'Public Service Commission',
        agencyName: 'Directorate of Criminal Investigations',
        grantedOn: '2027-01-18',
        signInUrl: 'http://localhost:3010/access/notices',
      },
    });
    expect(sent[4]).toMatchObject({
      recipient: { kind: 'person', personId: peter.personId },
      params: { reference, downloadUntil: '2027-02-01' },
    });

    expect(api.declarations.disclosureCalls).toEqual([
      {
        personId: anne.personId,
        tenant: 'psc',
        officerSubject: officer.sub,
        grantReference: reference,
        legalBasis: 'act-s36-2',
        recipientSubject: peter.sub,
        years: [2026],
        includeSpouses: true,
        includeChildren: false,
        sections: ['income', 'assets'],
      },
    ]);
    expect(api.review.calls).toEqual([]);
    expect(api.documents.issued).toEqual([
      expect.objectContaining({
        tenant: 'psc',
        type: 'access-package',
        templateVersion: 1,
        subjectRef: `lea-request:${id}`,
        subjectPersonId: peter.personId,
        payload: {
          disclosure: disclosureOf(reference),
          legalBasis: 'act-s36-2',
          recipient: {
            name: 'Peter Mwangi',
            organisation: 'Directorate of Criminal Investigations',
          },
          grantedAt: DECIDED_AT,
          scope: {
            years: [2026],
            includeSpouses: true,
            includeChildren: false,
            sections: ['income', 'assets'],
            includeClarifications: false,
          },
          // Law enforcement grants never carry clarifications.
          clarifications: null,
        },
        watermark: { recipientName: 'Peter Mwangi, DCI', reference, date: '2027-01-18' },
        downloadWindowDays: 14,
      }),
    ]);
    expect(row).toMatchObject({
      declarantNotifiedAt: new Date(DECIDED_AT),
      downloadExpiresAt: new Date(EXPIRES_AT),
    });

    const mine = await api.get(`/v1/lea/requests/${id}`, peter);
    expect(mine.json<LeaRequest>()).toMatchObject({
      status: 'granted',
      declarantNotifiedAt: DECIDED_AT,
      package: {
        documentId: row.packageDocumentId,
        verificationId: row.packageVerificationId,
        issuedAt: DECIDED_AT,
        downloadExpiresAt: EXPIRES_AT,
        downloads: 0,
      },
    });
    expect(mine.json<LeaRequest>().timeline.map((entry) => entry.kind)).toEqual([
      'received',
      'verified',
      'decided',
      'notified',
      'package-issued',
    ]);
    for (const type of ['lea.request.notified.v1', 'lea.request.package-issued.v1']) {
      expect(await api.events(type), type).toEqual([
        expect.objectContaining({
          data: expect.objectContaining({
            legalBasis: 'act-s36-2',
            personId: anne.personId,
          }) as unknown,
        }),
      ]);
    }

    // The declarant now sees the grant among their notices: the agency, the case, the outcome,
    // the scope granted (what was disclosed) and the dates, never the agency's reason or the
    // decision's reasons (user decisions 4 and round 2).
    const notices = await api.get('/v1/me/access-notices', declarantOf(anne));
    expect(contractErrors(okResponse('/v1/me/access-notices', 'get'), notices.json())).toEqual([]);
    expect(notices.json<DeclarantNotice[]>()).toEqual([
      {
        requestId: id,
        reference,
        kind: 'lea',
        commission: { slug: 'psc', name: 'Public Service Commission' },
        status: 'granted',
        agency: { code: 'DCI', name: 'Directorate of Criminal Investigations' },
        caseReference: 'DCI/ECU/121/2027',
        outcome: 'grant',
        grantedScope: {
          years: [2026],
          includeSpouses: true,
          includeChildren: false,
          sections: ['income', 'assets'],
          includeClarifications: false,
        },
        decidedAt: DECIDED_AT,
        notifiedAt: DECIDED_AT,
        noticeChannel: 'online',
      },
    ]);
    expect(notices.body).not.toContain(GRANT_REASONS);
    expect(notices.body).not.toContain(LEA_INPUT.reason);
    // It takes no representations.
    const representations = await api.send(
      'PUT',
      `/v1/me/access-notices/${id}/representations`,
      declarantOf(anne),
      { stance: 'object', text: 'No.', attachments: [] },
    );
    expect(representations.statusCode).toBe(404);
  });

  it('S11: a denial: the agency is told (its officer, reasons behind sign-in); the declarant never hears of it', async () => {
    const { id, reference } = await verified();

    const response = await decideLea(api, id, {
      outcome: 'deny',
      grounds: ['prejudice-proceeding'],
      reasons: 'Disclosure now may prejudice a proceeding before the Commission.',
    });
    expect(response.statusCode, response.body).toBe(200);

    const sent = await untilSent('lea-decision-email', 'lea-decision-sms');
    await api.eventually(async () => {
      const run = await api.temporal.workflow.getHandle(leaRequestWorkflowId(id)).describe();
      return run.status.name === 'COMPLETED';
    });
    expect(sent.map((message) => message.template)).toEqual([
      'lea-decision-email',
      'lea-decision-sms',
    ]);
    expect(sent[0]).toMatchObject({
      recipient: { kind: 'person', personId: peter.personId },
      params: { reference, outcome: 'denied' },
    });
    expect(api.documents.issued).toEqual([]);
    expect(api.declarations.disclosureCalls).toEqual([]);
    expect((await leaRowOf(api, id)).declarantNotifiedAt).toBeNull();
    expect((await api.get('/v1/me/access-notices', declarantOf(anne))).json()).toEqual([]);
    // The officer reads the reasons in the console.
    expect(
      (await api.get(`/v1/lea/requests/${id}`, peter)).json<LeaRequest>().decision,
    ).toMatchObject({
      outcome: 'deny',
      reasons: 'Disclosure now may prejudice a proceeding before the Commission.',
    });
  });

  describe('downloads', () => {
    function downloaded(
      row: LeaRequestRow,
      data: Partial<DocumentDownloadedData> = {},
    ): EventEnvelope {
      return createEnvelope('adili/documents', {
        type: DOCUMENT_DOWNLOADED,
        subject: row.packageDocumentId ?? '',
        tenant: 'psc',
        data: {
          documentId: row.packageDocumentId ?? '',
          verificationId: VERIFICATION_ID,
          documentType: 'access-package',
          issuerTenant: 'psc',
          subjectRef: `lea-request:${row.id}`,
          downloadedBy: peter.sub,
          downloadedAt: '2027-01-19T08:00:00.000Z',
          downloadExpiresAt: EXPIRES_AT,
          ...data,
        } satisfies DocumentDownloadedData,
      });
    }

    it("S11: each download of the officer's package is registered once, with the officer as actor", async () => {
      const { id } = await verified();
      await decideLea(api, id, { outcome: 'grant', reasons: GRANT_REASONS });
      const row = await untilPackaged(id);
      await api.endWorkflows([leaRequestWorkflowId(id)]);
      const first = downloaded(row);

      expect(await consumer.downloaded(first)).toBe(true);
      expect(await consumer.downloaded(first)).toBe(false);
      // Another document under the request's subject: not its package, nothing registered.
      expect(
        await consumer.downloaded(
          downloaded(row, { documentId: '0199c000-0000-7000-8000-0000000000aa' }),
        ),
      ).toBe(true);

      const mine = await api.get(`/v1/lea/requests/${id}`, peter);
      expect(mine.json<LeaRequest>().package?.downloads).toBe(1);
      expect(mine.json<LeaRequest>().timeline.at(-1)).toMatchObject({
        kind: 'downloaded',
        at: '2027-01-19T08:00:00.000Z',
        actor: 'Peter Mwangi',
      });
      expect(await api.events('lea.request.downloaded.v1')).toEqual([
        expect.objectContaining({
          tenant: 'psc',
          subject: id,
          data: expect.objectContaining({
            kind: 'downloaded',
            legalBasis: 'act-s36-2',
            actor: peter.sub,
            documentId: row.packageDocumentId,
          }) as unknown,
        }),
      ]);
    });

    it('records the expiry of the package once, at the end of its window', async () => {
      const { id } = await verified();
      await decideLea(api, id, { outcome: 'grant', reasons: GRANT_REASONS });
      await untilPackaged(id);
      await api.endWorkflows([leaRequestWorkflowId(id)]);
      const input = workflowInput(id);

      expect(await activities.expireLeaPackage(input)).toBe('expired');
      expect(await activities.expireLeaPackage(input)).toBe('expired');

      expect(await api.events('lea.request.expired.v1')).toEqual([
        expect.objectContaining({ data: expect.objectContaining({ at: EXPIRES_AT }) as unknown }),
      ]);
    });
  });

  describe('the fourteen-day clock', () => {
    async function receivedOnly(): Promise<LeaRequest> {
      ({ anne } = givenCommissions(api, NOW));
      givenLeaOfficers(api);
      api.directory.givenStaff(
        'psc',
        ACCESS_OFFICER,
        { subject: officer.sub, email: 'peter.access@psc.go.ke' },
        { subject: 'officer-2', email: 'jane.access@psc.go.ke' },
      );
      const request = await submitLea(api);
      await api.endWorkflows([leaRequestWorkflowId(request.id)]);
      return request;
    }

    it('S11: day 10: the access officers are reminded by email of the deadline, to verify an unverified request', async () => {
      const { id, reference } = await receivedOnly();
      api.clock.set('2027-01-21T07:00:00.000Z');

      expect(await activities.remindLeaOfficers(workflowInput(id))).toBe('sent');
      expect(await activities.remindLeaOfficers(workflowInput(id))).toBe('sent');

      expect(api.notifications.sent).toEqual([
        expect.objectContaining({
          channel: 'email',
          recipient: { kind: 'address', to: 'peter.access@psc.go.ke' },
          template: 'access-officer-reminder-email',
          tenant: 'psc',
          params: {
            reference,
            commissionName: 'Public Service Commission',
            task: 'identify-officer',
            dueDate: '2027-01-25',
            daysLeft: 4,
            signInUrl: `http://localhost:3020/access/lea-requests/${id}`,
          },
        }),
        expect.objectContaining({ recipient: { kind: 'address', to: 'jane.access@psc.go.ke' } }),
      ]);
      expect((await leaRowOf(api, id)).remindedAt).toEqual(new Date('2027-01-21T07:00:00.000Z'));
    });

    it('S11: day 14: an undecided request is flagged breached at its deadline, shown late in the queue; the access officer can still decide', async () => {
      const { id } = await receivedOnly();
      api.clock.set('2027-01-25T09:00:00.000Z');

      expect(await activities.flagLeaBreach(workflowInput(id))).toBe('flagged');
      expect(await activities.flagLeaBreach(workflowInput(id))).toBe('skipped');

      expect((await api.get(`/v1/lea/requests/${id}`, officer)).json<LeaRequest>().breachedAt).toBe(
        DEADLINE,
      );
      const queue = await api.get('/v1/commissions/psc/access/requests?kind=lea', officer);
      expect(queue.json<QueuePage>().items[0]).toMatchObject({ id, late: true });
      const deny = await decideLea(api, id, {
        outcome: 'deny',
        grounds: ['not-objectives'],
        reasons: 'No ongoing investigation shown.',
      });
      expect(deny.statusCode).toBe(200);
      expect(
        (await api.get('/v1/commissions/psc/access/requests?kind=lea', officer)).json<QueuePage>()
          .items[0],
      ).toMatchObject({ late: false });
    });

    it('withdrawn by its officer: the access officers are told by email, once each; the declarant never', async () => {
      const { id, reference } = await receivedOnly();
      expect((await withdrawLea(api, id)).statusCode).toBe(200);

      expect(await activities.leaWithdrawnNotice(workflowInput(id))).toBe('sent');
      expect(await activities.leaWithdrawnNotice(workflowInput(id))).toBe('sent');

      expect(api.notifications.sent).toEqual([
        expect.objectContaining({
          channel: 'email',
          recipient: { kind: 'address', to: 'peter.access@psc.go.ke' },
          template: 'lea-withdrawn-email',
          tenant: 'psc',
          params: {
            reference,
            commissionName: 'Public Service Commission',
            signInUrl: `http://localhost:3020/access/lea-requests/${id}`,
          },
        }),
        expect.objectContaining({ recipient: { kind: 'address', to: 'jane.access@psc.go.ke' } }),
      ]);
      expect(new Set(api.notifications.sent.map((m) => m.idempotencyKey)).size).toBe(2);
    });

    it('a request not withdrawn gets no withdrawal notice', async () => {
      const { id } = await receivedOnly();

      expect(await activities.leaWithdrawnNotice(workflowInput(id))).toBe('skipped');
      expect(api.notifications.sent).toEqual([]);
    });

    it('a decided request gets no reminder and no breach flag', async () => {
      const { id } = await receivedOnly();
      await decideLea(api, id, {
        outcome: 'deny',
        grounds: ['not-objectives'],
        reasons: 'No ongoing investigation shown.',
      });

      expect(await activities.remindLeaOfficers(workflowInput(id))).toBe('skipped');
      expect(await activities.flagLeaBreach(workflowInput(id))).toBe('skipped');
      expect((await leaRowOf(api, id)).breachedAt).toBeNull();
      expect(
        api.notifications.sent.filter((m) => m.template === 'access-officer-reminder-email'),
      ).toEqual([]);
    });
  });
});

function workflowInput(requestId: string): LeaRequestWorkflowInput {
  return {
    tenant: 'psc',
    requestId,
    receivedAt: NOW,
    deadlineAt: DEADLINE,
    transactionId: ENDED_TRANSACTION,
  };
}
