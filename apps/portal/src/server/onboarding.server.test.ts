import createClient from 'openapi-fetch';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  expireMockSession,
  mockDirectoryFetch,
  resetOnboardingMock,
} from './directory/mock.server';
import type { paths } from './directory/schema.gen';
import { identify, listCommissions, lookupSession } from './onboarding.server';

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
