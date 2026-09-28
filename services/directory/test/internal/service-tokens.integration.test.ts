import { ServiceTokenClient, TokenVerifier } from '@adili/api-kit';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { type DirectoryApi, startDirectoryApi } from '../support/directory-api.js';
import { givenCommissions } from '../support/fixtures.js';
import { givenOnboardedPerson, givenRoster } from '../support/onboarding.js';

/**
 * Spec 04 end to end with the committed realm (Keycloak at TEST_KEYCLOAK_ISSUER_URL): the
 * declarations and notifications services' client credentials tokens carry `directory:internal`
 * and reach the directory's internal API, declarations acting for a tenant.
 */
const ISSUER = process.env.TEST_KEYCLOAK_ISSUER_URL ?? '';

const tokensOf = (clientId: string) =>
  new ServiceTokenClient({ issuerUrl: ISSUER, clientId, clientSecret: `${clientId}-dev-secret` });
const declarations = tokensOf('declarations');
const notifications = tokensOf('notifications');

let api: DirectoryApi;

beforeAll(async () => {
  api = await startDirectoryApi({ keycloakIssuerUrl: ISSUER });
});

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await api.reset();
  await givenCommissions(api.db, [
    { slug: 'psc', name: 'Public Service Commission' },
    { slug: 'tsc', name: 'Teachers Service Commission' },
  ]);
});

const internalGet = async (url: string, token: string, tenant?: string) =>
  api.app.inject({
    method: 'GET',
    url,
    headers: {
      authorization: `Bearer ${token}`,
      ...(tenant === undefined ? {} : { 'x-acting-tenant': tenant }),
    },
  });

describe('service tokens of the directory internal API', () => {
  it.each([
    ['declarations', declarations],
    ['notifications', notifications],
  ])(
    '%s carries directory:internal and the adili-api audience, and no tenant',
    async (id, tokens) => {
      const principal = await new TokenVerifier(ISSUER, 'adili-api').verify(await tokens.token());

      expect(principal).toMatchObject({ clientId: id, tenant: null, personId: null });
      expect(principal.scopes).toContain('directory:internal');
    },
  );

  it('lets declarations pull the policy acting for its tenant, and nothing of another', async () => {
    const token = await declarations.token();

    expect(
      (await internalGet('/internal/v1/commissions/psc/policy', token, 'psc')).statusCode,
    ).toBe(200);
    expect(
      (await internalGet('/internal/v1/commissions/tsc/policy', token, 'psc')).statusCode,
    ).toBe(404);
  });

  it("lets notifications read a person's contacts", async () => {
    const ids = await givenRoster(api, 'psc', [
      { personnelFileNumber: 'PSC/1', fullName: 'Mary Wambui', nationalId: '45678901' },
    ]);
    const person = await givenOnboardedPerson(api, {
      recordIds: [...ids.values()],
      email: 'mary@example.go.ke',
    });

    const response = await internalGet(
      `/internal/v1/persons/${person.personId}/contacts`,
      await notifications.token(),
    );

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ email: 'mary@example.go.ke', phone: null });
  });
});
