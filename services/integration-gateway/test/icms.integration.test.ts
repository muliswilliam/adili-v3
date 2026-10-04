import { asc, eq, sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PauseFlags } from '../src/adapter-kit/pause-flags.js';
import { burstOf } from '../src/adapter-kit/system-policies.js';
import { config } from '../src/config.js';
import { icmsReferrals, outbox, systemCalls } from '../src/db/schema.js';
import { ICMS_REFERRAL_SUBMITTED, ICMS_REFERRAL_UNACKNOWLEDGED } from '../src/icms/icms-events.js';

import { StubIcms } from './support/stub-icms.js';
import { createTestApp, type TestApp } from './support/test-app.js';

/** A matcher typed `unknown`, so it sits in typed objects. */
const isoDateTime = (): unknown => expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/);
const hash = (): unknown => expect.stringMatching(/^[0-9a-f]{64}$/);
const containing = (text: string): unknown => expect.stringContaining(text);
const aDate = (): unknown => expect.any(Date);

const NATIONAL_ID = '22607781';
const FULL_NAME = 'Kiprono Kibet Chebet';
const DETAILS = 'Did not declare in the 2025 and 2027 biennial cycles after notice and warning.';

/** The Public Service Commission referred `RFL-PSC-2028-0000001-5` to EACC. */
const REFERRAL = {
  referralReference: 'RFL-PSC-2028-0000001-5',
  nationalId: NATIONAL_ID,
  fullName: FULL_NAME,
  referringCommission: 'PSC',
  grounds: 'Non-compliance in two consecutive declaration cycles (Reg 20(2))',
  details: DETAILS,
} as const;

/**
 * ICMS answers within 1.5 s or is timed out; never cached. Not less: two sends at once (S13 same
 * reference) each wait on the stub's 100 ms and a second connection, and on a loaded CI runner
 * one of them outlasted 300 ms (answered 503 in a 553 ms test).
 */
const ICMS_POLICY = {
  timeoutMs: 1_500,
  cacheTtlSeconds: null,
  ratePerMinute: 60_000,
  burst: burstOf(60_000),
  maxQueueMs: 1_000,
};

/** Spec 09 S13: the ICMS adapter on the adapter kit, against a stub of the ICMS mock. */
describe('ICMS referrals', () => {
  let icms: StubIcms;
  let t: TestApp;
  let reporting: Record<string, string>;

  beforeAll(async () => {
    icms = await StubIcms.start();
    t = await createTestApp({ icmsUrl: icms.baseUrl, policies: { icms: ICMS_POLICY } });
    // Unavailable ICMS is logged by design; keep the run quiet.
    t.app.useLogger(false);
    reporting = {
      authorization: `Bearer ${await t.token({ clientId: 'reporting', scope: 'icms' })}`,
      'x-legal-basis': 'regs-r20-referral',
    };
    // The first fetch in a process pays undici's lazy start-up, which on a busy CI runner can
    // outlast the timeout. Pay it here, without a timeout, so the first test's call
    // does not time out.
    await (await fetch(`${icms.baseUrl}/warm-up`)).body?.cancel();
    return async () => {
      await t.close();
      await icms.close();
    };
  });

  beforeEach(async () => {
    icms.reset();
    await t.app.get(PauseFlags).resume('icms');
    await t.db.delete(icmsReferrals);
    await t.db.delete(systemCalls);
    await t.db.delete(outbox);
  });

  const submit = (payload: object = REFERRAL, headers: Record<string, string> = reporting) =>
    t.app.inject({ method: 'POST', url: '/internal/v1/icms/referrals', headers, payload });

  const read = (reference: string, headers: Record<string, string> = reporting) =>
    t.app.inject({ method: 'GET', url: `/internal/v1/icms/referrals/${reference}`, headers });

  const stored = () => t.db.select().from(icmsReferrals);
  const calls = () => t.db.select().from(systemCalls).orderBy(asc(systemCalls.calledAt));
  const events = async (type = ICMS_REFERRAL_SUBMITTED) =>
    (
      await t.db.select().from(outbox).where(eq(outbox.eventType, type)).orderBy(asc(outbox.id))
    ).map(({ envelope }) => envelope);

  describe('S13 submitReferral accepted', () => {
    it('registers the referral in the body and stores the case number (201)', async () => {
      const response = await submit();

      expect(response.statusCode).toBe(201);
      const registered = icms.referrals.get(REFERRAL.referralReference);
      expect(registered?.case_number).toMatch(/^EACC\/ICMS\/\d{4}\/000001$/);
      expect(response.json()).toEqual({
        referralReference: REFERRAL.referralReference,
        caseNumber: registered?.case_number,
        status: 'registered',
        registeredAt: new Date(registered?.registered_at ?? '').toISOString(),
        sentAt: isoDateTime(),
      });
      expect(icms.requests).toEqual([
        {
          method: 'POST',
          path: '/icms/v1/referrals',
          body: {
            referral_reference: REFERRAL.referralReference,
            id_number: NATIONAL_ID,
            full_name: FULL_NAME,
            referring_commission: 'PSC',
            grounds: REFERRAL.grounds,
            details: DETAILS,
          },
        },
      ]);

      expect(await stored()).toEqual([
        {
          referralReference: REFERRAL.referralReference,
          referringCommission: 'PSC',
          nationalIdHash: hash(),
          status: 'registered',
          caseNumber: registered?.case_number,
          registeredAt: aDate(),
          sentAt: aDate(),
          requestedBy: 'reporting',
          legalBasis: 'regs-r20-referral',
          caseRef: null,
        },
      ]);
      expect(await calls()).toEqual([
        expect.objectContaining({ system: 'icms', outcome: 'answered', reason: null }),
      ]);
      expect(await events()).toEqual([
        expect.objectContaining({
          type: ICMS_REFERRAL_SUBMITTED,
          subject: REFERRAL.referralReference,
          tenant: 'platform',
          data: {
            referralReference: REFERRAL.referralReference,
            referringCommission: 'PSC',
            status: 'registered',
            caseNumber: registered?.case_number,
            legalBasis: 'regs-r20-referral',
            caseRef: null,
            requestedBy: 'reporting',
          },
        }),
      ]);
    });

    it('keeps the national ID only as a keyed hash, and no name, grounds or details', async () => {
      await submit();

      const serialised = await t.db.execute<{ row: string }>(
        sql`select row_to_json(r)::text as row from ${icmsReferrals} r
            union all select envelope::text from ${outbox}
            union all select row_to_json(c)::text from ${systemCalls} c`,
      );
      const everything = serialised.rows.map(({ row }) => row).join('\n');
      expect(everything).not.toContain(NATIONAL_ID);
      expect(everything).not.toContain('Kiprono');
      expect(everything).not.toContain(REFERRAL.grounds);
      expect(everything).not.toContain(DETAILS);
    });

    it('records the case reference when the caller names one', async () => {
      const response = await submit(REFERRAL, { ...reporting, 'x-case-ref': 'referral-0001' });

      expect(response.statusCode).toBe(201);
      expect(await stored()).toEqual([expect.objectContaining({ caseRef: 'referral-0001' })]);
    });

    it('takes a referral without details', async () => {
      const response = await submit({ ...REFERRAL, details: '' });

      expect(response.statusCode).toBe(201);
      expect(icms.requests[0]?.body).toMatchObject({ details: '' });
    });
  });

  describe('S13 same reference again', () => {
    it('answers the stored registration (200) without a second call', async () => {
      const first = await submit();
      const second = await submit();

      expect(second.statusCode).toBe(200);
      expect(second.json()).toEqual(first.json());
      expect(icms.calls).toBe(1);
      expect(await stored()).toHaveLength(1);
      expect(await calls()).toHaveLength(1);
      expect(await events()).toHaveLength(1);
    });

    it('answers a replay with a corrected name or narrative from the store', async () => {
      const first = await submit();
      const second = await submit({ ...REFERRAL, fullName: 'Kiprono K. Chebet', details: 'More' });

      expect(second.statusCode).toBe(200);
      expect(second.json()).toEqual(first.json());
      expect(icms.calls).toBe(1);
    });

    it.each([
      ['another declarant', { nationalId: '30111222' }],
      ['another Commission', { referringCommission: 'TSC' }],
    ])(
      'refuses %s under a used reference (409) without calling ICMS',
      async (_, change: object) => {
        await submit();
        const response = await submit({ ...REFERRAL, ...change });

        expect(response.statusCode).toBe(409);
        expect(response.json()).toMatchObject({ type: 'referral-reference-conflict' });
        expect(icms.calls).toBe(1);
      },
    );

    it('answers two sends at once with one registration: one 201, one 200', async () => {
      icms.behaviour = { kind: 'slow', ms: 100 };

      const responses = await Promise.all([submit(), submit()]);

      // The bodies say why, should one of them be refused again (a 503 names its reason).
      expect(
        responses.map((r) => r.statusCode).sort(),
        responses.map((r) => r.body).join('\n'),
      ).toEqual([200, 201]);
      const [one, other] = responses;
      expect(one.json()).toEqual(other.json());
      expect(await stored()).toHaveLength(1);
      expect(await events()).toHaveLength(1);
      // ICMS is idempotent by reference: both sends reached it, one case exists there.
      expect(icms.referrals.size).toBe(1);
    });

    it('stores the case ICMS holds when ICMS registered a referral the gateway never heard back on', async () => {
      icms.behaviour = { kind: 'store-then-fail' };
      expect((await submit()).statusCode).toBe(503);
      expect(await stored()).toEqual([]);

      icms.behaviour = { kind: 'icms' };
      const retry = await submit();

      expect(retry.statusCode).toBe(201);
      expect(retry.json()).toMatchObject({
        caseNumber: icms.referrals.get(REFERRAL.referralReference)?.case_number,
      });
      expect(icms.referrals.size).toBe(1);
    });

    it('refuses a registration of another referral ICMS holds under the reference', async () => {
      await submit();
      await t.db.delete(icmsReferrals);

      const response = await submit({ ...REFERRAL, nationalId: '30111222' });

      expect(response.statusCode).toBe(409);
      expect(await stored()).toEqual([]);
      expect(await events(ICMS_REFERRAL_UNACKNOWLEDGED)).toEqual([
        expect.objectContaining({
          data: expect.objectContaining({ reason: 'reference-conflict' }) as unknown,
        }),
      ]);
    });
  });

  describe('S13 ICMS down', () => {
    it('answers 503 and records nothing as registered', async () => {
      icms.behaviour = { kind: 'status', status: 503 };

      const response = await submit();

      expect(response.statusCode).toBe(503);
      expect(response.headers['content-type']).toContain('application/problem+json');
      expect(response.json()).toMatchObject({
        type: 'upstream-unavailable',
        detail: containing('Nothing was recorded as registered'),
      });
      expect(await stored()).toEqual([]);
      expect(await events()).toEqual([]);
      expect(await calls()).toEqual([
        expect.objectContaining({
          system: 'icms',
          outcome: 'unavailable',
          reason: 'upstream-error',
        }),
      ]);
      // The attempt is audited (ADR-008), as not acknowledged.
      expect(await events(ICMS_REFERRAL_UNACKNOWLEDGED)).toEqual([
        expect.objectContaining({
          subject: REFERRAL.referralReference,
          tenant: 'platform',
          data: {
            referralReference: REFERRAL.referralReference,
            referringCommission: 'PSC',
            reason: 'upstream-error',
            legalBasis: 'regs-r20-referral',
            caseRef: null,
            requestedBy: 'reporting',
          },
        }),
      ]);
      expect((await read(REFERRAL.referralReference)).statusCode).toBe(404);
    });

    it('registers the referral when retried once ICMS is back', async () => {
      icms.behaviour = { kind: 'status', status: 503 };
      await submit();
      icms.behaviour = { kind: 'icms' };

      const retry = await submit();

      expect(retry.statusCode).toBe(201);
      expect(await stored()).toHaveLength(1);
    });

    it('answers 503 for an answer outside ICMS contract (no case number), nothing registered', async () => {
      icms.behaviour = { kind: 'status', status: 201 };

      const response = await submit();

      expect(response.statusCode).toBe(503);
      expect(await stored()).toEqual([]);
      expect(await calls()).toEqual([
        expect.objectContaining({ outcome: 'unavailable', reason: 'upstream-error' }),
      ]);
    });

    it('times ICMS out (503, reason timeout)', async () => {
      icms.behaviour = { kind: 'hang' };

      const started = performance.now();
      const response = await submit();

      expect(response.statusCode).toBe(503);
      expect(performance.now() - started).toBeLessThan(ICMS_POLICY.timeoutMs + 2_000);
      expect(await stored()).toEqual([]);
      expect(await calls()).toEqual([
        expect.objectContaining({ outcome: 'unavailable', reason: 'timeout' }),
      ]);
    });

    it('a paused ICMS is not called (503, reason paused)', async () => {
      await t.app.get(PauseFlags).pause('icms');

      const response = await submit();

      expect(response.statusCode).toBe(503);
      expect(icms.calls).toBe(0);
      expect(await calls()).toEqual([
        expect.objectContaining({ outcome: 'unavailable', reason: 'paused' }),
      ]);
    });

    it('a paused ICMS still answers a stored registration (200) without calling ICMS', async () => {
      const first = await submit();
      await t.app.get(PauseFlags).pause('icms');

      const replay = await submit();

      expect(replay.statusCode).toBe(200);
      expect(replay.json()).toEqual(first.json());
      expect(icms.calls).toBe(1);
      expect(await calls()).toHaveLength(1);
      expect(await events(ICMS_REFERRAL_UNACKNOWLEDGED)).toEqual([]);
    });
  });

  describe('S13 legal basis and caller', () => {
    it.each([
      ['missing', {}],
      ['a lookup basis', { 'x-legal-basis': 'regs-r20-1-b' }],
      ['a payroll basis', { 'x-legal-basis': 'am-sanctions' }],
      ['unknown', { 'x-legal-basis': 'curiosity' }],
    ])('refuses a legal basis %s (400) without calling ICMS', async (_, basis) => {
      const headers = { ...reporting };
      delete headers['x-legal-basis'];

      const response = await submit(REFERRAL, { ...headers, ...basis });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        errors: [{ path: 'X-Legal-Basis', message: containing('regs-r20-referral') }],
      });
      expect(icms.calls).toBe(0);
    });

    it.each([
      ['no national ID', { nationalId: undefined }],
      ['a malformed national ID', { nationalId: '22-607781' }],
      ['an empty name', { fullName: ' ' }],
      ['a name ICMS cannot hold', { fullName: 'K'.repeat(201) }],
      ['a reference ICMS cannot hold', { referralReference: `RFL-${'9'.repeat(40)}` }],
      ['a Commission code ICMS cannot hold', { referringCommission: 'C'.repeat(21) }],
      ['grounds ICMS cannot hold', { grounds: 'G'.repeat(201) }],
      ['details over 8,000 characters', { details: 'D'.repeat(8_001) }],
      ['an unknown field', { notes: 'x' }],
    ])('refuses %s (400) without calling ICMS', async (_, change) => {
      const response = await submit({ ...REFERRAL, ...change });

      expect(response.statusCode).toBe(400);
      expect(icms.calls).toBe(0);
    });

    it('needs a service token with the icms scope (403)', async () => {
      const payroll = `Bearer ${await t.token({ clientId: 'review', scope: 'payroll' })}`;

      const response = await submit(REFERRAL, { ...reporting, authorization: payroll });

      expect(response.statusCode).toBe(403);
      expect(icms.calls).toBe(0);
    });
  });

  describe('getReferral', () => {
    it('returns the stored registration without calling ICMS', async () => {
      const registered: unknown = (await submit()).json();
      icms.reset();

      const response = await read(REFERRAL.referralReference);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(registered);
      expect(icms.calls).toBe(0);
    });

    it('needs no legal basis: it reads the store, not ICMS', async () => {
      await submit();

      const response = await read(REFERRAL.referralReference, {
        authorization: reporting.authorization ?? '',
      });

      expect(response.statusCode).toBe(200);
    });

    it('is 404 for a reference never registered', async () => {
      expect((await read('RFL-PSC-2028-0000099-1')).statusCode).toBe(404);
    });

    it('needs the icms scope (403)', async () => {
      await submit();
      const payroll = `Bearer ${await t.token({ clientId: 'review', scope: 'payroll' })}`;

      const response = await read(REFERRAL.referralReference, { authorization: payroll });

      expect(response.statusCode).toBe(403);
    });
  });

  // Last: it opens ICMS's breaker, which only the clock moving past the cool-down closes.
  describe('icms in coverage with its own breaker', () => {
    const admin = async () => ({
      authorization: `Bearer ${await t.token({ clientId: 'console', roles: ['platform-admin'], tenant: 'platform' })}`,
    });
    const coverage = async () => {
      const response = await t.app.inject({
        method: 'GET',
        url: '/v1/integrations/coverage',
        headers: await admin(),
      });
      return response.json<{ system: string }[]>();
    };
    const of = async (system: string) => (await coverage()).find((row) => row.system === system);

    it('lists icms with its calls, failures, last success and no cache', async () => {
      await submit();
      await submit(); // a replay: no call
      icms.behaviour = { kind: 'status', status: 500 };
      await submit({ ...REFERRAL, referralReference: 'RFL-PSC-2028-0000002-3' });

      expect(await of('icms')).toEqual({
        system: 'icms',
        calls24h: 2,
        cacheHitRate: 0,
        failures24h: 1,
        breaker: 'closed',
        lastSuccessAt: isoDateTime(),
        paused: false,
        pausedBy: null,
        pausedAt: null,
        rateLimitPerMinute: 60_000,
        cacheTtlSeconds: null,
        timeoutMs: ICMS_POLICY.timeoutMs,
        breakerFailureThreshold: config.BREAKER_FAILURE_THRESHOLD,
        breakerCooldownSeconds: config.BREAKER_COOLDOWN_MS / 1000,
      });
    });

    it("opens ICMS's breaker alone after consecutive failures, then fails fast", async () => {
      // A registration first, so earlier tests' failures do not count towards this run.
      await submit();
      const failing = { ...REFERRAL, referralReference: 'RFL-PSC-2028-0000010-7' };
      icms.behaviour = { kind: 'status', status: 503 };
      for (let call = 0; call < config.BREAKER_FAILURE_THRESHOLD; call += 1) await submit(failing);
      expect(icms.calls).toBe(1 + config.BREAKER_FAILURE_THRESHOLD);

      const fast = await submit(failing);

      expect(fast.statusCode).toBe(503);
      expect(fast.json()).toMatchObject({ detail: containing('breaker-open') });
      expect(icms.calls).toBe(1 + config.BREAKER_FAILURE_THRESHOLD);
      const rows = await coverage();
      expect(rows.find((row) => row.system === 'icms')).toMatchObject({ breaker: 'open' });
      expect(rows.filter((row) => row.system !== 'icms')).toEqual(
        rows
          .filter((row) => row.system !== 'icms')
          .map((): unknown => expect.objectContaining({ breaker: 'closed' })),
      );

      // Past the cool-down a probe goes through, and a registration closes the circuit.
      icms.behaviour = { kind: 'icms' };
      t.clock.advance(config.BREAKER_COOLDOWN_MS + 1);
      expect((await submit(failing)).statusCode).toBe(201);
      expect(await of('icms')).toMatchObject({ breaker: 'closed' });
    });
  });
});
