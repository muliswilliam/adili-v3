import { randomUUID } from 'node:crypto';

import { createEnvelope } from '@adili/events';
import { LEA_REQUEST_NOTIFIED } from '@adili/events/contracts';
import { leaRequestNotifiedDataSchema } from '@adili/events/contracts/schemas';
import { DECLARANT } from '@adili/roles';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { RosterCandidateFacts } from '../../src/directory/directory-client.js';
import type { LeaRequest } from '../../src/lea/representation.js';
import type { DeclarantNotice } from '../../src/notices/representation.js';
import {
  DECLARANT_ONBOARDED,
  DeclarantOnboardedConsumer,
} from '../../src/requests/declarant-onboarded.consumer.js';
import { type AccessApi, type Caller, startAccessApi } from '../support/access-api.js';
import { contractErrors, okResponse } from '../support/contract.js';
import {
  decideLea,
  givenLeaOfficers,
  leaCallers,
  leaRowOf,
  submitLea,
  verifyLea,
} from '../support/lea.js';
import { callers, givenCommissions } from '../support/requests.js';

/** Monday 11 January 2027, 10:00 in Nairobi. */
const NOW = '2027-01-11T07:00:00.000Z';
/** Granted on 18 January, 15:00 in Nairobi. */
const DECIDED_AT = '2027-01-18T12:00:00.000Z';
/** The written notice is recorded on 21 January, served on 20 January. */
const RECORDED_AT = '2027-01-21T09:00:00.000Z';
const NOTIFIED_ON = '2027-01-20';
const NOTIFIED_AT = '2027-01-19T21:00:00.000Z';
const GRANT_REASONS = 'Written request from a provisioned DCI account; ongoing investigation.';

/**
 * Spec 10 decision 2 for law enforcement requests (r.23(2)): the officer sought is on the roster
 * with no account. The access officer verifies the request to their record all the same; after a
 * grant the workflow has them invited to onboard, issues the agency's officer the nil letter (no
 * declaration of theirs is on Adili), and the access officer records the written notice of the
 * grant. Once the officer onboards, the grant shows among their notices.
 */
describe('Law enforcement grants to an officer with no account: written notice', () => {
  let api: AccessApi;
  let bwire: RosterCandidateFacts;
  const { officer, supervisor } = callers;
  const { peter } = leaCallers;

  beforeAll(async () => {
    api = await startAccessApi();
    return () => api.close();
  });

  afterEach(() => api.reset());

  /** Peter's request about Bwire, verified on 12 January to his record (no account). */
  async function verifiedToBwire(): Promise<LeaRequest> {
    givenCommissions(api, NOW);
    givenLeaOfficers(api);
    bwire = api.directory.givenRosterRecord('psc', {
      personnelFileNumber: 'PF-2014-007731',
      fullName: 'John Bwire Otieno',
      personId: null,
    });
    const request = await submitLea(api);
    api.clock.set('2027-01-12T07:00:00.000Z');
    const response = await verifyLea(api, request.id, bwire.id);
    expect(response.statusCode, response.body).toBe(200);
    return response.json();
  }

  /** Granted on 18 January; the workflow has invited Bwire to onboard. */
  async function granted(): Promise<LeaRequest> {
    const request = await verifiedToBwire();
    api.clock.set(DECIDED_AT);
    const response = await decideLea(api, request.id, {
      outcome: 'grant',
      reasons: GRANT_REASONS,
    });
    expect(response.statusCode, response.body).toBe(200);
    await api.eventually(async () => (await leaRowOf(api, request.id)).declarantInvitedAt !== null);
    return response.json();
  }

  const recordNotice = (id: string, body: unknown, caller: Caller = officer) =>
    api.send('POST', `/v1/lea/requests/${id}/written-notice`, caller, body);

  it('verifies to a record with no account, and the agency officer sees nothing of the declarant', async () => {
    const view = await verifiedToBwire();

    expect(view).toMatchObject({
      status: 'verified',
      resolvedRosterRecordId: bwire.id,
      resolvedName: 'John Bwire Otieno',
      declarantOnboarded: false,
      declarantNotice: null,
    });
    expect((await leaRowOf(api, view.id)).resolvedPersonId).toBeNull();
    const asPeter = await api.get(`/v1/lea/requests/${view.id}`, peter);
    expect(asPeter.json<LeaRequest>()).toMatchObject({
      declarantOnboarded: null,
      declarantInvitedAt: null,
      declarantNotice: null,
    });
  });

  it('after a grant: invited to onboard, the nil letter issued, no grant notice sent until the written notice is recorded', async () => {
    const { id } = await granted();

    const row = await leaRowOf(api, id);
    expect(row).toMatchObject({ declarantNotifiedAt: null });
    expect(api.directory.invitations).toEqual([
      { slug: 'psc', recordId: bwire.id, idempotencyKey: expect.any(String) as unknown },
    ]);
    await api.eventually(() =>
      api.notifications.sent.some((message) => message.template === 'lea-decision-email'),
    );
    expect(api.notifications.sent.map((message) => message.template)).not.toContain(
      'lea-grant-notice-email',
    );
    // An officer with no account filed nothing on Adili: the agency's officer gets the nil
    // letter, without declarations being asked.
    const issued = await api.eventually(async () => {
      const found = await leaRowOf(api, id);
      return found.packageDocumentId === null ? undefined : found;
    });
    expect(issued.packageKind).toBe('nil-letter');
    expect(api.declarations.disclosureCalls).toEqual([]);
    expect(api.documents.issued).toMatchObject([
      {
        type: 'access-nil-letter',
        subjectRef: `lea-request:${id}`,
        payload: {
          legalBasis: 'act-s36-2',
          declarantName: bwire.fullName,
          scope: { includeClarifications: false },
        },
      },
    ]);
    // The officer is told the letter is ready, not that a package is.
    const ready = await api.eventually(() => {
      const found = api.notifications.sent.filter((m) =>
        m.template.startsWith('access-nil-letter-ready'),
      );
      return found.length === 2 ? found : undefined;
    });
    expect(ready[0]).toMatchObject({ params: { reference: issued.reference } });
    expect(api.notifications.sent.map((message) => message.template)).not.toContain(
      'access-package-ready-email',
    );

    api.clock.set(RECORDED_AT);
    const response = await recordNotice(id, { notifiedOn: NOTIFIED_ON });

    expect(response.statusCode, response.body).toBe(200);
    const view = response.json<LeaRequest>();
    expect(
      contractErrors(okResponse('/v1/lea/requests/{leaRequestId}/written-notice', 'post'), view),
    ).toEqual([]);
    expect(view).toMatchObject({
      declarantNotifiedAt: NOTIFIED_AT,
      declarantNotice: {
        channel: 'written',
        notifiedAt: NOTIFIED_AT,
        notifiedOn: NOTIFIED_ON,
        recordedBy: 'Peter Access',
      },
    });
    expect(view.timeline.at(-1)).toMatchObject({
      kind: 'notified',
      summary: 'Declarant notified in writing',
      inWriting: true,
    });
    const [event] = await api.events(LEA_REQUEST_NOTIFIED);
    expect(leaRequestNotifiedDataSchema.parse(event?.data)).toMatchObject({
      channel: 'written',
      notifiedOn: NOTIFIED_ON,
      actor: officer.sub,
      personId: null,
    });

    const again = await recordNotice(id, { notifiedOn: NOTIFIED_ON });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: 'declarant-notified' });
  });

  it('400 before the grant or in the future; 409 before a grant; supervisor 403', async () => {
    const verified = await verifiedToBwire();
    expect((await recordNotice(verified.id, { notifiedOn: '2027-01-12' })).statusCode).toBe(409);

    api.clock.set(DECIDED_AT);
    await decideLea(api, verified.id, { outcome: 'grant', reasons: GRANT_REASONS });
    api.clock.set(RECORDED_AT);

    const before = await recordNotice(verified.id, { notifiedOn: '2027-01-17' });
    const future = await recordNotice(verified.id, { notifiedOn: '2027-01-22' });
    for (const response of [before, future]) {
      expect(response.statusCode, response.body).toBe(400);
      expect(response.json()).toMatchObject({ errors: [{ path: 'notifiedOn' }] });
    }
    expect(
      (await recordNotice(verified.id, { notifiedOn: NOTIFIED_ON }, supervisor)).statusCode,
    ).toBe(403);
  });

  it('once the officer onboards, the grant shows among their notices, and they are told of it online', async () => {
    const { id, reference } = await granted();
    api.clock.set(RECORDED_AT);
    expect((await recordNotice(id, { notifiedOn: NOTIFIED_ON })).statusCode).toBe(200);
    const personId = api.directory.onboard(bwire.id);

    await api.app.get(DeclarantOnboardedConsumer).onboarded(
      createEnvelope('adili/directory', {
        type: DECLARANT_ONBOARDED,
        subject: bwire.id,
        tenant: 'psc',
        data: {
          personId,
          ofr: 'OFR-2027-0000002-H',
          rosterRecordId: bwire.id,
          keycloakUserId: randomUUID(),
          linked: false,
        },
      }),
    );

    expect((await leaRowOf(api, id)).resolvedPersonId).toBe(personId);
    const notices = await api.get('/v1/me/access-notices', {
      sub: `declarant-${personId}`,
      roles: [DECLARANT],
      tenant: 'psc',
      personId,
    });
    expect(notices.json<DeclarantNotice[]>()).toEqual([
      expect.objectContaining({
        requestId: id,
        reference,
        kind: 'lea',
        notifiedAt: NOTIFIED_AT,
        noticeChannel: 'written',
      }),
    ]);
    // The written notice told them; their new account is told online too.
    const sent = await api.eventually(() => {
      const found = api.notifications.sent.filter((message) =>
        message.template.startsWith('lea-grant-notice-'),
      );
      return found.length === 2 ? found : undefined;
    });
    for (const message of sent) {
      expect(message).toMatchObject({
        recipient: { kind: 'person', personId },
        params: { reference, grantedOn: '2027-01-18' },
      });
    }
    // Still notified in writing, once.
    expect(await leaRowOf(api, id)).toMatchObject({ declarantNotifiedAt: new Date(NOTIFIED_AT) });
  });
});
