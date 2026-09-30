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

  it('reads the authentication context and time (spec 06 step-up)', async () => {
    const principal = await verifier.verify(
      await sign({ acr: 'step-up', auth_time: 1_790_000_000 }),
    );

    expect(principal).toMatchObject({ acr: 'step-up', authTime: 1_790_000_000 });
  });

  it('reports absent or malformed acr and auth_time as null', async () => {
    const missing = await verifier.verify(await sign({}));
    const malformed = await verifier.verify(await sign({ acr: 2, auth_time: '1790000000' }));

    expect(missing).toMatchObject({ acr: null, authTime: null });
    expect(malformed).toMatchObject({ acr: null, authTime: null });
  });
});
