import { readFileSync } from 'node:fs';

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { LawEnforcementOfficersService } from '../../src/law-enforcement/officers.service.js';
import { DEMO_APPLICANT, DEMO_LEA_OFFICER, seedDemoPersons } from '../../src/persons/demo-seed.js';
import type { ApplicantProfile, InternalApplicant } from '../../src/persons/representation.js';
import { type Caller, type DirectoryApi, startDirectoryApi } from '../support/directory-api.js';

/**
 * The demo applicant and law enforcement officer `pnpm db:seed` creates, as the access service
 * reads them when the demo accounts of the realm import file a Form K or a law enforcement
 * request, and the accounts that name them.
 */

interface RealmUser {
  id?: string;
  username: string;
  attributes?: Record<string, string[]>;
}

const realm = JSON.parse(
  readFileSync(
    new URL('../../../../infra/compose/keycloak/adili-realm.json', import.meta.url),
    'utf8',
  ),
) as { users: RealmUser[] };
const realmUser = (username: string) => realm.users.find((user) => user.username === username);

const ACCESS: Caller = {
  sub: 'service-account-access',
  azp: 'access',
  scope: 'profile directory:applicants',
};

let api: DirectoryApi;

beforeAll(async () => {
  api = await startDirectoryApi();
  return () => api.close();
});

beforeEach(async () => {
  await api.reset();
});

describe('demo persons seed', () => {
  it('names the persons the demo accounts in the realm import carry', () => {
    expect(realmUser('applicant')).toMatchObject({
      id: DEMO_APPLICANT.keycloakUserId,
      attributes: {
        person_id: [DEMO_APPLICANT.personId],
        phone: [DEMO_APPLICANT.phone],
        identityStatus: ['verified'],
      },
    });
    expect(realmUser('applicant')?.attributes).not.toHaveProperty('tenant');
    expect(realmUser('law-enforcement')).toMatchObject({
      id: DEMO_LEA_OFFICER.keycloakUserId,
      attributes: {
        tenant: ['lea'],
        agency: [DEMO_LEA_OFFICER.agencyCode],
        person_id: [DEMO_LEA_OFFICER.personId],
        phone: [DEMO_LEA_OFFICER.phone],
      },
    });
  });

  it('seeds a verified applicant, idempotently, as access reads it for Form K', async () => {
    await seedDemoPersons(api.db);
    await seedDemoPersons(api.db);

    const internal = await api.get(`/internal/v1/applicants/${DEMO_APPLICANT.personId}`, ACCESS, {
      'x-acting-tenant': 'psc',
    });
    expect(internal.statusCode, internal.body).toBe(200);
    expect(internal.json<InternalApplicant>()).toMatchObject({
      personId: DEMO_APPLICANT.personId,
      fullName: DEMO_APPLICANT.fullName,
      identityStatus: 'verified',
      contacts: { email: DEMO_APPLICANT.email, phone: DEMO_APPLICANT.phone },
    });

    const profile = await api.get('/v1/me/applicant', {
      sub: DEMO_APPLICANT.keycloakUserId,
      roles: ['applicant'],
      azp: 'portal',
    });
    expect(profile.statusCode, profile.body).toBe(200);
    expect(profile.json<ApplicantProfile>()).toMatchObject({ identityStatus: 'verified' });
  });

  it('seeds an activated DCI officer, idempotently, as access checks a request against', async () => {
    await seedDemoPersons(api.db);
    await seedDemoPersons(api.db);

    const officer = await api.app
      .get(LawEnforcementOfficersService)
      .internalOfficer(ACCESS.sub ?? '', DEMO_LEA_OFFICER.personId);
    expect(officer).toMatchObject({
      personId: DEMO_LEA_OFFICER.personId,
      keycloakUserId: DEMO_LEA_OFFICER.keycloakUserId,
      name: DEMO_LEA_OFFICER.fullName,
      agency: { code: 'DCI' },
      state: 'activated',
    });
  });
});
