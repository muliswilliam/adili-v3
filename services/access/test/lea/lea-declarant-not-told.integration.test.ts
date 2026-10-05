import { randomUUID } from 'node:crypto';

import { createEnvelope } from '@adili/events';
import { DECLARANT } from '@adili/roles';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { RosterCandidateFacts } from '../../src/directory/directory-client.js';
import type { LeaRequest } from '../../src/lea/representation.js';
import {
  DECLARANT_ONBOARDED,
  DeclarantOnboardedConsumer,
} from '../../src/requests/declarant-onboarded.consumer.js';
import { type AccessApi, startAccessApi } from '../support/access-api.js';
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
const GRANT_REASONS = 'Written request from a provisioned DCI account; ongoing investigation.';

/**
 * A law enforcement request is not the declarant's to see (product decision, 2026-10-05; #614):
 * the officer sought, with an account or none, is never invited, notified or shown the request,
 * not even after they onboard. Their roster record still identifies them for the access officer,
 * and an officer with no account still means the agency's officer gets the nil letter.
 */
describe('Law enforcement requests are never told to the declarant', () => {
  let api: AccessApi;
  let bwire: RosterCandidateFacts;
  const { officer } = callers;
  const { peter } = leaCallers;

  beforeAll(async () => {
    api = await startAccessApi();
    return () => api.close();
  });

  afterEach(() => api.reset());

  /** Peter's request about Bwire (no account), verified on 12 January and granted on 18. */
  async function grantedAboutBwire(): Promise<LeaRequest> {
    givenCommissions(api, NOW);
    givenLeaOfficers(api);
    bwire = api.directory.givenRosterRecord('psc', {
      personnelFileNumber: 'PF-2014-007731',
      fullName: 'John Bwire Otieno',
      personId: null,
    });
    const request = await submitLea(api);
    api.clock.set('2027-01-12T07:00:00.000Z');
    expect((await verifyLea(api, request.id, bwire.id)).statusCode).toBe(200);
    api.clock.set(DECIDED_AT);
    const response = await decideLea(api, request.id, {
      outcome: 'grant',
      reasons: GRANT_REASONS,
    });
    expect(response.statusCode, response.body).toBe(200);
    return response.json();
  }

  it('after a grant to an officer with no account: no invitation, no message, the nil letter issued', async () => {
    const { id } = await grantedAboutBwire();

    const issued = await api.eventually(async () => {
      const found = await leaRowOf(api, id);
      return found.packageDocumentId === null ? undefined : found;
    });
    expect(issued.packageKind).toBe('nil-letter');
    expect(issued).toMatchObject({ declarantNotifiedAt: null, declarantInvitedAt: null });
    expect(api.directory.invitations).toEqual([]);
    expect(api.notifications.sent.map((message) => message.template)).not.toContain(
      'lea-grant-notice-email',
    );
    const view = (await api.get(`/v1/lea/requests/${id}`, officer)).json<LeaRequest>();
    expect(view.timeline.map((entry) => entry.kind)).not.toContain('notified');
    expect(Object.keys(view)).not.toContain('declarantNotice');
  });

  it('has no written notice to record', async () => {
    const { id } = await grantedAboutBwire();
    const response = await api.send('POST', `/v1/lea/requests/${id}/written-notice`, officer, {
      notifiedOn: '2027-01-20',
    });
    expect(response.statusCode).toBe(404);
  });

  it('once the officer onboards, the request is linked for its officers but never shown to them', async () => {
    const { id } = await grantedAboutBwire();
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
    const declarant = { sub: `declarant-${personId}`, roles: [DECLARANT], tenant: 'psc', personId };
    expect((await api.get('/v1/me/access-notices', declarant)).json()).toEqual([]);
    expect((await api.get('/v1/me/access-history', declarant)).json()).toEqual([]);
    expect(JSON.stringify(api.notifications.sent)).not.toContain(personId);
    // The agency's officer and the access officer still read it.
    expect((await api.get(`/v1/lea/requests/${id}`, peter)).statusCode).toBe(200);
    expect((await api.get(`/v1/lea/requests/${id}`, officer)).statusCode).toBe(200);
  });
});
