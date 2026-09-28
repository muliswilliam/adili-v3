import 'reflect-metadata';

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createValkey, ValkeyRateLimitStore } from '../src/index.js';

/** The Valkey adapter of `@RateLimit` buckets, against a real Valkey. */
let valkey: ReturnType<typeof createValkey>;
let store: ValkeyRateLimitStore;

beforeAll(() => {
  valkey = createValkey({
    url: process.env.TEST_VALKEY_URL ?? 'redis://localhost:56379',
    keyPrefix: 'cache-test:',
  });
  store = new ValkeyRateLimitStore(valkey);
});

afterAll(async () => {
  await valkey.quit();
});

const bucketKey = () => `rate-limit:test:${randomUUID()}`;

describe('ValkeyRateLimitStore', () => {
  it('allows the limit, then refuses with the time to the next token', async () => {
    const key = bucketKey();
    const policy = { limit: 3, windowSeconds: 60 };

    const decisions = [];
    for (let i = 0; i < 4; i++) decisions.push(await store.consume(key, policy));

    expect(decisions).toEqual([
      { allowed: true, limit: 3, remaining: 2, resetSeconds: 20, retryAfterSeconds: 0 },
      { allowed: true, limit: 3, remaining: 1, resetSeconds: 40, retryAfterSeconds: 0 },
      { allowed: true, limit: 3, remaining: 0, resetSeconds: 60, retryAfterSeconds: 0 },
      { allowed: false, limit: 3, remaining: 0, resetSeconds: 60, retryAfterSeconds: 20 },
    ]);
  });

  it('refills over the window', async () => {
    const key = bucketKey();
    const policy = { limit: 2, windowSeconds: 1 };
    await store.consume(key, policy);
    await store.consume(key, policy);
    expect((await store.consume(key, policy)).allowed).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(await store.consume(key, policy)).toMatchObject({ allowed: true, remaining: 0 });
  });

  it('keeps buckets apart and expires them once they would be full', async () => {
    const key = bucketKey();
    const policy = { limit: 1, windowSeconds: 30 };
    await store.consume(key, policy);

    expect((await store.consume(key, policy)).allowed).toBe(false);
    expect((await store.consume(bucketKey(), policy)).allowed).toBe(true);
    const ttl = await valkey.pttl(key);
    expect(ttl).toBeGreaterThan(29_000);
    expect(ttl).toBeLessThanOrEqual(30_000);
  });

  it('takes exactly the limit from concurrent requests', async () => {
    const key = bucketKey();
    const policy = { limit: 5, windowSeconds: 3600 };

    const decisions = await Promise.all(
      Array.from({ length: 20 }, () => store.consume(key, policy)),
    );

    expect(decisions.filter((decision) => decision.allowed)).toHaveLength(5);
  });
});
