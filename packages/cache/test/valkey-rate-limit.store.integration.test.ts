import 'reflect-metadata';

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createValkey, ValkeyRateLimitStore } from '../src/index.js';

/** The Valkey adapter of `@RateLimit` windows, against a real Valkey. */
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

const windowKey = () => `rate-limit:test:${randomUUID()}`;

describe('ValkeyRateLimitStore', () => {
  it('allows the limit, then refuses with the time until the oldest request leaves', async () => {
    const key = windowKey();
    const policy = { limit: 3, windowSeconds: 60 };

    const decisions = [];
    for (let i = 0; i < 4; i++) decisions.push(await store.consume(key, policy));

    expect(decisions).toEqual([
      { allowed: true, limit: 3, remaining: 2, resetSeconds: 60, retryAfterSeconds: 0 },
      { allowed: true, limit: 3, remaining: 1, resetSeconds: 60, retryAfterSeconds: 0 },
      { allowed: true, limit: 3, remaining: 0, resetSeconds: 60, retryAfterSeconds: 0 },
      { allowed: false, limit: 3, remaining: 0, resetSeconds: 60, retryAfterSeconds: 60 },
    ]);
  });

  it('lets requests back in once they leave the window, on the server clock', async () => {
    const key = windowKey();
    const policy = { limit: 2, windowSeconds: 1 };
    await store.consume(key, policy);
    await store.consume(key, policy);
    expect((await store.consume(key, policy)).allowed).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 1_100));

    expect(await store.consume(key, policy)).toMatchObject({ allowed: true, remaining: 1 });
  });

  it('keeps windows apart and expires them once their newest request leaves', async () => {
    const key = windowKey();
    const policy = { limit: 1, windowSeconds: 30 };
    await store.consume(key, policy);

    expect((await store.consume(key, policy)).allowed).toBe(false);
    expect((await store.consume(windowKey(), policy)).allowed).toBe(true);
    const ttl = await valkey.pttl(key);
    expect(ttl).toBeGreaterThan(29_000);
    expect(ttl).toBeLessThanOrEqual(30_000);
  });

  it('computes windows on the time the caller passes, so tests can slide them', async () => {
    const key = windowKey();
    const policy = { limit: 2, windowSeconds: 60 };
    const start = Date.parse('2026-09-28T09:00:00Z');
    await store.consume(key, policy, { nowMs: start });
    await store.consume(key, policy, { nowMs: start + 20_000 });

    expect(await store.consume(key, policy, { nowMs: start + 59_999 })).toMatchObject({
      allowed: false,
      retryAfterSeconds: 1,
    });
    expect(await store.consume(key, policy, { nowMs: start + 60_000 })).toEqual({
      allowed: true,
      limit: 2,
      remaining: 0,
      resetSeconds: 60,
      retryAfterSeconds: 0,
    });
    // The next waits for the request made at 20 s.
    expect(await store.consume(key, policy, { nowMs: start + 60_000 })).toMatchObject({
      allowed: false,
      retryAfterSeconds: 20,
    });
    expect(await store.consume(key, policy, { nowMs: start + 120_000 })).toEqual({
      allowed: true,
      limit: 2,
      remaining: 1,
      resetSeconds: 60,
      retryAfterSeconds: 0,
    });
  });

  it('gives the latest request back, never beyond an empty window', async () => {
    const key = windowKey();
    const policy = { limit: 2, windowSeconds: 3600 };
    await store.consume(key, policy);
    await store.consume(key, policy);

    expect(await store.consume(key, policy, { cost: -1 })).toMatchObject({
      allowed: true,
      remaining: 1,
    });
    expect(await store.consume(key, policy)).toMatchObject({ allowed: true, remaining: 0 });
    expect((await store.consume(key, policy)).allowed).toBe(false);

    const full = windowKey();
    expect(await store.consume(full, policy, { cost: -1 })).toMatchObject({
      remaining: 2,
      resetSeconds: 0,
    });
  });

  it('replaces a token bucket left by an earlier version', async () => {
    const key = windowKey();
    await valkey.hset(key, 'tokens', '0', 'updated_at', String(Date.now()));

    expect(await store.consume(key, { limit: 2, windowSeconds: 60 })).toMatchObject({
      allowed: true,
      remaining: 1,
    });
    expect(await valkey.type(key)).toBe('zset');
  });

  it('allows exactly the limit from concurrent requests', async () => {
    const key = windowKey();
    const policy = { limit: 5, windowSeconds: 3600 };

    const decisions = await Promise.all(
      Array.from({ length: 20 }, () => store.consume(key, policy)),
    );

    expect(decisions.filter((decision) => decision.allowed)).toHaveLength(5);
  });
});
