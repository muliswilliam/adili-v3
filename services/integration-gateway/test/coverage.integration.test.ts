import { randomUUID } from 'node:crypto';

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PauseFlags } from '../src/adapter-kit/pause-flags.js';
import { outbox, verificationResults } from '../src/db/schema.js';

import { SEED, StubRegistries } from './support/stub-registries.js';
import { createTestApp, type TestApp } from './support/test-app.js';

/** A matcher typed `unknown`, so it sits in typed objects. */
const isoDateTime = (): unknown => expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/);

/** S13 (read): coverage per system for platform administrators. */
describe('GET /v1/integrations/coverage', () => {
  let registries: StubRegistries;
  let t: TestApp;
  let admin: { authorization: string };
  let review: Record<string, string>;

  beforeAll(async () => {
    registries = await StubRegistries.start();
    t = await createTestApp({ registryUrls: registries.urls });
    t.app.useLogger(false);
    admin = {
      authorization: `Bearer ${await t.token({ clientId: 'console', roles: ['platform-admin'], tenant: 'platform' })}`,
    };
    review = {
      authorization: `Bearer ${await t.token({ clientId: 'review', scope: 'registry' })}`,
      'x-acting-tenant': 'psc',
      'x-legal-basis': 'regs-r20-1-b',
      'x-case-ref': 'case-0001',
    };
    return async () => {
      await t.close();
      await registries.close();
    };
  });

  beforeEach(async () => {
    registries.reset();
    await t.clearCache();
    await t.db.delete(verificationResults);
    await t.db.delete(outbox);
  });

  const coverage = (headers: Record<string, string> = admin) =>
    t.app.inject({ method: 'GET', url: '/v1/integrations/coverage', headers });

  const lookup = (path: string, nationalId: string) =>
    t.app.inject({
      method: 'POST',
      url: `/internal/v1/${path}`,
      headers: review,
      payload: { nationalId },
    });

  type Row = { system: string } & Record<string, unknown>;
  const of = (rows: Row[], system: string) => rows.find((row) => row.system === system);

  it('lists the six systems with counts, hit rate, breaker, last success and config', async () => {
    const response = await coverage();

    expect(response.statusCode).toBe(200);
    const rows = response.json<Row[]>();
    expect(rows.map((row) => row.system)).toEqual([
      'iprs',
      'kra',
      'ntsa',
      'brs',
      'ardhisasa',
      'hr-suppliers',
    ]);
    expect(of(rows, 'kra')).toEqual({
      system: 'kra',
      calls24h: 0,
      cacheHitRate: 0,
      failures24h: 0,
      breaker: 'closed',
      lastSuccessAt: null,
      paused: false,
      pausedBy: null,
      pausedAt: null,
      rateLimitPerMinute: 60_000,
      cacheTtlSeconds: 86_400,
      timeoutMs: 2_000,
      breakerFailureThreshold: 5,
      breakerCooldownSeconds: 30,
    });
  });

  it('counts the last 24 hours of lookups, cache hits among answers and failures', async () => {
    await lookup('kra/taxpayer-lookups', SEED.wanjiku);
    await lookup('kra/taxpayer-lookups', SEED.wanjiku);
    await lookup('kra/taxpayer-lookups', SEED.imani);
    await lookup('kra/taxpayer-lookups', SEED.imani);
    registries.behaviour.kra = { kind: 'status', status: 503 };
    await lookup('kra/taxpayer-lookups', SEED.kiprono);
    // Older than a day: counted for the last success only.
    await t.db.insert(verificationResults).values({
      id: randomUUID(),
      system: 'ntsa',
      subjectHash: 'a'.repeat(64),
      outcome: 'found',
      cached: false,
      latencyMs: 12,
      caller: 'review',
      tenant: 'psc',
      legalBasis: 'regs-r20-1-b',
      checkedAt: new Date(Date.now() - 25 * 3_600_000),
    });

    const rows = (await coverage()).json<Row[]>();

    expect(of(rows, 'kra')).toMatchObject({
      calls24h: 5,
      cacheHitRate: 0.5,
      failures24h: 1,
      breaker: 'closed',
      lastSuccessAt: isoDateTime(),
    });
    expect(of(rows, 'ntsa')).toMatchObject({
      calls24h: 0,
      cacheHitRate: 0,
      lastSuccessAt: isoDateTime(),
    });
    expect(Date.parse(String(of(rows, 'ntsa')?.lastSuccessAt))).toBeLessThan(
      Date.now() - 24 * 3_600_000,
    );
    expect(of(rows, 'brs')).toMatchObject({ calls24h: 0, lastSuccessAt: null });
  });

  it('shows a breaker open after five failures, half-open past the cool-down', async () => {
    registries.behaviour.ardhisasa = { kind: 'status', status: 503 };
    for (let call = 0; call < 5; call += 1) await lookup('ardhisasa/parcel-lookups', SEED.wanjiku);

    expect(of((await coverage()).json<Row[]>(), 'ardhisasa')).toMatchObject({
      breaker: 'open',
      failures24h: 5,
      lastSuccessAt: null,
    });

    t.clock.advance(30_001);
    expect(of((await coverage()).json<Row[]>(), 'ardhisasa')?.breaker).toBe('half-open');

    registries.behaviour.ardhisasa = { kind: 'registry' };
    await lookup('ardhisasa/parcel-lookups', SEED.kiprono);
    expect(of((await coverage()).json<Row[]>(), 'ardhisasa')?.breaker).toBe('closed');
  });

  it('shows a paused system', async () => {
    const pauses = t.app.get(PauseFlags);
    await pauses.pause('ntsa');
    try {
      const rows = (await coverage()).json<Row[]>();
      expect(of(rows, 'ntsa')?.paused).toBe(true);
      expect(of(rows, 'kra')?.paused).toBe(false);
    } finally {
      await pauses.resume('ntsa');
    }
  });

  it('refuses reviewers and service tokens with 403', async () => {
    const reviewer = await t.token({ clientId: 'console', roles: ['reviewer'], tenant: 'psc' });

    expect((await coverage({ authorization: `Bearer ${reviewer}` })).statusCode).toBe(403);
    expect((await coverage({ authorization: review.authorization ?? '' })).statusCode).toBe(403);
    expect((await coverage({})).statusCode).toBe(401);
  });
});
