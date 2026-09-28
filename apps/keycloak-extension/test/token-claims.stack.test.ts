import { describe, expect, it } from 'vitest';

import { keycloakAdmin } from './support/admin.js';

/**
 * S21 (spec 04): the realm's `person_id` mapper. Declarant data is keyed by person, so portal
 * tokens carry the account's `person_id` attribute as a claim; staff tokens are unchanged. Asks
 * Keycloak for the access token a client would issue a user (the admin console's "Evaluate"),
 * which runs the client's real protocol mappers without a sign-in. See vitest.stack.config.ts.
 */
const KEYCLOAK = requireEnv('TEST_KEYCLOAK_URL');
const { adminToken, adminFetch } = keycloakAdmin(KEYCLOAK);

// Demo users from infra/compose/keycloak/adili-realm.json.
const DECLARANT_PERSON_ID = '7d3f9b2a-4c1e-4a8b-9f60-2e5d8c1b0a47';

/** Claims of the access token `clientId` issues `username`. */
async function accessTokenClaims(
  clientId: string,
  username: string,
): Promise<Record<string, unknown>> {
  const token = await adminToken();
  const [client] = (await (
    await adminFetch(token, `/clients?clientId=${encodeURIComponent(clientId)}`)
  ).json()) as { id: string }[];
  const [user] = (await (
    await adminFetch(token, `/users?exact=true&username=${encodeURIComponent(username)}`)
  ).json()) as { id: string }[];
  if (!client || !user) throw new Error(`no client ${clientId} or user ${username}`);
  const params = new URLSearchParams({ scope: 'openid', userId: user.id });
  return (await (
    await adminFetch(
      token,
      `/clients/${client.id}/evaluate-scopes/generate-example-access-token?${params.toString()}`,
    )
  ).json()) as Record<string, unknown>;
}

describe('S21: the person_id claim', () => {
  it("puts a declarant's person_id on portal tokens", async () => {
    const claims = await accessTokenClaims('portal', 'declarant');

    expect(claims).toMatchObject({
      azp: 'portal',
      tenant: 'psc',
      person_id: DECLARANT_PERSON_ID,
      realm_access: { roles: expect.arrayContaining(['declarant']) as unknown },
    });
  });

  it('leaves staff tokens without one', async () => {
    const claims = await accessTokenClaims('console', 'reviewer');

    expect(claims).toMatchObject({ azp: 'console', tenant: 'psc' });
    expect(claims).not.toHaveProperty('person_id');
  });
});

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required (see vitest.stack.config.ts)`);
  return value;
}
