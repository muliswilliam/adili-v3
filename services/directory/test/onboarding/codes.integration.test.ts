import { withTenant } from '@adili/data-access';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PLATFORM_TENANT } from '../../src/commissions/access.js';
import {
  onboardingFailures,
  onboardingOtps,
  onboardingSessions,
  outbox,
  rosterRecords,
} from '../../src/db/schema.js';
import type {
  OnboardingSession,
  OnboardingSessionCreated,
} from '../../src/onboarding/representation.js';
import { componentSchema, contractErrors, okResponse } from '../support/contract.js';
import { type DirectoryApi, startDirectoryApi } from '../support/directory-api.js';
import { givenCommissions } from '../support/fixtures.js';
import {
  givenRoster,
  givenSession,
  identify,
  type IdentifyInput,
  onSession,
} from '../support/onboarding.js';

/**
 * Spec 03 S7-S9 over HTTP, as the portal BFF calls the routes: email and phone codes (send,
 * verify, wrong codes, expiry), resends (cooldown, cap), contacts the roster lacks (normalised,
 * written back to the roster once verified), and a code that cannot be sent (502, nothing
 * changes). Codes are read from the fake sender (`api.otpDelivery`); time is `api.clock`.
 */

const NOW = new Date('2026-10-01T09:00:00Z');
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const COMMISSION = 'Teachers Service Commission';

const WANJIRU = {
  personnelFileNumber: 'TSC/100200',
  fullName: 'Wanjiru Achieng Otieno',
  nationalId: '12345678',
  email: 'wanjiru.otieno@tsc.go.ke',
  phone: '+254712345123',
};
/** On the roster with an email but no phone. */
const KIPRONO = {
  personnelFileNumber: 'TSC/300400',
  fullName: 'Kiprono Mutai Chebet',
  nationalId: '23456789',
  email: 'kiprono.chebet@tsc.go.ke',
};
/** On the roster with neither. */
const ATIENO = {
  personnelFileNumber: 'TSC/400500',
  fullName: 'Atieno Akinyi Odera',
  nationalId: '34567890',
};

const VERIFY_PATH = '/v1/onboarding/sessions/{sessionId}/otp/{channel}/verify';
const CONTACTS_PATH = '/v1/onboarding/sessions/{sessionId}/contacts';

let api: DirectoryApi;
let ids: Map<string, string>;
/** A client address of its own per test: the clock is frozen, so per-IP budgets never refill. */
let nextIp = 1;
let ip: string;

interface Session {
  id: string;
  secret: string;
}

const as = (record: { personnelFileNumber: string; nationalId: string }): IdentifyInput => ({
  commission: 'tsc',
  personnelFileNumber: record.personnelFileNumber,
  nationalId: record.nationalId,
});

async function start(record: { personnelFileNumber: string; nationalId: string }) {
  const response = await identify(api, as(record), ip);
  expect(response.statusCode, response.body).toBe(201);
  const created = response.json<OnboardingSessionCreated>();
  return { id: created.id, secret: created.secret, created };
}

const verify = (session: Session, channel: string, code: string) =>
  onSession(api, 'POST', session.id, `/otp/${channel}/verify`, session.secret, { code }, ip);

const resend = (session: Session, channel: string) =>
  onSession(api, 'POST', session.id, `/otp/${channel}/resend`, session.secret, undefined, ip);

const provide = (session: Session, channel: string, value: string) =>
  onSession(api, 'POST', session.id, '/contacts', session.secret, { channel, value }, ip);

const read = (session: Session) =>
  onSession(api, 'GET', session.id, '', session.secret, undefined, ip);

/** The code last sent to `to`. */
function codeSentTo(to: string): string {
  const code = api.otpDelivery.last(to)?.code;
  if (!code) throw new Error(`no code sent to ${to}`);
  return code;
}

/** A 6-digit code other than `code`. */
const otherThan = (code: string) => (code === '000000' ? '111111' : '000000');

/**
 * Identify attempts the test's IP has left (`onboarding-identify`, 5 per 15 minutes), as the
 * `RateLimit-Remaining` of one more identify says less the one it uses.
 */
async function identifyAttemptsLeft(): Promise<number> {
  const response = await identify(
    api,
    { commission: 'tsc', personnelFileNumber: 'TSC/999999', nationalId: '99999999' },
    ip,
  );
  expect(response.statusCode).toBe(404);
  return Number(response.headers['ratelimit-remaining']) + 1;
}

/** Failed attempts counted against `tenant`, over every window. */
async function failuresOf(tenant: string) {
  const rows = await withTenant(api.db, { tenant: PLATFORM_TENANT, subject: 'test' }, (tx) =>
    tx.select().from(onboardingFailures).where(eq(onboardingFailures.tenant, tenant)),
  );
  return rows.reduce((sum, row) => sum + row.failures, 0);
}

async function sessionRow(id: string) {
  const [row] = await withTenant(api.db, { tenant: PLATFORM_TENANT, subject: 'test' }, (tx) =>
    tx.select().from(onboardingSessions).where(eq(onboardingSessions.id, id)),
  );
  return row;
}

async function otpRows(id: string) {
  return withTenant(api.db, { tenant: PLATFORM_TENANT, subject: 'test' }, (tx) =>
    tx
      .select()
      .from(onboardingOtps)
      .where(eq(onboardingOtps.sessionId, id))
      .orderBy(asc(onboardingOtps.channel)),
  );
}

async function record(fileNumber: string) {
  const [row] = await withTenant(api.db, { tenant: PLATFORM_TENANT, subject: 'test' }, (tx) =>
    tx
      .select({
        email: rosterRecords.email,
        emailSource: rosterRecords.emailSource,
        phone: rosterRecords.phone,
        phoneSource: rosterRecords.phoneSource,
      })
      .from(rosterRecords)
      .where(eq(rosterRecords.id, ids.get(fileNumber) ?? '')),
  );
  return row;
}

async function sessionEvents() {
  const events = await api.db
    .select({ type: outbox.eventType, envelope: outbox.envelope })
    .from(outbox)
    .orderBy(asc(outbox.id));
  return events
    .filter(({ type }) => type.startsWith('onboarding.session.'))
    .map(({ type, envelope }) => ({ type, tenant: envelope.tenant, data: envelope.data }));
}

function expectProblem(
  response: Awaited<ReturnType<typeof verify>>,
  status: number,
  code: string,
  extra: Record<string, unknown> = {},
) {
  expect(response.statusCode, response.body).toBe(status);
  expect(response.json()).toMatchObject({ status, code, ...extra });
  expect(contractErrors(componentSchema('OnboardingProblem'), response.json())).toEqual([]);
}

beforeAll(async () => {
  api = await startDirectoryApi();
});

beforeEach(async () => {
  await api.reset();
  api.clock.set(NOW);
  ip = `198.51.100.${nextIp++}`;
  await givenCommissions(api.db, [{ slug: 'tsc', name: COMMISSION }]);
  ids = await givenRoster(api, 'tsc', [WANJIRU, KIPRONO, ATIENO]);
});

afterAll(async () => {
  await api.close();
});

describe('S7 email code', () => {
  it('sends one onboarding-otp-email to the roster email, and the right code moves on to the phone', async () => {
    const session = await start(WANJIRU);

    expect(api.otpDelivery.sent()).toEqual([
      {
        channel: 'email',
        to: WANJIRU.email,
        code: expect.stringMatching(/^[0-9]{6}$/) as string,
        commissionName: COMMISSION,
        expiresInMinutes: 10,
        tenant: 'tsc',
      },
    ]);

    api.clock.advance(2 * MINUTE);
    const response = await verify(session, 'email', codeSentTo(WANJIRU.email));

    expect(response.statusCode, response.body).toBe(200);
    const view = response.json<OnboardingSession>();
    expect(contractErrors(okResponse(VERIFY_PATH, 'post'), view)).toEqual([]);
    expect(view).toMatchObject({
      state: 'phone-pending',
      contacts: {
        email: { masked: 'w***@tsc.go.ke', source: 'roster', verified: true },
        phone: { masked: '07** *** 123', source: 'roster', verified: false },
      },
      details: null,
      otp: {
        channel: 'phone',
        resendAvailableAt: '2026-10-01T09:03:00.000Z',
        resendsLeft: 3,
        attemptsLeft: 5,
      },
      // 30 minutes from identify, plus 10 for the step.
      expiresAt: '2026-10-01T09:40:00.000Z',
    });
    expect(api.otpDelivery.sent(WANJIRU.phone)).toEqual([
      {
        channel: 'phone',
        to: WANJIRU.phone,
        code: expect.stringMatching(/^[0-9]{6}$/) as string,
        commissionName: COMMISSION,
        expiresInMinutes: 10,
        tenant: 'tsc',
      },
    ]);
    expect(await sessionRow(session.id)).toMatchObject({
      emailVerifiedAt: new Date(NOW.getTime() + 2 * MINUTE),
      phoneVerifiedAt: null,
    });
    expect((await sessionEvents()).slice(-2)).toEqual([
      {
        type: 'onboarding.session.advanced.v1',
        tenant: 'tsc',
        data: { sessionId: session.id, from: 'email-pending', state: 'email-verified' },
      },
      {
        type: 'onboarding.session.advanced.v1',
        tenant: 'tsc',
        data: { sessionId: session.id, from: 'email-verified', state: 'phone-pending' },
      },
    ]);
  });

  it('verifies the phone code into phone-verified with the roster details to confirm', async () => {
    const session = await start(WANJIRU);
    await verify(session, 'email', codeSentTo(WANJIRU.email));

    const response = await verify(session, 'phone', codeSentTo(WANJIRU.phone));

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json<OnboardingSession>()).toMatchObject({
      state: 'phone-verified',
      contacts: { email: { verified: true }, phone: { verified: true } },
      details: { fullName: WANJIRU.fullName, personnelFileNumber: WANJIRU.personnelFileNumber },
      otp: { channel: null },
      expiresAt: '2026-10-01T09:50:00.000Z',
    });
    // Roster contacts are not rewritten.
    expect(await record(WANJIRU.personnelFileNumber)).toEqual({
      email: WANJIRU.email,
      emailSource: 'roster',
      phone: WANJIRU.phone,
      phoneSource: 'roster',
    });
  });

  it('ends the session on the fifth wrong code: 410, state expired, event outcome rate-limited', async () => {
    const session = await start(WANJIRU);
    const wrong = otherThan(codeSentTo(WANJIRU.email));

    for (const attemptsLeft of [4, 3, 2, 1]) {
      expectProblem(await verify(session, 'email', wrong), 400, 'otp-invalid', { attemptsLeft });
    }
    expect((await read(session)).json<OnboardingSession>().otp.attemptsLeft).toBe(1);
    expect(await failuresOf('tsc')).toBe(0);
    expectProblem(await verify(session, 'email', wrong), 410, 'session-expired');
    // Running out of codes counts against the Commission as a no-match at identify does.
    expect(await failuresOf('tsc')).toBe(1);
    // ...and uses up an identify attempt of the IP: 5 per IP, less the first identify.
    expect(await identifyAttemptsLeft()).toBe(3);

    expect(await sessionRow(session.id)).toMatchObject({
      state: 'expired',
      endReason: 'rate-limited',
      completedAt: NOW,
    });
    expect((await sessionEvents()).at(-1)).toEqual({
      type: 'onboarding.session.ended.v1',
      tenant: 'tsc',
      data: { sessionId: session.id, outcome: 'rate-limited' },
    });
    // Over, even for the right code.
    expectProblem(
      await verify(session, 'email', codeSentTo(WANJIRU.email)),
      410,
      'session-expired',
    );
    expect((await read(session)).statusCode).toBe(410);
  });

  it('answers otp-expired past 10 minutes without counting an attempt; a new code works', async () => {
    const session = await start(WANJIRU);
    const first = codeSentTo(WANJIRU.email);

    api.clock.advance(10 * MINUTE);
    expectProblem(await verify(session, 'email', first), 400, 'otp-expired');
    expect((await otpRows(session.id))[0]?.attempts).toBe(0);

    expect((await resend(session, 'email')).statusCode).toBe(202);
    const response = await verify(session, 'email', codeSentTo(WANJIRU.email));
    expect(response.statusCode, response.body).toBe(200);
  });

  it('answers 409 wrong-step when the session is not waiting for that code', async () => {
    const session = await start(WANJIRU);

    expectProblem(await verify(session, 'phone', '123456'), 409, 'wrong-step');
    expectProblem(await resend(session, 'phone'), 409, 'wrong-step');
    expectProblem(await provide(session, 'email', 'someone@example.com'), 409, 'wrong-step');

    await verify(session, 'email', codeSentTo(WANJIRU.email));
    expectProblem(await verify(session, 'email', '123456'), 409, 'wrong-step');
    expect((await read(session)).json<OnboardingSession>().state).toBe('phone-pending');
  });

  it('keeps the email unverified when the phone code cannot be sent: 502 otp-send-failed, nothing changed', async () => {
    const session = await start(WANJIRU);
    const code = codeSentTo(WANJIRU.email);
    const before = await sessionRow(session.id);
    const eventsBefore = await sessionEvents();
    api.otpDelivery.failNext();

    const failed = await verify(session, 'email', code);

    expectProblem(failed, 502, 'otp-send-failed');
    expect(await sessionRow(session.id)).toEqual(before);
    expect(await otpRows(session.id)).toMatchObject([{ channel: 'email', verifiedAt: null }]);
    expect(await sessionEvents()).toEqual(eventsBefore);

    // The same code still works once sending does.
    const retried = await verify(session, 'email', code);
    expect(retried.statusCode, retried.body).toBe(200);
    expect(retried.json<OnboardingSession>().state).toBe('phone-pending');
  });

  it('rejects a malformed code or channel with 400 before touching the session', async () => {
    const session = await start(WANJIRU);

    for (const response of [
      await verify(session, 'email', '12345'),
      await verify(session, 'email', 'abcdef'),
      await verify(session, 'fax', '123456'),
      await resend(session, 'fax'),
    ]) {
      expect(response.statusCode, response.body).toBe(400);
      expect(response.json()).not.toHaveProperty('code');
    }
    expect((await otpRows(session.id))[0]?.attempts).toBe(0);
  });
});

describe('S8 resend', () => {
  it('refuses within 60 seconds, then sends a new code that replaces the old one', async () => {
    const session = await start(WANJIRU);
    const first = codeSentTo(WANJIRU.email);

    api.clock.advance(59 * SECOND);
    expectProblem(await resend(session, 'email'), 429, 'resend-cooldown', { retryAfterSeconds: 1 });
    expect(api.otpDelivery.sent()).toHaveLength(1);

    api.clock.advance(SECOND);
    const response = await resend(session, 'email');
    expect(response.statusCode, response.body).toBe(202);
    expect(response.body).toBe('');
    expect(api.otpDelivery.sent(WANJIRU.email)).toHaveLength(2);
    const second = codeSentTo(WANJIRU.email);

    expect((await read(session)).json<OnboardingSession>().otp).toEqual({
      channel: 'email',
      resendAvailableAt: '2026-10-01T09:02:00.000Z',
      resendsLeft: 2,
      attemptsLeft: 5,
    });
    if (second !== first) {
      expectProblem(await verify(session, 'email', first), 400, 'otp-invalid', {
        attemptsLeft: 4,
      });
    }
    expect((await verify(session, 'email', second)).statusCode).toBe(200);
  });

  it('allows three resends per channel; the fourth ends the session with outcome rate-limited', async () => {
    const session = await start(WANJIRU);

    for (let resent = 1; resent <= 3; resent += 1) {
      api.clock.advance(MINUTE);
      expect((await resend(session, 'email')).statusCode).toBe(202);
    }
    expect((await read(session)).json<OnboardingSession>().otp.resendsLeft).toBe(0);
    expect(api.otpDelivery.sent()).toHaveLength(4);

    api.clock.advance(MINUTE);
    expectProblem(await resend(session, 'email'), 410, 'session-expired');

    expect(await failuresOf('tsc')).toBe(1);
    expect(await identifyAttemptsLeft()).toBe(3);
    expect(api.otpDelivery.sent()).toHaveLength(4);
    expect(await sessionRow(session.id)).toMatchObject({
      state: 'expired',
      endReason: 'rate-limited',
    });
    expect((await sessionEvents()).at(-1)).toEqual({
      type: 'onboarding.session.ended.v1',
      tenant: 'tsc',
      data: { sessionId: session.id, outcome: 'rate-limited' },
    });
  });

  it('counts resends per channel: the phone starts with all three', async () => {
    const session = await start(WANJIRU);
    for (let resent = 1; resent <= 3; resent += 1) {
      api.clock.advance(MINUTE);
      await resend(session, 'email');
    }
    await verify(session, 'email', codeSentTo(WANJIRU.email));

    expect((await read(session)).json<OnboardingSession>().otp).toMatchObject({
      channel: 'phone',
      resendsLeft: 3,
    });
    api.clock.advance(MINUTE);
    expect((await resend(session, 'phone')).statusCode).toBe(202);
    expect(api.otpDelivery.sent(WANJIRU.phone)).toHaveLength(2);
  });

  it('sends the code outside its transaction: the session stays readable meanwhile', async () => {
    const session = await start(WANJIRU);
    api.clock.advance(MINUTE);
    const release = api.otpDelivery.holdNext();

    const resending = resend(session, 'email');
    await expect.poll(() => api.otpDelivery.holding).toBe(true);
    const during = await read(session);
    release();

    expect(during.statusCode).toBe(200);
    expect(during.json<OnboardingSession>().otp.resendsLeft).toBe(3);

    expect((await resending).statusCode).toBe(202);
    expect((await read(session)).json<OnboardingSession>().otp.resendsLeft).toBe(2);
  });

  it('changes nothing when the new code cannot be sent: no resend used, no cooldown started', async () => {
    const session = await start(WANJIRU);
    const first = codeSentTo(WANJIRU.email);
    api.clock.advance(MINUTE);
    api.otpDelivery.failNext();

    expectProblem(await resend(session, 'email'), 502, 'otp-send-failed');

    expect((await read(session)).json<OnboardingSession>().otp).toEqual({
      channel: 'email',
      resendAvailableAt: '2026-10-01T09:01:00.000Z',
      resendsLeft: 3,
      attemptsLeft: 5,
    });
    expect(await otpRows(session.id)).toMatchObject([{ resends: 0, lastSentAt: NOW }]);
    // A retry goes straight through, and the code before it still works until then.
    expect(api.otpDelivery.sent()).toHaveLength(1);
    expect((await resend(session, 'email')).statusCode).toBe(202);
    expect(codeSentTo(WANJIRU.email)).toMatch(/^[0-9]{6}$/);
    expect(api.otpDelivery.sent()).toHaveLength(2);
    expect(first).toMatch(/^[0-9]{6}$/);
  });
});

describe('S9 contacts the roster lacks', () => {
  it('asks for a phone after the email, sends the code to it in E.164, and writes it back once verified', async () => {
    const session = await start(KIPRONO);

    const afterEmail = await verify(session, 'email', codeSentTo(KIPRONO.email));
    expect(afterEmail.statusCode, afterEmail.body).toBe(200);
    expect(afterEmail.json<OnboardingSession>()).toMatchObject({
      state: 'phone-contact-required',
      contacts: { phone: null },
      otp: { channel: null },
    });

    const provided = await provide(session, 'phone', ' 0722 000 456 ');
    expect(provided.statusCode, provided.body).toBe(200);
    const view = provided.json<OnboardingSession>();
    expect(contractErrors(okResponse(CONTACTS_PATH, 'post'), view)).toEqual([]);
    expect(view).toMatchObject({
      state: 'phone-pending',
      contacts: { phone: { masked: '07** *** 456', source: 'declarant', verified: false } },
      otp: { channel: 'phone', resendsLeft: 3, attemptsLeft: 5 },
    });
    expect(api.otpDelivery.last()).toMatchObject({
      channel: 'phone',
      to: '+254722000456',
      commissionName: COMMISSION,
    });
    // Not on the roster until verified.
    expect(await record(KIPRONO.personnelFileNumber)).toMatchObject({ phone: null });

    const verified = await verify(session, 'phone', codeSentTo('+254722000456'));
    expect(verified.statusCode, verified.body).toBe(200);
    expect(verified.json<OnboardingSession>()).toMatchObject({
      state: 'phone-verified',
      contacts: { phone: { source: 'declarant', verified: true } },
    });
    expect(await record(KIPRONO.personnelFileNumber)).toEqual({
      email: KIPRONO.email,
      emailSource: 'roster',
      phone: '+254722000456',
      phoneSource: 'declarant',
    });
  });

  it('takes an email when the roster has none, lower-cased, and writes it back once verified', async () => {
    const { created, ...session } = await start(ATIENO);
    expect(created).toMatchObject({ state: 'email-contact-required', contacts: { email: null } });

    const provided = await provide(session, 'email', '  Atieno.Odera@Example.COM ');
    expect(provided.statusCode, provided.body).toBe(200);
    expect(provided.json<OnboardingSession>()).toMatchObject({
      state: 'email-pending',
      contacts: { email: { masked: 'a***@example.com', source: 'declarant', verified: false } },
    });
    expect(api.otpDelivery.last()).toMatchObject({
      channel: 'email',
      to: 'atieno.odera@example.com',
    });

    await verify(session, 'email', codeSentTo('atieno.odera@example.com'));

    expect(await record(ATIENO.personnelFileNumber)).toMatchObject({
      email: 'atieno.odera@example.com',
      emailSource: 'declarant',
      phone: null,
    });
    expect((await read(session)).json<OnboardingSession>().state).toBe('phone-contact-required');
  });

  it('rejects an invalid contact with 400 and a contact for the other channel with 409', async () => {
    const session = await start(ATIENO);

    for (const [channel, value] of [
      ['email', 'not-an-email'],
      ['email', `${'a'.repeat(250)}@x.ke`],
      ['phone', '12'],
      ['sms', 'someone@example.com'],
    ] as const) {
      const response = await provide(session, channel, value);
      expect(response.statusCode, `${channel} ${value}`).toBe(400);
    }
    const invalid = await provide(session, 'email', 'not-an-email');
    expect(invalid.json<{ errors: { path: string }[] }>().errors).toEqual([
      expect.objectContaining({ path: 'value' }),
    ]);
    expectProblem(await provide(session, 'phone', '+254722000456'), 409, 'wrong-step');
    expect((await read(session)).json<OnboardingSession>()).toMatchObject({
      state: 'email-contact-required',
      contacts: { email: null, phone: null },
    });
  });

  it('keeps no contact when its code cannot be sent: 502 otp-send-failed, still asking for it', async () => {
    const session = await start(ATIENO);
    api.otpDelivery.failNext();

    expectProblem(await provide(session, 'email', 'atieno@example.com'), 502, 'otp-send-failed');

    expect(await sessionRow(session.id)).toMatchObject({
      state: 'email-contact-required',
      email: null,
      emailSource: null,
    });
    expect(await otpRows(session.id)).toEqual([]);
  });

  it('leaves a roster contact added meanwhile in place of the declarant one', async () => {
    const { id, secret } = await givenSession(api, {
      recordId: ids.get(WANJIRU.personnelFileNumber) ?? '',
      state: 'phone-pending',
      email: WANJIRU.email,
      emailVerified: true,
      phone: '+254722000789',
      phoneSource: 'declarant',
      otp: { channel: 'phone', code: '424242' },
    });

    const response = await verify({ id, secret }, 'phone', '424242');

    expect(response.statusCode, response.body).toBe(200);
    expect(await record(WANJIRU.personnelFileNumber)).toMatchObject({
      phone: WANJIRU.phone,
      phoneSource: 'roster',
    });
  });
});
