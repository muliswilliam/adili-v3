import { PLATFORM_TENANT } from '@adili/api-kit';
import { withTenant } from '@adili/data-access';
import { asc, eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { outbox, persons } from '../../src/db/schema.js';
import { IdentityUnavailable } from '../../src/identity/identity-provisioning.js';
import type { ApplicantProfile, InternalApplicant } from '../../src/persons/representation.js';
import { contractErrors, okResponse } from '../support/contract.js';
import { type Caller, type DirectoryApi, startDirectoryApi } from '../support/directory-api.js';
import { givenCommissions } from '../support/fixtures.js';
import { givenApplicant, givenOnboardedPerson, givenRoster } from '../support/onboarding.js';

/**
 * Spec 10 over HTTP: what the directory holds of applicants for the rest of the flow. The
 * applicant's own profile (Form K Part I), the access service's read of an applicant and its
 * record of an access officer's verification of a passport applicant (S2: Form K is held until
 * then), and notifications reaching an applicant by person id at any Commission.
 */

const NOW = new Date('2026-10-01T09:00:00Z');
const LATER = new Date('2026-10-03T11:30:00Z');

/** The access service's client credentials token. */
const ACCESS: Caller = {
  sub: 'service-account-access',
  azp: 'access',
  scope: 'profile directory:applicants',
};
const NOTIFICATIONS: Caller = {
  sub: 'service-account-notifications',
  azp: 'notifications',
  scope: 'profile directory:person-contacts',
};
const ACTING_PSC = { 'x-acting-tenant': 'psc' };

const applicantPath = (personId: string) => `/internal/v1/applicants/${personId}`;
const verificationPath = (personId: string) =>
  `/internal/v1/applicants/${personId}/identity-verification`;

let api: DirectoryApi;

async function events(type: string) {
  const rows = await api.db
    .select({ envelope: outbox.envelope })
    .from(outbox)
    .where(eq(outbox.eventType, type))
    .orderBy(asc(outbox.id));
  return rows.map(({ envelope }) => envelope);
}

async function storedPerson(personId: string) {
  const [person] = await withTenant(api.db, { tenant: PLATFORM_TENANT, subject: 'test' }, (tx) =>
    tx.select().from(persons).where(eq(persons.id, personId)),
  );
  return person;
}

function verify(personId: string, caller: Caller = ACCESS, verifiedBy = 'officer-psc-1') {
  return api.post(verificationPath(personId), { verifiedBy }, caller, { headers: ACTING_PSC });
}

beforeAll(async () => {
  api = await startDirectoryApi();
  return () => api.close();
});

beforeEach(async () => {
  await api.reset();
  api.clock.set(NOW);
});

describe('GET /v1/me/applicant', () => {
  it("returns the token subject's particulars and identity status", async () => {
    const amina = await givenApplicant(api);

    const response = await api.get('/v1/me/applicant', {
      sub: amina.keycloakUserId,
      roles: ['applicant'],
      azp: 'portal',
    });

    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<ApplicantProfile>();
    expect(contractErrors(okResponse('/v1/me/applicant', 'get'), body)).toEqual([]);
    expect(body).toEqual({
      personId: amina.personId,
      fullName: 'Amina Nakato Okello',
      identityDocument: { kind: 'passport', number: 'B1234567', country: 'UG' },
      identityStatus: 'pending-verification',
      contacts: { email: 'amina.okello@example.com', phone: '+256772123456' },
    });
  });

  it('answers 403 to another role and 404 to an applicant with no person', async () => {
    const amina = await givenApplicant(api);

    const declarant = await api.get('/v1/me/applicant', {
      sub: amina.keycloakUserId,
      tenant: 'tsc',
      roles: ['declarant'],
    });
    const nobody = await api.get('/v1/me/applicant', { roles: ['applicant'] });

    expect(declarant.statusCode).toBe(403);
    expect(nobody.statusCode).toBe(404);
  });
});

describe('GET /internal/v1/applicants/{personId}', () => {
  it('returns the applicant to the access service, audited', async () => {
    const njoki = await givenApplicant(api, {
      kind: 'national-id',
      number: '23456789',
      fullName: 'Njoki Wambua',
      email: 'njoki@example.com',
      phone: '+254722123456',
    });

    const response = await api.get(applicantPath(njoki.personId), ACCESS, ACTING_PSC);

    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<InternalApplicant>();
    expect(contractErrors(okResponse('/internal/v1/applicants/{personId}', 'get'), body)).toEqual(
      [],
    );
    expect(body).toEqual({
      personId: njoki.personId,
      fullName: 'Njoki Wambua',
      identityDocument: { kind: 'national-id', number: '23456789', country: null },
      identityStatus: 'verified',
      contacts: { email: 'njoki@example.com', phone: '+254722123456' },
      identityVerifiedAt: NOW.toISOString(),
      identityVerifiedBy: null,
    });
    expect(await events('audit.read.v1')).toEqual([
      expect.objectContaining({
        tenant: 'psc',
        data: expect.objectContaining({
          action: 'applicant.read',
          resource: expect.objectContaining({ subjectPersonId: njoki.personId }) as unknown,
          actor: expect.objectContaining({ subject: 'service-account-access' }) as unknown,
        }) as unknown,
      }),
    ]);
  });

  it('answers 404 for an unknown id and for a declarant, 403 without the scope, 400 without a tenant', async () => {
    await givenCommissions(api.db, [{ slug: 'tsc', name: 'Teachers Service Commission' }]);
    const records = await givenRoster(api, 'tsc', [
      { personnelFileNumber: 'TSC/1', fullName: 'Wanjiru Kamau', nationalId: '34567890' },
    ]);
    const declarant = await givenOnboardedPerson(api, { recordIds: [records.get('TSC/1') ?? ''] });
    const amina = await givenApplicant(api);

    const unknown = await api.get(
      applicantPath('00000000-0000-4000-8000-000000000000'),
      ACCESS,
      ACTING_PSC,
    );
    const ofDeclarant = await api.get(applicantPath(declarant.personId), ACCESS, ACTING_PSC);
    const withoutScope = await api.get(
      applicantPath(amina.personId),
      { ...ACCESS, scope: 'profile directory:internal' },
      ACTING_PSC,
    );
    const userToken = await api.get(
      applicantPath(amina.personId),
      { tenant: 'psc', roles: ['access-officer'] },
      ACTING_PSC,
    );
    const withoutTenant = await api.get(applicantPath(amina.personId), ACCESS);

    expect(unknown.statusCode).toBe(404);
    expect(ofDeclarant.statusCode).toBe(404);
    expect(withoutScope.statusCode).toBe(403);
    expect(userToken.statusCode).toBe(403);
    expect(withoutTenant.statusCode).toBe(400);
  });
});

describe('POST /internal/v1/applicants/{personId}/identity-verification (S2)', () => {
  it("verifies a passport applicant on the person and the account, recording who and the officer's Commission", async () => {
    const amina = await givenApplicant(api);
    api.identity.seedUser({
      userId: amina.keycloakUserId,
      email: 'amina.okello@example.com',
      tenant: null,
      personId: amina.personId,
      identityStatus: 'pending-verification',
      roles: ['applicant'],
    });
    api.clock.set(LATER);

    const response = await verify(amina.personId);

    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<InternalApplicant>();
    expect(
      contractErrors(
        okResponse('/internal/v1/applicants/{personId}/identity-verification', 'post'),
        body,
      ),
    ).toEqual([]);
    expect(body).toMatchObject({
      personId: amina.personId,
      identityStatus: 'verified',
      identityVerifiedAt: LATER.toISOString(),
      identityVerifiedBy: 'officer-psc-1',
    });
    expect(api.identity.user(amina.keycloakUserId)?.identityStatus).toBe('verified');
    expect(await storedPerson(amina.personId)).toMatchObject({
      identityStatus: 'verified',
      identityVerifiedAt: LATER,
      identityVerifiedBy: 'officer-psc-1',
    });
    expect(await events('applicant.identity-verified.v1')).toEqual([
      expect.objectContaining({
        subject: amina.personId,
        tenant: 'psc',
        data: { personId: amina.personId, verifiedBy: 'officer-psc-1' },
      }),
    ]);
  });

  it('returns an applicant already verified unchanged, with no second event and no account change', async () => {
    const njoki = await givenApplicant(api, { kind: 'national-id', number: '23456789' });

    const response = await verify(njoki.personId);

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      identityStatus: 'verified',
      identityVerifiedAt: NOW.toISOString(),
      identityVerifiedBy: null,
    });
    expect(api.identity.calls('setIdentityStatus')).toEqual([]);
    expect(await events('applicant.identity-verified.v1')).toEqual([]);
  });

  it('answers 502 identity-unavailable, changing nothing, when the account cannot be changed', async () => {
    const amina = await givenApplicant(api);
    api.identity.seedUser({
      userId: amina.keycloakUserId,
      email: 'amina.okello@example.com',
      tenant: null,
      identityStatus: 'pending-verification',
      roles: ['applicant'],
    });
    api.identity.failNext('setIdentityStatus', new IdentityUnavailable('down'));

    const response = await verify(amina.personId);

    expect(response.statusCode, response.body).toBe(502);
    expect(response.json()).toMatchObject({ code: 'identity-unavailable' });
    expect(await storedPerson(amina.personId)).toMatchObject({
      identityStatus: 'pending-verification',
    });
    expect(api.identity.user(amina.keycloakUserId)?.identityStatus).toBe('pending-verification');
  });

  it('answers 404 for no applicant, 403 without the scope, 400 without a verifier or key', async () => {
    const amina = await givenApplicant(api);

    const unknown = await verify('00000000-0000-4000-8000-000000000000');
    const withoutScope = await verify(amina.personId, {
      ...ACCESS,
      scope: 'profile directory:internal',
    });
    const withoutVerifier = await api.post(verificationPath(amina.personId), {}, ACCESS, {
      headers: ACTING_PSC,
    });
    const withoutKey = await api.post(
      verificationPath(amina.personId),
      { verifiedBy: 'officer-psc-1' },
      ACCESS,
      { headers: ACTING_PSC, idempotencyKey: null },
    );

    expect(unknown.statusCode).toBe(404);
    expect(withoutScope.statusCode).toBe(403);
    expect(withoutVerifier.statusCode).toBe(400);
    expect(withoutKey.statusCode).toBe(400);
  });
});

describe('GET /internal/v1/persons/{personId}/contacts for an applicant', () => {
  it('gives notifications the contacts of an applicant at any Commission', async () => {
    const amina = await givenApplicant(api);

    const responses = await Promise.all(
      ['psc', 'tsc'].map((tenant) =>
        api.get(`/internal/v1/persons/${amina.personId}/contacts`, NOTIFICATIONS, {
          'x-acting-tenant': tenant,
        }),
      ),
    );

    for (const response of responses) {
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toEqual({
        personId: amina.personId,
        email: 'amina.okello@example.com',
        phone: '+256772123456',
      });
    }
  });
});
