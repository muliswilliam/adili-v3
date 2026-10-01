import { createRemoteJWKSet, type JWTPayload, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { z } from 'zod';

import type { Principal } from './principal.js';

interface KeycloakClaims extends JWTPayload {
  azp?: string;
  tenant?: string;
  realm_access?: { roles?: string[] };
  /** Space-separated scope names (RFC 8693 §4.2). */
  scope?: string;
  name?: string;
  preferred_username?: string;
  /** The account's person, from the `person_id` user attribute (declarants once onboarded). */
  person_id?: string;
}

const personIdSchema = z.uuid();

/** Verifies Keycloak access tokens against the realm's published signing keys. */
export class TokenVerifier {
  constructor(
    private readonly issuer: string,
    private readonly audience: string,
    // Keycloak publishes realm keys here; jose caches them and refetches on unknown `kid`.
    private readonly keys: JWTVerifyGetKey = createRemoteJWKSet(
      new URL(`${issuer}/protocol/openid-connect/certs`),
    ),
  ) {}

  async verify(token: string): Promise<Principal> {
    const { payload } = await jwtVerify<KeycloakClaims>(token, this.keys, {
      issuer: this.issuer,
      audience: this.audience,
      algorithms: ['RS256', 'ES256', 'PS256'],
    });
    if (!payload.sub) {
      throw new Error('token has no subject');
    }
    return {
      subject: payload.sub,
      tenant: payload.tenant ?? null,
      roles: payload.realm_access?.roles ?? [],
      scopes: payload.scope?.split(' ').filter(Boolean) ?? [],
      clientId: payload.azp ?? null,
      name: payload.name ?? payload.preferred_username ?? null,
      issuedAt: payload.iat ?? null,
      // Person ids are UUIDs (RLS casts them); anything else links the account to no person.
      personId: personIdSchema.safeParse(payload.person_id).data ?? null,
    };
  }
}
