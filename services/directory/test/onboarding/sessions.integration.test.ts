import { withTenant } from '@adili/data-access';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PLATFORM_TENANT } from '../../src/commissions/access.js';
import { onboardingOtps, onboardingSessions, outbox } from '../../src/db/schema.js';
import type { OnboardingSession } from '../../src/onboarding/representation.js';
import { OnboardingSessionSweeper } from '../../src/onboarding/sessions/expiry-sweep.js';
import { componentSchema, contractErrors, okResponse } from '../support/contract.js';
import { type DirectoryApi, startDirectoryApi } from '../support/directory-api.js';
import { givenCommissions } from '../support/fixtures.js';
import { givenRoster, givenSession, onSession } from '../support/onboarding.js';

/**
 * Spec 03 S10 over HTTP: a session opens only with its secret (404 otherwise, alike for every
 * cause), ends at its expiry (410, cookie cleared by the BFF), and the sweep ends abandoned
 * sessions. Plus what the session view shows along the way.
 */

const NOW = new Date('2026-10-01T09:00:00Z');
const MINUTE = 60 * 1000;
const SESSION_PATH = '/v1/onboarding/sessions/{sessionId}';

/**
 * Every route on a session, as `[method, path below the session, body]`. The steps added by
 * later tickets (codes, contacts, confirm, resend) join this list so S10 covers them too.
 */
const SESSION_ROUTES: [method: 'GET' | 'POST', path: string, body?: unknown][] = [
  ['GET', ''],
  ['POST', '/otp/email/verify', { code: '123456' }],
  ['POST', '/otp/email/resend'],
  ['POST', '/contacts', { channel: 'email', value: 'someone@example.com' }],
  ['POST', '/confirm'],
  ['POST', '/resend-password-email'],
];

let api: DirectoryApi;
let recordId: string;

async function sessionRow(id: string) {
  const [row] = await withTenant(api.db, { tenant: PLATFORM_TENANT, subject: 'test' }, (tx) =>
    tx.select().from(onboardingSessions).where(eq(onboardingSessions.id, id)),
  );
  return row;
}

async function endedEvents() {
  const events = await api.db
    .select({ type: outbox.eventType, envelope: outbox.envelope })
    .from(outbox)
    .orderBy(asc(outbox.id));
  return events
    .filter(({ type }) => type === 'onboarding.session.ended.v1')
    .map(({ envelope }) => ({ tenant: envelope.tenant, data: envelope.data }));
}

beforeAll(async () => {
  api = await startDirectoryApi();
});

beforeEach(async () => {
  await api.reset();
  api.clock.set(NOW);
  await givenCommissions(api.db, [{ slug: 'tsc', name: 'Teachers Service Commission' }]);
  const ids = await givenRoster(api, 'tsc', [
    {
      personnelFileNumber: 'TSC/100200',
      fullName: 'Wanjiru Achieng Otieno',
      nationalId: '12345678',
      designation: 'Senior Teacher',
      reportingEntity: 'Kisumu Girls High School',
      email: 'wanjiru.otieno@tsc.go.ke',
      phone: '+254712345123',
    },
  ]);
  recordId = ids.get('TSC/100200') ?? '';
});

afterAll(async () => {
  await api.close();
});

describe('S10 session secret', () => {
  it('answers 404 alike on every session route without the secret, with a wrong one, or for no such session', async () => {
    const { id, secret } = await givenSession(api, {
      recordId,
      state: 'email-pending',
      email: 'wanjiru.otieno@tsc.go.ke',
    });
    const unknown = '0192a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
    const cases: [string, string | undefined][] = [
      [id, undefined],
      [id, `${secret.slice(0, -1)}x`],
      [id, ''],
      [unknown, secret],
      ['not-a-uuid', secret],
    ];

    for (const [method, path, body] of SESSION_ROUTES) {
      const problems = [];
      for (const [sessionId, given] of cases) {
        const response = await onSession(api, method, sessionId, path, given, body);
        expect(response.statusCode, `${method} ${path} ${response.body}`).toBe(404);
        const problem = response.json<Record<string, unknown>>();
        delete problem.instance;
        problems.push(problem);
      }
      expect(new Set(problems.map((problem) => JSON.stringify(problem))).size).toBe(1);
      expect(problems[0]).not.toHaveProperty('code');
    }

    expect((await onSession(api, 'GET', id, '', secret)).statusCode).toBe(200);
  });
});

describe('S10 expiry', () => {
  it('answers 410 session-expired once past expiresAt, ending the session with outcome expired', async () => {
    const { id, secret } = await givenSession(api, {
      recordId,
      state: 'email-pending',
      email: 'wanjiru.otieno@tsc.go.ke',
    });

    api.clock.advance(30 * MINUTE - 1);
    expect((await onSession(api, 'GET', id, '', secret)).statusCode).toBe(200);
    api.clock.advance(1);

    for (const [method, path, body] of SESSION_ROUTES) {
      const response = await onSession(api, method, id, path, secret, body);
      expect(response.statusCode, `${method} ${path}`).toBe(410);
      expect(response.json()).toMatchObject({ code: 'session-expired', status: 410 });
      expect(contractErrors(componentSchema('OnboardingProblem'), response.json())).toEqual([]);
    }
    expect(await sessionRow(id)).toMatchObject({
      state: 'expired',
      endReason: 'expired',
      completedAt: new Date(NOW.getTime() + 30 * MINUTE),
    });
    // Ended once, whatever comes after.
    await onSession(api, 'GET', id, '', secret);
    expect(await endedEvents()).toEqual([
      { tenant: 'tsc', data: { sessionId: id, outcome: 'expired' } },
    ]);
  });

  it('still answers 404, not 410, to a wrong secret on an ended session', async () => {
    const { id } = await givenSession(api, { recordId, state: 'expired' });

    expect((await onSession(api, 'GET', id, '', 'wrong')).statusCode).toBe(404);
  });

  it('keeps a confirmed session readable until its expiry, then 410 without changing it', async () => {
    const { id, secret } = await givenSession(api, {
      recordId,
      state: 'confirmed',
      email: 'wanjiru.otieno@tsc.go.ke',
      emailVerified: true,
      phone: '+254712345123',
      phoneVerified: true,
    });

    expect((await onSession(api, 'GET', id, '', secret)).json()).toMatchObject({
      state: 'confirmed',
    });
    api.clock.advance(30 * MINUTE);
    expect((await onSession(api, 'GET', id, '', secret)).statusCode).toBe(410);
    expect(await sessionRow(id)).toMatchObject({ state: 'confirmed' });
    expect(await endedEvents()).toEqual([]);
  });

  it('sweeps live sessions past their expiry, leaving the rest', async () => {
    const stale = await givenSession(api, {
      recordId,
      state: 'phone-pending',
      email: 'wanjiru.otieno@tsc.go.ke',
      emailVerified: true,
      phone: '+254712345123',
      createdAt: new Date(NOW.getTime() - 45 * MINUTE),
    });
    const live = await givenSession(api, { recordId, state: 'email-contact-required' });
    const done = await givenSession(api, {
      recordId,
      state: 'identity-mismatch',
      createdAt: new Date(NOW.getTime() - 45 * MINUTE),
    });

    const ended = await api.app.get(OnboardingSessionSweeper).sweep();

    expect(ended).toBe(1);
    expect((await sessionRow(stale.id))?.state).toBe('expired');
    expect((await sessionRow(live.id))?.state).toBe('email-contact-required');
    expect((await sessionRow(done.id))?.state).toBe('identity-mismatch');
    expect(await endedEvents()).toEqual([
      { tenant: 'tsc', data: { sessionId: stale.id, outcome: 'expired' } },
    ]);
  });
});

describe('S10 expiry schedule', () => {
  it('sweeps from the Temporal schedule on the directory worker, every minute, skipping overlaps', async () => {
    const stale = await givenSession(api, {
      recordId,
      state: 'email-contact-required',
      createdAt: new Date(NOW.getTime() - 45 * MINUTE),
    });

    const { action, spec, policies } = await api.expirySchedule.describe();
    expect(action).toMatchObject({
      type: 'startWorkflow',
      workflowType: 'onboardingSessionExpiry',
      taskQueue: process.env.TEMPORAL_TASK_QUEUE,
    });
    expect(spec.intervals).toEqual([expect.objectContaining({ every: MINUTE })]);
    expect(policies.overlap).toBe('SKIP');

    // Paused in tests; a run now goes through the worker to the sweep.
    await api.expirySchedule.trigger();
    await expect
      .poll(async () => (await sessionRow(stale.id))?.state, { timeout: 20_000, interval: 250 })
      .toBe('expired');
    expect(await endedEvents()).toEqual([
      { tenant: 'tsc', data: { sessionId: stale.id, outcome: 'expired' } },
    ]);
  });
});

describe('session storage', () => {
  it("keeps a session's codes in the session's Commission", async () => {
    await givenCommissions(api.db, [{ slug: 'psc', name: 'Public Service Commission' }]);
    const session = await givenSession(api, {
      recordId,
      state: 'email-pending',
      email: 'wanjiru.otieno@tsc.go.ke',
    });
    const code = (tenant: string) =>
      withTenant(api.db, { tenant: PLATFORM_TENANT, subject: 'test' }, (tx) =>
        tx.insert(onboardingOtps).values({
          sessionId: session.id,
          channel: 'phone',
          tenant,
          codeHmac: 'x',
          expiresAt: NOW,
          lastSentAt: NOW,
        }),
      );

    await expect(code('psc')).rejects.toMatchObject({
      cause: expect.objectContaining({ code: '23503' }) as unknown,
    });
    await expect(code('tsc')).resolves.toBeDefined();
  });
});

describe('session view', () => {
  it('shows the pending code, and roster details only from phone-verified', async () => {
    const pending = await givenSession(api, {
      recordId,
      state: 'phone-pending',
      email: 'wanjiru.otieno@tsc.go.ke',
      emailVerified: true,
      phone: '+254700000456',
      phoneSource: 'declarant',
      otp: { channel: 'phone', code: '123456', attempts: 2, resends: 1 },
    });
    const verified = await givenSession(api, {
      recordId,
      state: 'phone-verified',
      email: 'wanjiru.otieno@tsc.go.ke',
      emailVerified: true,
      phone: '+254712345123',
      phoneVerified: true,
    });
    api.clock.advance(20_000);

    const pendingView = (
      await onSession(api, 'GET', pending.id, '', pending.secret)
    ).json<OnboardingSession>();
    const verifiedView = (
      await onSession(api, 'GET', verified.id, '', verified.secret)
    ).json<OnboardingSession>();

    expect(contractErrors(okResponse(SESSION_PATH, 'get'), pendingView)).toEqual([]);
    expect(contractErrors(okResponse(SESSION_PATH, 'get'), verifiedView)).toEqual([]);
    expect(pendingView).toMatchObject({
      state: 'phone-pending',
      contacts: {
        email: { masked: 'w***@tsc.go.ke', source: 'roster', verified: true },
        phone: { masked: '07** *** 456', source: 'declarant', verified: false },
      },
      details: null,
      otp: {
        channel: 'phone',
        resendAvailableAt: '2026-10-01T09:01:00.000Z',
        resendsLeft: 2,
        attemptsLeft: 3,
      },
    });
    expect(verifiedView).toMatchObject({
      state: 'phone-verified',
      details: {
        fullName: 'Wanjiru Achieng Otieno',
        personnelFileNumber: 'TSC/100200',
        designation: 'Senior Teacher',
        reportingEntity: 'Kisumu Girls High School',
      },
      otp: { channel: null, resendAvailableAt: null, resendsLeft: 0, attemptsLeft: 0 },
      outcome: null,
      ofr: null,
    });
  });
});
