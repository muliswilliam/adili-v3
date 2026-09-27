import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  FieldCipherError,
  type OpenBaoOptions,
  OpenBaoReadinessCheck,
  OpenBaoTransitCipher,
} from '../src/index.js';
import { describeFieldCipherContract } from './field-cipher.contract.js';

/**
 * S14: the Transit adapter against a real OpenBao (`pnpm infra:up`; CI runs a dev server).
 * Tenants are unique per run so "first use creates the key" is observable and runs don't collide.
 */
const options: OpenBaoOptions = {
  url: requireEnv('TEST_OPENBAO_URL'),
  token: requireEnv('TEST_OPENBAO_TOKEN'),
};
const run = `${process.pid}-${Date.now().toString(36)}`;
const tenant = `it-a-${run}`;
const otherTenant = `it-b-${run}`;
const createdKeys = new Set<string>();

beforeAll(async () => {
  // Dev servers start without the Transit engine; the compose seed enables it the same way.
  const mounts = (await (await bao('GET', 'sys/mounts')).json()) as {
    data: Record<string, unknown>;
  };
  if (!mounts.data['transit/']) {
    expect((await bao('POST', 'sys/mounts/transit', { type: 'transit' })).ok).toBe(true);
  }
});

afterAll(async () => {
  for (const key of createdKeys) {
    await bao('POST', `transit/keys/${key}/config`, { deletion_allowed: true });
    await bao('DELETE', `transit/keys/${key}`);
  }
});

describeFieldCipherContract('OpenBaoTransitCipher', () => {
  createdKeys.add(`tenant-${tenant}`).add(`tenant-${otherTenant}`);
  return { cipher: new OpenBaoTransitCipher(options), tenant, otherTenant };
});

describe('OpenBaoTransitCipher', () => {
  it('creates tenant-<slug> on first use as a non-derived, non-exportable AES-GCM key', async () => {
    const slug = `it-new-${run}`;
    createdKeys.add(`tenant-${slug}`);
    expect((await bao('GET', `transit/keys/tenant-${slug}`)).status).toBe(404);

    await new OpenBaoTransitCipher(options).encrypt({
      tenant: slug,
      recordId: randomUUID(),
      plaintext: 'x',
    });

    const { data } = (await (await bao('GET', `transit/keys/tenant-${slug}`)).json()) as {
      data: unknown;
    };
    expect(data).toMatchObject({ type: 'aes256-gcm96', derived: false, exportable: false });
  });

  it('records the key version and still decrypts older records after rotation', async () => {
    const slug = `it-rotate-${run}`;
    createdKeys.add(`tenant-${slug}`);
    const cipher = new OpenBaoTransitCipher(options);
    const recordId = randomUUID();

    const before = await cipher.encrypt({ tenant: slug, recordId, plaintext: 'before' });
    expect((await bao('POST', `transit/keys/tenant-${slug}/rotate`)).ok).toBe(true);
    const after = await cipher.encrypt({ tenant: slug, recordId, plaintext: 'after' });

    expect(before.envelope.keyVersion).toBe(1);
    expect(after.envelope.keyVersion).toBe(2);
    expect((await cipher.decrypt({ tenant: slug, recordId, ...before })).toString()).toBe('before');
    expect((await cipher.decrypt({ tenant: slug, recordId, ...after })).toString()).toBe('after');
  });

  it('reports OpenBao being unreachable as unavailable', async () => {
    const cipher = new OpenBaoTransitCipher({ ...options, url: 'http://127.0.0.1:1' });

    const error: unknown = await cipher
      .encrypt({ tenant, recordId: randomUUID(), plaintext: 'x' })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(FieldCipherError);
    expect((error as FieldCipherError).code).toBe('unavailable');
  });

  it('reports an invalid token as unavailable, not as a decryption failure', async () => {
    const cipher = new OpenBaoTransitCipher({ ...options, token: 'not-a-token' });

    await expect(
      cipher.encrypt({ tenant, recordId: randomUUID(), plaintext: 'x' }),
    ).rejects.toMatchObject({ code: 'unavailable' });
  });
});

describe('OpenBaoReadinessCheck', () => {
  it('passes against a running server', async () => {
    await expect(new OpenBaoReadinessCheck(options).check()).resolves.toBeUndefined();
  });

  it('rejects, without throwing synchronously, when OpenBao is down', async () => {
    const check = new OpenBaoReadinessCheck({ ...options, url: 'http://127.0.0.1:1' });

    await expect(check.check()).rejects.toThrow();
  });
});

function bao(method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`${options.url}/v1/${path}`, {
    method,
    headers: { 'X-Vault-Token': options.token, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required; see vitest.integration.config.ts`);
  return value;
}
