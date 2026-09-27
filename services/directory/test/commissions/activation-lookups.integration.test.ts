import { randomUUID } from 'node:crypto';

import { Logger } from '@nestjs/common';
import { createValkey } from '@adili/cache';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  NOT_INVITED_TTL_SECONDS,
  ValkeyActivationLookups,
} from '../../src/commissions/activation-lookups.js';

/** The Valkey adapter of the activation observer's cache, against a real Valkey. */
let valkey: ReturnType<typeof createValkey>;
let lookups: ValkeyActivationLookups;

beforeAll(() => {
  // The adapter logs the outages the last case causes on purpose.
  Logger.overrideLogger(['fatal']);
  valkey = createValkey({
    url: requireEnv('TEST_VALKEY_URL'),
    keyPrefix: `directory-test-${randomUUID()}:`,
  });
  lookups = new ValkeyActivationLookups(valkey);
});

afterAll(async () => {
  await valkey.quit();
});

describe('ValkeyActivationLookups', () => {
  it('remembers a subject with no invitation for five minutes under its own key', async () => {
    const subject = randomUUID();
    const unknown = await lookups.lookup(subject);
    expect(unknown).toEqual({ notInvited: false, version: null });

    await lookups.rememberNotInvited(subject, null);

    expect(await lookups.lookup(subject)).toEqual({ notInvited: true });
    expect(await lookups.lookup(randomUUID())).toMatchObject({ notInvited: false });
    const ttl = await valkey.ttl(`activation:not-invited:${subject}`);
    expect(ttl).toBeGreaterThan(NOT_INVITED_TTL_SECONDS - 5);
    expect(ttl).toBeLessThanOrEqual(NOT_INVITED_TTL_SECONDS);
  });

  it('looks a subject up again once it is forgotten', async () => {
    const subject = randomUUID();
    await lookups.rememberNotInvited(subject, null);

    await lookups.forget(subject);

    expect(await lookups.lookup(subject)).toMatchObject({ notInvited: false });
  });

  it('does not let a lookup that began before an invitation hide it', async () => {
    const subject = randomUUID();
    // The observer reads the cache and the database...
    const before = await lookups.lookup(subject);
    // ...an assignment of the subject commits and forgets them...
    await lookups.forget(subject);
    // ...and the observer, having found no invitation, remembers what it saw.
    await lookups.rememberNotInvited(subject, before.notInvited ? null : before.version);

    expect(await lookups.lookup(subject)).toMatchObject({ notInvited: false });
  });

  it('remembers a subject read after its invitation', async () => {
    const subject = randomUUID();
    await lookups.forget(subject);
    const after = await lookups.lookup(subject);

    await lookups.rememberNotInvited(subject, after.notInvited ? null : after.version);

    expect(await lookups.lookup(subject)).toEqual({ notInvited: true });
  });

  it('reads as unknown and never throws while Valkey is unavailable', async () => {
    const down = createValkey({ url: 'redis://127.0.0.1:1', keyPrefix: 'directory-test:' });
    const unavailable = new ValkeyActivationLookups(down);
    const subject = randomUUID();

    const lookup = await unavailable.lookup(subject);
    expect(lookup).toMatchObject({ notInvited: false });
    await expect(
      unavailable.rememberNotInvited(subject, lookup.notInvited ? null : lookup.version),
    ).resolves.toBeUndefined();
    await expect(unavailable.forget(subject)).resolves.toBeUndefined();
    down.disconnect();
  });
});

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required; see vitest.integration.config.ts`);
  return value;
}
