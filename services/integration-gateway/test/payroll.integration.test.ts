import { asc, eq, sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PauseFlags } from '../src/adapter-kit/pause-flags.js';
import { burstOf } from '../src/adapter-kit/system-policies.js';
import { config } from '../src/config.js';
import { outbox, payrollInstructions, systemCalls } from '../src/db/schema.js';
import {
  PAYROLL_INSTRUCTION_SUBMITTED,
  PAYROLL_INSTRUCTION_UNACKNOWLEDGED,
} from '../src/payroll/payroll-events.js';

import { StubPayroll } from './support/stub-payroll.js';
import { createTestApp, type TestApp } from './support/test-app.js';

/** A matcher typed `unknown`, so it sits in typed objects. */
const isoDateTime = (): unknown => expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/);
const hash = (): unknown => expect.stringMatching(/^[0-9a-f]{64}$/);
const containing = (text: string): unknown => expect.stringContaining(text);
const aDate = (): unknown => expect.any(Date);
const uuid = (): unknown =>
  expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

const PERSONAL_NUMBER = 'PN-2004-118';
const NATIONAL_ID = '27451863';

/** A supervisor approved the salary stoppage of `ADM-PSC-2026-000042`. */
const STOP = {
  instructionReference: 'ADM-PSC-2026-000042',
  employerCode: 'KEMSA',
  personalNumber: PERSONAL_NUMBER,
  nationalId: NATIONAL_ID,
  action: 'stop_salary',
  reason: 'Declaration not filed after notice and warning (Administrative Mechanisms)',
  effectiveDate: '2026-11-01',
} as const;

/** Payroll answers within 300 ms or is timed out; never cached. */
const PAYROLL_POLICY = {
  timeoutMs: 300,
  cacheTtlSeconds: null,
  ratePerMinute: 60_000,
  burst: burstOf(60_000),
  maxQueueMs: 1_000,
};

/** Spec 08 S15: the payroll adapter on the adapter kit, against a stub of the payroll mock. */
describe('payroll instructions', () => {
  let payroll: StubPayroll;
  let t: TestApp;
  let review: Record<string, string>;

  beforeAll(async () => {
    payroll = await StubPayroll.start();
    t = await createTestApp({ payrollUrl: payroll.baseUrl, policies: { payroll: PAYROLL_POLICY } });
    // Unavailable payroll is logged by design; keep the run quiet.
    t.app.useLogger(false);
    review = {
      authorization: `Bearer ${await t.token({ clientId: 'review', scope: 'payroll' })}`,
      'x-legal-basis': 'am-sanctions',
      'x-case-ref': 'case-0042',
    };
    // The first fetch in a process pays undici's lazy start-up, which on a busy CI runner can
    // outlast the 300ms timeout. Pay it here, without a timeout, so the first test's call
    // does not time out.
    await (await fetch(`${payroll.baseUrl}/warm-up`)).body?.cancel();
    return async () => {
      await t.close();
      await payroll.close();
    };
  });

  beforeEach(async () => {
    payroll.reset();
    await t.app.get(PauseFlags).resume('payroll');
    await t.db.delete(payrollInstructions);
    await t.db.delete(systemCalls);
    await t.db.delete(outbox);
  });

  const submit = (payload: object = STOP, headers: Record<string, string> = review) =>
    t.app.inject({
      method: 'POST',
      url: '/internal/v1/payroll/instructions',
      headers,
      payload,
    });

  const read = (reference: string, headers: Record<string, string> = review) =>
    t.app.inject({
      method: 'GET',
      url: `/internal/v1/payroll/instructions/${reference}`,
      headers,
    });

  const stored = () => t.db.select().from(payrollInstructions);
  const calls = () => t.db.select().from(systemCalls).orderBy(asc(systemCalls.calledAt));
  const events = async (type = PAYROLL_INSTRUCTION_SUBMITTED) =>
    (
      await t.db.select().from(outbox).where(eq(outbox.eventType, type)).orderBy(asc(outbox.id))
    ).map(({ envelope }) => envelope);

  describe('S15 submitInstruction accepted', () => {
    it('sends the instruction in the body and stores the acknowledgement (201)', async () => {
      const response = await submit();

      expect(response.statusCode).toBe(201);
      const ack = payroll.instructions.get(STOP.instructionReference);
      expect(response.json()).toEqual({
        instructionReference: STOP.instructionReference,
        action: 'stop_salary',
        status: 'accepted',
        payrollReference: ack?.payroll_reference,
        receivedAt: new Date(ack?.received_at ?? '').toISOString(),
        sentAt: isoDateTime(),
      });
      expect(payroll.requests).toEqual([
        {
          method: 'POST',
          path: '/payroll/v1/instructions',
          body: {
            instruction_reference: STOP.instructionReference,
            employer_code: 'KEMSA',
            personal_number: PERSONAL_NUMBER,
            id_number: NATIONAL_ID,
            action: 'stop_salary',
            reason: STOP.reason,
            effective_date: '2026-11-01',
          },
        },
      ]);

      expect(await stored()).toEqual([
        {
          instructionReference: STOP.instructionReference,
          action: 'stop_salary',
          employerCode: 'KEMSA',
          personalNumberHash: hash(),
          nationalIdHash: hash(),
          effectiveDate: '2026-11-01',
          status: 'accepted',
          payrollReference: uuid(),
          receivedAt: aDate(),
          sentAt: aDate(),
          requestedBy: 'review',
          legalBasis: 'am-sanctions',
          caseRef: 'case-0042',
        },
      ]);
      expect(await calls()).toEqual([
        expect.objectContaining({ system: 'payroll', outcome: 'answered', reason: null }),
      ]);
      expect(await events()).toEqual([
        expect.objectContaining({
          type: PAYROLL_INSTRUCTION_SUBMITTED,
          subject: STOP.instructionReference,
          tenant: 'platform',
          data: {
            instructionReference: STOP.instructionReference,
            action: 'stop_salary',
            status: 'accepted',
            payrollReference: ack?.payroll_reference,
            legalBasis: 'am-sanctions',
            caseRef: 'case-0042',
            requestedBy: 'review',
          },
        }),
      ]);
    });

    it('keeps the personal number and national ID only as keyed hashes', async () => {
      await submit();

      const serialised = await t.db.execute<{ row: string }>(
        sql`select row_to_json(p)::text as row from ${payrollInstructions} p
            union all select envelope::text from ${outbox}
            union all select row_to_json(c)::text from ${systemCalls} c`,
      );
      const everything = serialised.rows.map(({ row }) => row).join('\n');
      expect(everything).not.toContain(PERSONAL_NUMBER);
      expect(everything).not.toContain(NATIONAL_ID);
      expect(everything).not.toContain(STOP.reason);
    });

    it('sends a reinstatement under its own reference', async () => {
      await submit();
      const response = await submit({
        ...STOP,
        instructionReference: `${STOP.instructionReference}-R`,
        action: 'resume_salary',
        reason: 'Complied: declaration filed',
      });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({
        instructionReference: `${STOP.instructionReference}-R`,
        action: 'resume_salary',
        status: 'accepted',
      });
      expect(payroll.calls).toBe(2);
      expect(await stored()).toHaveLength(2);
    });
  });

  describe('S15 same reference again', () => {
    it('answers the stored acknowledgement (200) without a second call', async () => {
      const first = await submit();
      const second = await submit();

      expect(second.statusCode).toBe(200);
      expect(second.json()).toEqual(first.json());
      expect(payroll.calls).toBe(1);
      expect(await stored()).toHaveLength(1);
      expect(await calls()).toHaveLength(1);
      expect(await events()).toHaveLength(1);
    });

    it('refuses another instruction under a used reference (409) without calling payroll', async () => {
      await submit();
      const response = await submit({ ...STOP, effectiveDate: '2026-12-01' });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ type: 'instruction-reference-conflict' });
      expect(payroll.calls).toBe(1);
    });

    it('answers two sends at once with one instruction: one 201, one 200', async () => {
      payroll.behaviour = { kind: 'slow', ms: 100 };

      const responses = await Promise.all([submit(), submit()]);

      expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 201]);
      const [one, other] = responses;
      expect(one.json()).toEqual(other.json());
      expect(await stored()).toHaveLength(1);
      expect(await events()).toHaveLength(1);
      // Payroll is idempotent by reference: both sends reached it, one instruction exists there.
      expect(payroll.instructions.size).toBe(1);
    });

    it('stores what payroll holds when payroll received an instruction the gateway never heard back on', async () => {
      payroll.behaviour = { kind: 'store-then-fail' };
      expect((await submit()).statusCode).toBe(503);
      expect(await stored()).toEqual([]);

      payroll.behaviour = { kind: 'payroll' };
      const retry = await submit();

      expect(retry.statusCode).toBe(201);
      expect(retry.json()).toMatchObject({
        payrollReference: payroll.instructions.get(STOP.instructionReference)?.payroll_reference,
      });
      expect(payroll.instructions.size).toBe(1);
    });

    it('asks payroll again while it left the instruction pending, storing it once settled', async () => {
      payroll.behaviour = { kind: 'pending' };
      const first = await submit();
      expect(first.statusCode).toBe(201);
      expect(first.json()).toMatchObject({
        status: 'pending',
        payrollReference: null,
        receivedAt: null,
      });

      payroll.behaviour = { kind: 'payroll' };
      const settled = await submit();

      expect(settled.statusCode).toBe(200);
      expect(settled.json()).toMatchObject({
        status: 'accepted',
        payrollReference: payroll.instructions.get(STOP.instructionReference)?.payroll_reference,
        receivedAt: isoDateTime(),
        sentAt: first.json<{ sentAt: string }>().sentAt,
      });
      expect(payroll.calls).toBe(2);
      expect((await events()).map((event) => event.data)).toEqual([
        expect.objectContaining({ status: 'pending' }),
        expect.objectContaining({ status: 'accepted' }),
      ]);
      // Settled: a further replay is answered from the store.
      expect((await submit()).statusCode).toBe(200);
      expect(payroll.calls).toBe(2);
    });

    it('answers the stored pending acknowledgement (200) when payroll is down on its replay', async () => {
      payroll.behaviour = { kind: 'pending' };
      const first = await submit();
      expect(first.statusCode).toBe(201);

      payroll.behaviour = { kind: 'status', status: 503 };
      const replay = await submit();

      expect(replay.statusCode).toBe(200);
      expect(replay.json()).toEqual(first.json());
      expect((await read(STOP.instructionReference)).json()).toEqual(first.json());
      expect(payroll.calls).toBe(2);
      // The attempt is audited, and nothing new is recorded as sent.
      expect((await calls()).map((call) => call.outcome)).toEqual(['answered', 'unavailable']);
      expect(await events(PAYROLL_INSTRUCTION_UNACKNOWLEDGED)).toEqual([
        expect.objectContaining({
          data: expect.objectContaining({ reason: 'upstream-error' }) as unknown,
        }),
      ]);
      expect((await events()).map((event) => event.data)).toEqual([
        expect.objectContaining({ status: 'pending' }),
      ]);
    });

    it('keeps a failed acknowledgement final: a replay answers it without asking payroll again', async () => {
      payroll.behaviour = { kind: 'failed' };
      const first = await submit();
      expect(first.statusCode).toBe(201);
      expect(first.json()).toMatchObject({ status: 'failed' });

      payroll.behaviour = { kind: 'payroll' };
      const replay = await submit();

      expect(replay.statusCode).toBe(200);
      expect(replay.json()).toEqual(first.json());
      expect(payroll.calls).toBe(1);
      expect(await stored()).toEqual([expect.objectContaining({ status: 'failed' })]);
    });

    it('refuses an acknowledgement of another instruction payroll holds under the reference', async () => {
      await submit();
      await t.db.delete(payrollInstructions);

      const response = await submit({ ...STOP, personalNumber: 'PN-1999-001' });

      expect(response.statusCode).toBe(409);
      expect(await stored()).toEqual([]);
      expect(await events(PAYROLL_INSTRUCTION_UNACKNOWLEDGED)).toEqual([
        expect.objectContaining({
          data: expect.objectContaining({ reason: 'reference-conflict' }) as unknown,
        }),
      ]);
    });
  });

  describe('S15 payroll down', () => {
    it('answers 503 and records nothing as sent', async () => {
      payroll.behaviour = { kind: 'status', status: 503 };

      const response = await submit();

      expect(response.statusCode).toBe(503);
      expect(response.headers['content-type']).toContain('application/problem+json');
      expect(response.json()).toMatchObject({
        type: 'upstream-unavailable',
        detail: containing('Nothing was recorded as sent'),
      });
      expect(await stored()).toEqual([]);
      expect(await events()).toEqual([]);
      expect(await calls()).toEqual([
        expect.objectContaining({
          system: 'payroll',
          outcome: 'unavailable',
          reason: 'upstream-error',
        }),
      ]);
      // The attempt is audited (ADR-008), as not acknowledged.
      expect(await events(PAYROLL_INSTRUCTION_UNACKNOWLEDGED)).toEqual([
        expect.objectContaining({
          subject: STOP.instructionReference,
          tenant: 'platform',
          data: {
            instructionReference: STOP.instructionReference,
            action: 'stop_salary',
            reason: 'upstream-error',
            legalBasis: 'am-sanctions',
            caseRef: 'case-0042',
            requestedBy: 'review',
          },
        }),
      ]);
      expect((await read(STOP.instructionReference)).statusCode).toBe(404);
    });

    it('sends the instruction when retried once payroll is back', async () => {
      payroll.behaviour = { kind: 'status', status: 503 };
      await submit();
      payroll.behaviour = { kind: 'payroll' };

      const retry = await submit();

      expect(retry.statusCode).toBe(201);
      expect(await stored()).toHaveLength(1);
    });

    it('times payroll out (503, reason timeout)', async () => {
      payroll.behaviour = { kind: 'hang' };

      const started = performance.now();
      const response = await submit();

      expect(response.statusCode).toBe(503);
      expect(performance.now() - started).toBeLessThan(2_000);
      expect(await stored()).toEqual([]);
      expect(await calls()).toEqual([
        expect.objectContaining({ outcome: 'unavailable', reason: 'timeout' }),
      ]);
    });

    it('a paused payroll is not called (503, reason paused)', async () => {
      await t.app.get(PauseFlags).pause('payroll');

      const response = await submit();

      expect(response.statusCode).toBe(503);
      expect(payroll.calls).toBe(0);
      expect(await calls()).toEqual([
        expect.objectContaining({ outcome: 'unavailable', reason: 'paused' }),
      ]);
      expect(await events(PAYROLL_INSTRUCTION_UNACKNOWLEDGED)).toEqual([
        expect.objectContaining({
          data: expect.objectContaining({ reason: 'paused' }) as unknown,
        }),
      ]);
    });

    it('a paused payroll still answers a stored acknowledgement (200) without calling payroll', async () => {
      const first = await submit();
      await t.app.get(PauseFlags).pause('payroll');

      const replay = await submit();

      expect(replay.statusCode).toBe(200);
      expect(replay.json()).toEqual(first.json());
      expect(payroll.calls).toBe(1);
      expect(await calls()).toHaveLength(1);
      expect(await events(PAYROLL_INSTRUCTION_UNACKNOWLEDGED)).toEqual([]);
    });

    it('a paused payroll answers a stored pending acknowledgement (200) without calling payroll', async () => {
      payroll.behaviour = { kind: 'pending' };
      const first = await submit();
      expect(first.json()).toMatchObject({ status: 'pending' });
      await t.app.get(PauseFlags).pause('payroll');

      const replay = await submit();

      expect(replay.statusCode).toBe(200);
      expect(replay.json()).toEqual(first.json());
      expect(payroll.calls).toBe(1);
      // Asking again was refused by the pause: the attempt is audited, nothing new is stored.
      expect((await calls()).map((call) => [call.outcome, call.reason])).toEqual([
        ['answered', null],
        ['unavailable', 'paused'],
      ]);
      expect(await events(PAYROLL_INSTRUCTION_UNACKNOWLEDGED)).toEqual([
        expect.objectContaining({
          data: expect.objectContaining({ reason: 'paused' }) as unknown,
        }),
      ]);
      expect(await stored()).toEqual([expect.objectContaining({ status: 'pending' })]);
    });
  });

  describe('S15 legal basis and caller', () => {
    it.each([
      ['missing', {}],
      ['a lookup basis', { 'x-legal-basis': 'regs-r20-1-b' }],
      ['an ICMS basis', { 'x-legal-basis': 'regs-r20-referral' }],
      ['unknown', { 'x-legal-basis': 'curiosity' }],
    ])('refuses a legal basis %s (400) without calling payroll', async (_, basis) => {
      const headers = { ...review };
      delete headers['x-legal-basis'];

      const response = await submit(STOP, { ...headers, ...basis });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        errors: [{ path: 'X-Legal-Basis', message: containing('am-sanctions') }],
      });
      expect(payroll.calls).toBe(0);
    });

    it('takes the case reference as optional', async () => {
      const headers = { ...review };
      delete headers['x-case-ref'];

      const response = await submit(STOP, headers);

      expect(response.statusCode).toBe(201);
      expect(await stored()).toEqual([expect.objectContaining({ caseRef: null })]);
    });

    it.each([
      ['no national ID', { nationalId: undefined }],
      ['a malformed national ID', { nationalId: '27-451863' }],
      ['an unknown action', { action: 'garnish_salary' }],
      ['a reference payroll cannot hold', { instructionReference: `ADM-${'9'.repeat(40)}` }],
      ['an employer code payroll cannot hold', { employerCode: 'E'.repeat(21) }],
      ['an empty reason', { reason: ' ' }],
      ['a date that is not one', { effectiveDate: '2026-13-01' }],
      ['an unknown field', { salary: 1 }],
    ])('refuses %s (400) without calling payroll', async (_, change) => {
      const response = await submit({ ...STOP, ...change });

      expect(response.statusCode).toBe(400);
      expect(payroll.calls).toBe(0);
    });

    it('needs a service token with the payroll scope (403)', async () => {
      const registry = `Bearer ${await t.token({ clientId: 'review', scope: 'registry' })}`;

      const response = await submit(STOP, { ...review, authorization: registry });

      expect(response.statusCode).toBe(403);
      expect(payroll.calls).toBe(0);
    });
  });

  describe('reading an instruction', () => {
    it('returns the stored acknowledgement without calling payroll', async () => {
      const sent: unknown = (await submit()).json();
      payroll.reset();

      const response = await read(STOP.instructionReference);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(sent);
      expect(payroll.calls).toBe(0);
    });

    it('is 404 for a reference never acknowledged', async () => {
      expect((await read('ADM-PSC-2026-999999')).statusCode).toBe(404);
    });

    it('needs the payroll scope (403)', async () => {
      await submit();
      const registry = `Bearer ${await t.token({ clientId: 'review', scope: 'registry' })}`;

      const response = await read(STOP.instructionReference, { authorization: registry });

      expect(response.statusCode).toBe(403);
    });
  });

  // Last: it opens payroll's breaker, which only the clock moving past the cool-down closes.
  describe('payroll in coverage with its own breaker', () => {
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

    it('lists payroll with its calls, failures, last success and no cache', async () => {
      await submit();
      await submit(); // a replay: no call
      payroll.behaviour = { kind: 'status', status: 500 };
      await submit({ ...STOP, instructionReference: 'ADM-PSC-2026-000043' });

      expect(await of('payroll')).toEqual({
        system: 'payroll',
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
        timeoutMs: 300,
        breakerFailureThreshold: config.BREAKER_FAILURE_THRESHOLD,
        breakerCooldownSeconds: config.BREAKER_COOLDOWN_MS / 1000,
      });
    });

    it("opens payroll's breaker alone after consecutive failures, then fails fast", async () => {
      // An acknowledgement first, so earlier tests' failures do not count towards this run.
      await submit();
      const failing = { ...STOP, instructionReference: 'ADM-PSC-2026-000050' };
      payroll.behaviour = { kind: 'status', status: 503 };
      for (let call = 0; call < config.BREAKER_FAILURE_THRESHOLD; call += 1) await submit(failing);
      expect(payroll.calls).toBe(1 + config.BREAKER_FAILURE_THRESHOLD);

      const fast = await submit(failing);

      expect(fast.statusCode).toBe(503);
      expect(fast.json()).toMatchObject({ detail: containing('breaker-open') });
      expect(payroll.calls).toBe(1 + config.BREAKER_FAILURE_THRESHOLD);
      const rows = await coverage();
      expect(rows.find((row) => row.system === 'payroll')).toMatchObject({ breaker: 'open' });
      expect(rows.filter((row) => row.system !== 'payroll')).toEqual(
        rows
          .filter((row) => row.system !== 'payroll')
          .map((): unknown => expect.objectContaining({ breaker: 'closed' })),
      );

      // Past the cool-down a probe goes through, and an acknowledgement closes the circuit.
      payroll.behaviour = { kind: 'payroll' };
      t.clock.advance(config.BREAKER_COOLDOWN_MS + 1);
      expect((await submit(failing)).statusCode).toBe(201);
      expect(await of('payroll')).toMatchObject({ breaker: 'closed' });
    });
  });
});
