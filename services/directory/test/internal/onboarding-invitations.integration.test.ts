import { randomUUID } from 'node:crypto';

import { withTenant } from '@adili/data-access';
import { sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { onboardingInvitations, outbox } from '../../src/db/schema.js';
import type { OnboardingInvitation } from '../../src/roster/records/representation.js';
import { contractErrors, okResponse } from '../support/contract.js';
import { type Caller, type DirectoryApi, startDirectoryApi } from '../support/directory-api.js';
import { givenCommissions } from '../support/fixtures.js';
import { givenOnboardedPerson, givenRoster } from '../support/onboarding.js';
import type { Problem } from '../support/reporting-officers.js';

/**
 * Spec 10 (decision 2): an access request names a roster officer who has not onboarded, and the
 * access service asks the directory to invite them to set up their account. The directory sends
 * the invitation to the roster's contacts through notifications, records it once per
 * Idempotency-Key, and never returns the contacts.
 */

const NOW = new Date('2026-10-02T07:00:00Z');
const PATH = '/internal/v1/commissions/{slug}/roster/records/{recordId}/onboarding-invitations';
const invite = (slug: string, recordId: string) =>
  `/internal/v1/commissions/${slug}/roster/records/${recordId}/onboarding-invitations`;
/** The access service's client credentials token. */
const ACCESS: Caller = {
  sub: 'service-account-access',
  azp: 'access',
  scope: 'profile directory:internal',
};
const ACTING_PSC = { 'x-acting-tenant': 'psc' };

let api: DirectoryApi;
let ids: Map<string, string>;

const record = (fileNumber: string) => ids.get(fileNumber) ?? '';

const invitationEvents = async () =>
  (
    await api.db
      .select({ type: outbox.eventType, envelope: outbox.envelope })
      .from(outbox)
      .orderBy(outbox.id)
  ).filter((event) => event.type === 'roster.onboarding-invitation.sent.v1');

beforeAll(async () => {
  api = await startDirectoryApi();
  return () => api.close();
});

beforeEach(async () => {
  await api.reset();
  api.clock.set(NOW);
  await givenCommissions(api.db, [
    { slug: 'psc', name: 'Public Service Commission' },
    { slug: 'tsc', name: 'Teachers Service Commission' },
  ]);
  ids = await givenRoster(api, 'psc', [
    {
      personnelFileNumber: 'PSC/1',
      fullName: 'Achieng Otieno',
      nationalId: '11223344',
      email: 'achieng@example.go.ke',
      phone: '+254711000001',
    },
    { personnelFileNumber: 'PSC/2', fullName: 'Baraka Mwangi', nationalId: '22334455' },
    {
      personnelFileNumber: 'PSC/3',
      fullName: 'Chebet Rotich',
      nationalId: '33445566',
      email: 'chebet@example.go.ke',
    },
  ]);
});

describe('invitations to onboard (spec 10, decision 2)', () => {
  it("sends the invitation to the roster's email and phone, naming the Commission, and records it", async () => {
    const response = await api.post(invite('psc', record('PSC/1')), undefined, ACCESS, {
      headers: ACTING_PSC,
    });

    expect(response.statusCode, response.body).toBe(200);
    const invitation = response.json<OnboardingInvitation>();
    expect(contractErrors(okResponse(PATH, 'post'), invitation)).toEqual([]);
    expect(invitation).toEqual({
      id: expect.any(String) as unknown,
      rosterRecordId: record('PSC/1'),
      channels: ['email', 'sms'],
      sentAt: NOW.toISOString(),
    });
    expect(response.body).not.toContain('achieng@example.go.ke');
    expect(api.invitations.sent()).toEqual([
      expect.objectContaining({
        channel: 'email',
        to: 'achieng@example.go.ke',
        commissionName: 'Public Service Commission',
        getStartedUrl: expect.stringMatching(/\/get-started\?commission=psc$/) as unknown,
        tenant: 'psc',
      }),
      expect.objectContaining({ channel: 'sms', to: '+254711000001' }),
    ]);
    const rows = await withTenant(api.db, { tenant: 'psc', subject: 'test' }, (tx) =>
      tx.select().from(onboardingInvitations),
    );
    expect(rows).toEqual([
      expect.objectContaining({ rosterRecordId: record('PSC/1'), requestedBy: 'access' }),
    ]);
    // The write's audit record, in its transaction (ADR-008): ids and channels, no contacts.
    const events = await invitationEvents();
    expect(events.map(({ envelope }) => envelope)).toEqual([
      expect.objectContaining({
        type: 'roster.onboarding-invitation.sent.v1',
        subject: invitation.id,
        tenant: 'psc',
        data: {
          invitationId: invitation.id,
          rosterRecordId: record('PSC/1'),
          channels: ['email', 'sms'],
          actor: { kind: 'client', id: 'access' },
        },
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain('achieng@example.go.ke');
  });

  it('is one invitation per Idempotency-Key: a retry sends nothing again', async () => {
    const key = randomUUID();
    const first = await api.post(invite('psc', record('PSC/3')), undefined, ACCESS, {
      headers: ACTING_PSC,
      idempotencyKey: key,
    });
    api.clock.set(new Date(NOW.getTime() + 60_000));
    const again = await api.post(invite('psc', record('PSC/3')), undefined, ACCESS, {
      headers: ACTING_PSC,
      idempotencyKey: key,
    });

    expect(again.statusCode, again.body).toBe(200);
    expect(again.json()).toEqual(first.json());
    expect(api.invitations.sent()).toHaveLength(1);
    expect(await invitationEvents()).toHaveLength(1);
  });

  it('is 422 idempotency-key-reused when the key invited another record, after the idempotency store forgot it', async () => {
    const key = randomUUID();
    const first = await api.post(invite('psc', record('PSC/1')), undefined, ACCESS, {
      headers: ACTING_PSC,
      idempotencyKey: key,
    });
    expect(first.statusCode, first.body).toBe(200);
    // The idempotency store keeps a key 24 hours; the invitation table keeps it for good.
    await api.db.execute(sql`delete from idempotency_keys`);

    const other = await api.post(invite('psc', record('PSC/3')), undefined, ACCESS, {
      headers: ACTING_PSC,
      idempotencyKey: key,
    });

    expect(other.statusCode, other.body).toBe(422);
    expect(other.json<Problem>().type).toBe('idempotency-key-reused');
    expect(api.invitations.sent().map(({ to }) => to)).not.toContain('chebet@example.go.ke');
  });

  it('records an invitation on no channel when the roster holds no contact', async () => {
    const response = await api.post(invite('psc', record('PSC/2')), undefined, ACCESS, {
      headers: ACTING_PSC,
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json<OnboardingInvitation>().channels).toEqual([]);
    expect(api.invitations.sent()).toEqual([]);
  });

  it('leaves out a channel notifications could not send on', async () => {
    api.invitations.refuse('+254711000001');

    const response = await api.post(invite('psc', record('PSC/1')), undefined, ACCESS, {
      headers: ACTING_PSC,
    });

    expect(response.json<OnboardingInvitation>().channels).toEqual(['email']);
  });

  it('is 503 with nothing recorded when notifications cannot be reached', async () => {
    api.invitations.failNext();

    const response = await api.post(invite('psc', record('PSC/1')), undefined, ACCESS, {
      headers: ACTING_PSC,
    });

    expect(response.statusCode, response.body).toBe(503);
    const rows = await withTenant(api.db, { tenant: 'psc', subject: 'test' }, (tx) =>
      tx.select().from(onboardingInvitations),
    );
    expect(rows).toEqual([]);
  });

  it('is 409 already-onboarded for an officer with an account', async () => {
    await givenOnboardedPerson(api, { recordIds: [record('PSC/1')] });

    const response = await api.post(invite('psc', record('PSC/1')), undefined, ACCESS, {
      headers: ACTING_PSC,
    });

    expect(response.statusCode, response.body).toBe(409);
    expect(response.json<Problem & { code?: string }>().code).toBe('already-onboarded');
    expect(api.invitations.sent()).toEqual([]);
  });

  it("is 404 for another Commission's record, an unknown one, or acting for another tenant", async () => {
    const other = await api.post(invite('tsc', record('PSC/1')), undefined, ACCESS, {
      headers: { 'x-acting-tenant': 'tsc' },
    });
    const unknown = await api.post(invite('psc', randomUUID()), undefined, ACCESS, {
      headers: ACTING_PSC,
    });
    const acting = await api.post(invite('psc', record('PSC/1')), undefined, ACCESS, {
      headers: { 'x-acting-tenant': 'tsc' },
    });

    expect([other.statusCode, unknown.statusCode, acting.statusCode]).toEqual([404, 404, 404]);
  });

  it('needs directory:internal and an Idempotency-Key', async () => {
    const noScope = await api.post(
      invite('psc', record('PSC/1')),
      undefined,
      { ...ACCESS, scope: 'profile' },
      { headers: ACTING_PSC },
    );
    const noKey = await api.post(invite('psc', record('PSC/1')), undefined, ACCESS, {
      headers: ACTING_PSC,
      idempotencyKey: null,
    });

    expect(noScope.statusCode).toBe(403);
    expect(noKey.statusCode).toBe(400);
    expect(api.invitations.sent()).toEqual([]);
  });
});
