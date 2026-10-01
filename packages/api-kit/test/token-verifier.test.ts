import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';

import { TokenVerifier } from '../src/index.js';

const ISSUER = 'http://keycloak.test/realms/adili';
const AUDIENCE = 'adili-api';

describe('TokenVerifier', () => {
  let verifier: TokenVerifier;
  let sign: (claims: Record<string, unknown>) => Promise<string>;

  beforeAll(async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'test', alg: 'RS256' };
    verifier = new TokenVerifier(ISSUER, AUDIENCE, createLocalJWKSet({ keys: [jwk] }));
    sign = (claims) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: 'RS256', kid: 'test' })
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setSubject('declarant-1')
        .setExpirationTime('5m')
        .sign(privateKey);
  });

  it('reads the person the account is linked to', async () => {
    const personId = '7d3f9b2a-4c1e-4a8b-9f60-2e5d8c1b0a47';

    const principal = await verifier.verify(await sign({ person_id: personId }));

    expect(principal.personId).toBe(personId);
  });

  it('links no person for a missing or malformed person_id claim', async () => {
    const missing = await verifier.verify(await sign({}));
    const malformed = await verifier.verify(await sign({ person_id: 'OFR-0000417-4' }));

    expect(missing.personId).toBeNull();
    expect(malformed.personId).toBeNull();
  });
});
