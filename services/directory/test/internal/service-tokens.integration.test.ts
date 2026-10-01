import { ServiceTokenClient, TokenVerifier } from '@adili/api-kit';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { type DirectoryApi, startDirectoryApi } from '../support/directory-api.js';
import { givenCommissions } from '../support/fixtures.js';
import { givenOnboardedPerson, givenRoster } from '../support/onboarding.js';

/**
 * Spec 04 end to end with the committed realm (Keycloak at TEST_KEYCLOAK_ISSUER_URL): the
 * declarations service's client credentials token carries `directory:internal` and pulls acting
 * for a tenant; the notifications service's carries `directory:person-contacts` alone and reads
 * contacts acting for the tenant it sends for.
 */
const ISSUER = process.env.TEST_KEYCLOAK_ISSUER_URL ?? '';

const tokensOf = (clientId: string) =>
  new ServiceTokenClient({ issuerUrl: ISSUER, clientId, clientSecret: `${clientId}-dev-secret` });
const declarations = tokensOf('declarations');
const notifications = tokensOf('notifications');

let api: DirectoryApi;

beforeAll(async () => {
  api = await startDirectoryApi({ keycloakIssuerUrl: ISSUER });
  return () => api.close();
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
    ['declarations', 'directory:internal', 'directory:person-contacts', declarations],
    ['notifications', 'directory:person-contacts', 'directory:internal', notifications],
  ])(
    '%s carries %s and the adili-api audience, not %s, and no tenant',
    async (id, scope, notScope, tokens) => {
      const principal = await new TokenVerifier(ISSUER, 'adili-api').verify(await tokens.token());

      expect(principal).toMatchObject({ clientId: id, tenant: null, personId: null });
      expect(principal.scopes).toContain(scope);
      expect(principal.scopes).not.toContain(notScope);
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

    const url = `/internal/v1/persons/${person.personId}/contacts`;
    const response = await internalGet(url, await notifications.token(), 'psc');

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ email: 'mary@example.go.ke', phone: null });
    expect((await internalGet(url, await declarations.token(), 'psc')).statusCode).toBe(403);
  });
});
