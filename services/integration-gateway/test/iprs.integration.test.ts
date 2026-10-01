import type { LoggerService } from '@nestjs/common';
import { asc, sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { verificationResults } from '../src/db/schema.js';

import { StubIprs, type StubPerson } from './support/stub-iprs.js';
import { createTestApp, type TestApp } from './support/test-app.js';

const WANJIKU: StubPerson = {
  id_number: '23456789',
  first_name: 'Wanjiku',
  middle_name: 'Njeri',
  last_name: 'Kamau',
  date_of_birth: '1984-03-12',
  sex: 'F',
  place_of_birth: 'Nyeri',
  date_of_issue: '2002-06-01',
};

/** S21 and the IPRS lookup rules, over HTTP against Postgres, Valkey and a stub IPRS. */
describe('POST /internal/v1/iprs/person-lookups', () => {
  let iprs: StubIprs;
  let t: TestApp;
  let auth: { authorization: string };

  const logs: string[] = [];
  const collect = (...args: unknown[]) => void logs.push(JSON.stringify(args));
  const logger: LoggerService = {
    log: collect,
    error: collect,
    warn: collect,
    debug: collect,
    verbose: collect,
    fatal: collect,
  };

  beforeAll(async () => {
    iprs = await StubIprs.start();
    t = await createTestApp({ baseUrl: iprs.baseUrl, timeoutMs: 300 });
    t.app.useLogger(logger);
    auth = { authorization: `Bearer ${await t.token()}` };
    // The first fetch in a process pays undici's lazy start-up, which on a busy CI runner can
    // outlast the 300ms IPRS timeout. Pay it here, without a timeout, so no test's first
    // lookup times out and its late request lands in the next test's call count.
    await (await fetch(`${iprs.baseUrl}/v1/persons/warm-up`)).body?.cancel();
    return async () => {
      await t.close();
      await iprs.close();
    };
  });

  beforeEach(async () => {
    iprs.reset();
    iprs.people.set(WANJIKU.id_number, WANJIKU);
    await t.clearCache();
    await t.db.delete(verificationResults);
    logs.length = 0;
  });

  const results = () =>
    t.db
      .select()
      .from(verificationResults)
      .orderBy(asc(verificationResults.checkedAt), asc(verificationResults.id));

  const lookup = (nationalId: string, headers: Record<string, string> = auth) =>
    t.app.inject({
      method: 'POST',
      url: '/internal/v1/iprs/person-lookups',
      headers,
      payload: { nationalId },
    });

  it('reaches IPRS on the first lookup and answers the second from the cache', async () => {
    const first = await lookup('23456789');

    expect(first.statusCode).toBe(200);
    expect(first.headers['x-cache']).toBe('miss');
    expect(first.json()).toEqual({
      nationalId: '23456789',
      firstName: 'Wanjiku',
      middleName: 'Njeri',
      lastName: 'Kamau',
      dateOfBirth: '1984-03-12',
      sex: 'F',
    });
    expect(iprs.calls).toBe(1);

    const second = await lookup('23456789');

    expect(second.statusCode).toBe(200);
    expect(second.headers['x-cache']).toBe('hit');
    expect(second.json()).toEqual(first.json());
    expect(iprs.calls).toBe(1);
  });

  it('caches a person IPRS does not know the same way', async () => {
    const first = await lookup('99999999');

    expect(first.statusCode).toBe(404);
    expect(first.headers['x-cache']).toBe('miss');
    expect(first.headers['content-type']).toContain('application/problem+json');
    expect(first.json()).toMatchObject({ type: 'not-found', status: 404 });

    const second = await lookup('99999999');

    expect(second.statusCode).toBe(404);
    expect(second.headers['x-cache']).toBe('hit');
    expect(iprs.calls).toBe(1);
  });

  it('keeps answers for 24 hours under a key without the national ID', async () => {
    await lookup('23456789');

    const keys = await t.cacheKeys();
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^iprs:person:[0-9a-f]{64}$/);
    const ttl = await t.valkey.ttl(keys[0] ?? '');
    expect(ttl).toBeGreaterThan(86_400 - 5);
    expect(ttl).toBeLessThanOrEqual(86_400);
  });

  it('rejects a malformed national ID without calling IPRS', async () => {
    const response = await lookup('12ab');

    expect(response.statusCode).toBe(400);
    expect(iprs.calls).toBe(0);
  });

  it('requires the iprs scope', async () => {
    const token = await t.token({ scope: 'profile messages' });

    const response = await lookup('23456789', { authorization: `Bearer ${token}` });

    expect(response.statusCode).toBe(403);
    expect(iprs.calls).toBe(0);
  });

  it('requires a token', async () => {
    const response = await lookup('23456789', {});

    expect(response.statusCode).toBe(401);
  });

  describe('when IPRS fails', () => {
    beforeEach(async () => {
      // Each case starts with a closed circuit: past any cool-down, one success closes it.
      t.clock.advance(30_000);
      expect((await lookup('23456789')).statusCode).toBe(200);
      await t.clearCache();
      iprs.calls = 0;
    });

    // A person nobody has looked up, so every call reaches IPRS.
    const failFiveTimes = async () => {
      iprs.behaviour = { kind: 'status', status: 503 };
      for (let i = 0; i < 5; i += 1) {
        const response = await lookup(`1000000${i}`);
        expect(response.statusCode).toBe(503);
        expect(response.json()).toMatchObject({ type: 'upstream-unavailable', status: 503 });
      }
      expect(iprs.calls).toBe(5);
    };

    it('opens the circuit after five consecutive failures and stops calling IPRS', async () => {
      await failFiveTimes();

      const response = await lookup('23456789');

      expect(response.statusCode).toBe(503);
      expect(response.headers['content-type']).toContain('application/problem+json');
      expect(response.json()).toMatchObject({ type: 'upstream-unavailable' });
      expect(iprs.calls).toBe(5);
    });

    it('still answers from the cache while the circuit is open', async () => {
      await lookup('23456789');
      iprs.calls = 0;
      await failFiveTimes();

      const response = await lookup('23456789');

      expect(response.statusCode).toBe(200);
      expect(response.headers['x-cache']).toBe('hit');
    });

    it('recovers through a half-open probe after the cool-down', async () => {
      await failFiveTimes();
      iprs.behaviour = { kind: 'registry' };
      t.clock.advance(29_999);
      expect((await lookup('23456789')).statusCode).toBe(503);
      expect(iprs.calls).toBe(5);

      t.clock.advance(1);
      const probe = await lookup('23456789');

      expect(probe.statusCode).toBe(200);
      expect(iprs.calls).toBe(6);
      await t.clearCache();
      expect((await lookup('23456789')).statusCode).toBe(200);
      expect(iprs.calls).toBe(7);
    });

    it('answers 503 when IPRS does not answer in time', async () => {
      iprs.behaviour = { kind: 'hang' };
      const started = performance.now();

      const response = await lookup('23456789');

      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({ type: 'upstream-unavailable' });
      // The test app times out at 300 ms.
      expect(performance.now() - started).toBeLessThan(1_500);
    });

    it('treats a person without the required fields as a failure', async () => {
      iprs.behaviour = { kind: 'malformed' };

      const response = await lookup('23456789');

      expect(response.statusCode).toBe(503);
    });
  });

  describe('verification results', () => {
    it('records every lookup with system, subject hash, outcome, latency and cached flag', async () => {
      await lookup('23456789');
      await lookup('23456789');
      await lookup('99999999');

      const rows = await results();

      expect(rows.map(({ outcome, cached, reason }) => ({ outcome, cached, reason }))).toEqual([
        { outcome: 'found', cached: false, reason: null },
        { outcome: 'found', cached: true, reason: null },
        { outcome: 'not-found', cached: false, reason: null },
      ]);
      for (const row of rows) {
        expect(row.system).toBe('iprs');
        expect(row.caller).toBe('directory');
        expect(row.subjectHash).toMatch(/^[0-9a-f]{64}$/);
        expect(row.latencyMs).toBeGreaterThanOrEqual(0);
      }
      expect(rows[0]?.subjectHash).toBe(rows[1]?.subjectHash);
      expect(rows[2]?.subjectHash).not.toBe(rows[0]?.subjectHash);
    });

    it('records why a lookup was unavailable', async () => {
      iprs.behaviour = { kind: 'hang' };
      await lookup('23456789');

      const [row] = await results();

      expect(row).toMatchObject({ outcome: 'unavailable', reason: 'timeout', cached: false });
      expect(row?.latencyMs).toBeGreaterThanOrEqual(300);
    });

    it('keeps names and national IDs out of the rows and the logs', async () => {
      await lookup('23456789');
      iprs.behaviour = { kind: 'status', status: 500 };
      await lookup('34567890');

      const serialised = await t.db.execute<{ row: string }>(
        sql`select to_jsonb(v)::text as row from ${verificationResults} v`,
      );
      const everything = [...serialised.rows.map(({ row }) => row), ...logs].join('\n');
      expect(logs.length).toBeGreaterThan(0);
      for (const secret of ['23456789', '34567890', 'Wanjiku', 'Kamau', 'Njeri']) {
        expect(everything).not.toContain(secret);
      }
    });

    it('answers the lookup when the result cannot be recorded', async () => {
      await t.db.execute(sql`alter table verification_results rename to verification_results_off`);
      try {
        const response = await lookup('23456789');

        expect(response.statusCode).toBe(200);
      } finally {
        await t.db.execute(
          sql`alter table verification_results_off rename to verification_results`,
        );
      }
    });
  });
});
