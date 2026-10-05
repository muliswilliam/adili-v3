import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { OpenBaoAnchorSigner } from '../../src/anchoring/openbao-signer.js';
import { requireEnv } from '../support/audit-api.js';

// Against a real OpenBao (`TEST_OPENBAO_URL`) with Transit enabled, as compose and CI have it.
const signer = new OpenBaoAnchorSigner({
  url: requireEnv('TEST_OPENBAO_URL'),
  token: requireEnv('TEST_OPENBAO_TOKEN'),
  key: `audit-anchor-test-${randomUUID().slice(0, 8)}`,
});

describe('OpenBaoAnchorSigner', () => {
  it('signs with an Ed25519 key it creates, and verifies only what it signed', async () => {
    const statement = '{"merkleRoot":"abc","v":1}';
    const { signature, keyVersion } = await signer.sign(statement);
    expect(keyVersion).toBe(1);
    expect(Buffer.from(signature, 'base64')).toHaveLength(64);
    expect(await signer.verify(statement, signature, keyVersion)).toBe(true);
    expect(await signer.verify('{"merkleRoot":"abd","v":1}', signature, keyVersion)).toBe(false);
    expect(await signer.publicKey(keyVersion)).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });
});
