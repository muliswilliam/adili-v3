import createClient from 'openapi-fetch';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  expireMockSession,
  mockDirectoryFetch,
  resetOnboardingMock,
} from './directory/mock.server';
import type { paths } from './directory/schema.gen';
import {
  identify,
  listCommissions,
  lookupSession,
  provideContact,
  resendCode,
  verifyCode,
} from './onboarding.server';

function client(send: (request: Request) => Promise<Response> = mockDirectoryFetch) {
  return createClient<paths>({
    baseUrl: 'http://directory.test',
    headers: { 'x-forwarded-for': '203.0.113.7' },
    fetch: send,
  });
}

const teacher = { commission: 'tsc', personnelFileNumber: 'TSC/100200', nationalId: '1234 5678' };

beforeEach(() => {
  resetOnboardingMock();
});

describe('identify', () => {
  it('opens a session and returns only the next route to the browser', async () => {
    const { result, created } = await identify(client(), teacher);

    expect(result).toEqual({ ok: true, route: '/get-started/verify-email' });
    expect(created?.secret).toBeTruthy();
    // The browser never receives the session secret.
    expect(JSON.stringify(result)).not.toContain(created?.secret);
  });

  it('reports no-match without a session', async () => {
    const { result, created } = await identify(client(), { ...teacher, nationalId: '99999999' });

    expect(result).toEqual({ ok: false, code: 'no-match' });
    expect(created).toBeUndefined();
  });

  it('reports a Commission without a roster', async () => {
    const { result } = await identify(client(), { ...teacher, commission: 'jsc' });

    expect(result).toMatchObject({ ok: false, code: 'no-roster' });
  });

  it('passes on the sign-in links for someone already onboarded', async () => {
    const { result } = await identify(client(), {
      commission: 'tsc',
      personnelFileNumber: 'TSC/999999',
      nationalId: '11111111',
    });

    expect(result).toMatchObject({
      ok: false,
      code: 'already-onboarded',
      links: { signIn: '/auth/login' },
    });
  });

  it('reports the wait once rate-limited', async () => {
    const miss = { ...teacher, nationalId: '99999999' };
    for (let attempt = 0; attempt < 5; attempt += 1) await identify(client(), miss);

    const { result } = await identify(client(), teacher);

    expect(result).toMatchObject({ ok: false, code: 'rate-limited' });
    expect(result.ok ? 0 : result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('rejects invalid input before calling the directory', async () => {
    let called = false;
    const { result } = await identify(
      client(() => {
        called = true;
        return Promise.resolve(new Response(null, { status: 500 }));
      }),
      { ...teacher, nationalId: '12' },
    );

    expect(result).toEqual({ ok: false, code: 'invalid' });
    expect(called).toBe(false);
  });

  it('treats server errors and outages as unavailable', async () => {
    const failing = client(() => Promise.resolve(new Response('oops', { status: 502 })));
    const unreachable = client(() => Promise.reject(new Error('ECONNREFUSED')));

    expect((await identify(failing, teacher)).result).toEqual({ ok: false, code: 'unavailable' });
    expect((await identify(unreachable, teacher)).result).toEqual({
      ok: false,
      code: 'unavailable',
    });
  });
});

describe('lookupSession', () => {
  async function openSession() {
    const { created } = await identify(client(), teacher);
    if (!created) throw new Error('no session');
    return created;
  }

  it('returns the live session for the right secret', async () => {
    const created = await openSession();

    const lookup = await lookupSession(client(), created);

    expect(lookup.status).toBe('active');
    expect(lookup.status === 'active' ? lookup.session.state : null).toBe('email-pending');
  });

  it('treats a wrong secret or an expired session as ended', async () => {
    const created = await openSession();

    expect(await lookupSession(client(), { ...created, secret: 'guess' })).toEqual({
      status: 'ended',
    });
    expireMockSession(created.sessionId);
    expect(await lookupSession(client(), created)).toEqual({ status: 'ended' });
  });
});

describe('listCommissions', () => {
  it('returns the Commissions, or null when the directory is unreachable', async () => {
    expect((await listCommissions(client()))?.map((entry) => entry.slug)).toContain('tsc');
    expect(await listCommissions(client(() => Promise.reject(new Error('down'))))).toBeNull();
  });
});

describe('verification steps', () => {
  const noContacts = {
    commission: 'psc',
    personnelFileNumber: 'PSC/300400',
    nationalId: '23456789',
  };

  async function openSession(details = teacher) {
    const { created } = await identify(client(), details);
    if (!created) throw new Error('no session');
    return created;
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  // S7
  it('moves on to the phone, masked, once the email code is right', async () => {
    const session = await openSession();

    const result = await verifyCode(client(), session, { channel: 'email', code: '123456' });

    expect(result).toMatchObject({
      ok: true,
      session: { state: 'phone-pending', contacts: { phone: { masked: '07** *** 123' } } },
    });
    expect(JSON.stringify(result)).not.toContain(session.secret);
  });

  it('counts down the attempts on a wrong code and ends the session after five', async () => {
    const session = await openSession();
    const wrong = { channel: 'email', code: '999999' } as const;

    expect(await verifyCode(client(), session, wrong)).toEqual({
      ok: false,
      code: 'otp-invalid',
      attemptsLeft: 4,
    });
    for (let attempt = 0; attempt < 3; attempt += 1) await verifyCode(client(), session, wrong);

    expect(await verifyCode(client(), session, wrong)).toEqual({ ok: false, code: 'ended' });
    expect(await lookupSession(client(), session)).toEqual({ status: 'ended' });
  });

  it('reports an expired code', async () => {
    const session = await openSession();

    expect(await verifyCode(client(), session, { channel: 'email', code: '000000' })).toEqual({
      ok: false,
      code: 'otp-expired',
    });
  });

  it('reports a code for the wrong channel as a session that has moved', async () => {
    const session = await openSession();

    expect(await verifyCode(client(), session, { channel: 'phone', code: '123456' })).toEqual({
      ok: false,
      code: 'moved',
    });
  });

  // S8
  it('holds a resend for 60 seconds, then sends a new code, and ends on the fourth', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const session = await openSession();

    expect(await resendCode(client(), session, { channel: 'email' })).toEqual({
      ok: false,
      code: 'resend-cooldown',
      retryAfterSeconds: 60,
    });

    for (const left of [2, 1, 0]) {
      vi.advanceTimersByTime(60_000);
      expect(await resendCode(client(), session, { channel: 'email' })).toMatchObject({
        ok: true,
        session: { otp: { resendsLeft: left, attemptsLeft: 5 } },
      });
    }

    vi.advanceTimersByTime(60_000);
    expect(await resendCode(client(), session, { channel: 'email' })).toEqual({
      ok: false,
      code: 'ended',
    });
  });

  // S9
  it('takes a contact the record lacks, in E.164, and sends the code there', async () => {
    const session = await openSession(noContacts);

    const result = await provideContact(client(), session, {
      channel: 'email',
      value: 'kiprono@devolution.go.ke',
    });
    expect(result).toMatchObject({
      ok: true,
      session: {
        state: 'email-pending',
        contacts: { email: { masked: 'k***@devolution.go.ke', source: 'declarant' } },
      },
    });

    const verified = await verifyCode(client(), session, { channel: 'email', code: '123456' });
    expect(verified).toMatchObject({ ok: true, session: { state: 'phone-contact-required' } });

    const phone = await provideContact(client(), session, {
      channel: 'phone',
      value: '0712 345 678',
    });
    expect(phone).toMatchObject({
      ok: true,
      session: { state: 'phone-pending', contacts: { phone: { masked: '07** *** 678' } } },
    });
  });

  it('rejects a contact it cannot use before calling the directory', async () => {
    let called = false;
    const result = await provideContact(
      client(() => {
        called = true;
        return Promise.resolve(new Response(null, { status: 500 }));
      }),
      { sessionId: 'id', secret: 'secret' },
      { channel: 'phone', value: '12345' },
    );

    expect(result).toEqual({ ok: false, code: 'invalid' });
    expect(called).toBe(false);
  });

  // S10
  it('treats a wrong secret or an expired session as ended on every step', async () => {
    const session = await openSession();
    const guess = { ...session, secret: 'guess' };

    expect(await verifyCode(client(), guess, { channel: 'email', code: '123456' })).toEqual({
      ok: false,
      code: 'ended',
    });
    expireMockSession(session.sessionId);
    expect(await resendCode(client(), session, { channel: 'email' })).toEqual({
      ok: false,
      code: 'ended',
    });
  });

  it('treats outages as unavailable', async () => {
    const down = client(() => Promise.reject(new Error('ECONNREFUSED')));
    const session = { sessionId: 'id', secret: 'secret' };

    expect(await verifyCode(down, session, { channel: 'email', code: '123456' })).toEqual({
      ok: false,
      code: 'unavailable',
    });
    expect(await resendCode(down, session, { channel: 'email' })).toEqual({
      ok: false,
      code: 'unavailable',
    });
  });
});
