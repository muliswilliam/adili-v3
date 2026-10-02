import createClient from 'openapi-fetch';
import { beforeEach, describe, expect, it } from 'vitest';

import type { DetailsInput } from '../components/applicant-onboarding/details';
import {
  completeApplicant,
  lookupApplicantSession,
  readApplicantSession,
  resendApplicantCode,
  resendApplicantPasswordEmail,
  startApplicant,
  startApplicantSession,
  verifyApplicantCode,
} from './applicant-onboarding.server';
import {
  endMockApplicantResendCooldown,
  expireMockApplicantSession,
  resetApplicantOnboardingMock,
} from './directory/applicant-onboarding-mock.server';
import { mockDirectoryFetch } from './directory/mock.server';
import type { paths } from './directory/schema.gen';
import {
  APPLICANT_ONBOARDING_COOKIE,
  type CookieJar,
  onboardingCookie,
  type OnboardingCredentials,
} from './onboarding-cookie';
import { runStep } from './onboarding.server';

/**
 * Get started as an applicant's BFF logic against the directory mock, which follows the
 * contract (`/v1/onboarding/applicants/...`), and against hand-made answers for the cases the
 * mock does not produce.
 */

function client(send: (request: Request) => Promise<Response> = mockDirectoryFetch) {
  return createClient<paths>({
    baseUrl: 'http://directory.test',
    headers: { 'x-forwarded-for': '203.0.113.9' },
    fetch: send,
  });
}

function answering(status: number, body: unknown) {
  return client(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/problem+json' },
      }),
    ),
  );
}

const MERCY: DetailsInput = {
  kind: 'national-id',
  surname: 'Kamau',
  firstName: 'Mercy',
  otherNames: 'Wanjiru',
  number: '2884 1276',
  country: '',
  phone: '0722 418 903',
  email: 'mercy@example.com',
};

const AMINA: DetailsInput = {
  kind: 'passport',
  surname: 'Okello',
  firstName: 'Amina',
  otherNames: '',
  number: 'B1234567',
  country: 'UG',
  phone: '+256 772 123 456',
  email: 'amina@example.com',
};

async function started(input: DetailsInput = MERCY): Promise<OnboardingCredentials> {
  const { created } = await startApplicant(client(), input);
  if (!created) throw new Error('no session');
  return created;
}

async function verified(input: DetailsInput = MERCY): Promise<OnboardingCredentials> {
  const credentials = await started(input);
  const result = await verifyApplicantCode(client(), credentials, { code: '123456' });
  if (!result.ok) throw new Error(result.code);
  return credentials;
}

beforeEach(() => {
  resetApplicantOnboardingMock();
});

describe('startApplicant (S1)', () => {
  it('checks a national ID, sends the code and returns only the next route', async () => {
    const { result, created } = await startApplicant(client(), MERCY);

    expect(result).toEqual({ ok: true, route: '/access/get-started/verify-phone' });
    expect(created?.secret).toBeTruthy();
    expect(JSON.stringify(result)).not.toContain(created?.secret);
    const lookup = await lookupApplicantSession(client(), created as OnboardingCredentials);
    expect(lookup).toMatchObject({
      status: 'active',
      session: {
        state: 'phone-pending',
        fullName: 'Mercy Wanjiru Kamau',
        identityDocument: { kind: 'national-id', number: '28841276', country: null },
        identityStatus: 'verified',
        contacts: { phone: { masked: '07** *** 903', verified: false } },
      },
    });
  });

  it('starts a passport holder whose account will be pending verification', async () => {
    const credentials = await started(AMINA);

    expect(await lookupApplicantSession(client(), credentials)).toMatchObject({
      session: {
        identityDocument: { kind: 'passport', number: 'B1234567', country: 'UG' },
        identityStatus: 'pending-verification',
      },
    });
  });

  it('maps the directory problems of start', async () => {
    expect((await startApplicant(client(), { ...MERCY, surname: 'Otieno' })).result).toEqual({
      ok: false,
      code: 'identity-mismatch',
    });
    expect((await startApplicant(client(), { ...MERCY, number: '30112233' })).result).toEqual({
      ok: false,
      code: 'already-onboarded',
      links: { signIn: '/auth/login', recoverAccess: '/auth/recover' },
    });
    expect((await startApplicant(client(), { ...MERCY, number: '40404040' })).result).toEqual({
      ok: false,
      code: 'iprs-unavailable',
    });
    expect((await startApplicant(client(), { ...MERCY, number: '70707070' })).result).toEqual({
      ok: false,
      code: 'send-failed',
    });
    expect((await startApplicant(client(), { ...MERCY, number: '80808080' })).result).toEqual({
      ok: false,
      code: 'unavailable',
    });
  });

  it('rate-limits after five starts that open no session, with the wait', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await startApplicant(client(), { ...MERCY, surname: 'Otieno' });
    }
    const { result } = await startApplicant(client(), MERCY);

    expect(result).toMatchObject({ ok: false, code: 'rate-limit-exceeded' });
    expect(result.ok ? 0 : (result as { retryAfterSeconds?: number }).retryAfterSeconds).toBe(900);
  });

  it('turns a 400 into the form fields it names', async () => {
    const { result } = await startApplicant(
      answering(400, {
        type: 'about:blank',
        title: 'Bad request',
        status: 400,
        errors: [
          { path: 'phone', message: 'x' },
          { path: 'identityDocument.number', message: 'x' },
          { path: 'unknown', message: 'x' },
        ],
      }),
      MERCY,
    );

    // In the order the form shows them, so the first one to fix gets focus.
    expect(result).toEqual({ ok: false, code: 'invalid', fields: ['number', 'phone'] });
  });

  it('never calls the directory with a form the browser should have refused', async () => {
    const { result } = await startApplicant(
      client(() => Promise.reject(new Error('must not be called'))),
      { ...MERCY, number: '12', email: 'x' },
    );

    expect(result).toEqual({ ok: false, code: 'invalid', fields: ['number', 'email'] });
  });

  it('reads a directory that does not answer as unavailable', async () => {
    const { result } = await startApplicant(
      client(() => Promise.reject(new Error('down'))),
      MERCY,
    );

    expect(result).toEqual({ ok: false, code: 'unavailable' });
  });
});

describe('the phone code', () => {
  it('verifies the right code and moves the session to create', async () => {
    const credentials = await started();

    const result = await verifyApplicantCode(client(), credentials, { code: '123456' });

    expect(result).toMatchObject({
      ok: true,
      session: { state: 'phone-verified', contacts: { phone: { verified: true } } },
    });
  });

  it('counts wrong codes down, says when one has expired and ends after the fifth', async () => {
    const credentials = await started();

    expect(await verifyApplicantCode(client(), credentials, { code: '111111' })).toEqual({
      ok: false,
      code: 'otp-invalid',
      attemptsLeft: 4,
    });
    expect(await verifyApplicantCode(client(), credentials, { code: '000000' })).toEqual({
      ok: false,
      code: 'otp-expired',
    });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await verifyApplicantCode(client(), credentials, { code: '111111' });
    }
    expect(await verifyApplicantCode(client(), credentials, { code: '111111' })).toEqual({
      ok: false,
      code: 'ended',
    });
  });

  it('refuses a resend in its cooldown with the wait, and says when a code cannot be sent', async () => {
    const credentials = await started();
    expect(await resendApplicantCode(client(), credentials)).toMatchObject({
      ok: false,
      code: 'resend-cooldown',
      retryAfterSeconds: expect.any(Number) as unknown,
    });

    const unreachable = await started({ ...MERCY, phone: '0700 000 000' });
    endMockApplicantResendCooldown(unreachable.sessionId);
    expect(await resendApplicantCode(client(), unreachable)).toEqual({
      ok: false,
      code: 'send-failed',
    });
  });

  it('reads a wrong-step 409 as moved, so the page follows the session', async () => {
    const credentials = await verified();

    expect(await verifyApplicantCode(client(), credentials, { code: '123456' })).toEqual({
      ok: false,
      code: 'moved',
    });
  });
});

describe('complete', () => {
  it('creates the account; a retry with the same key gets the same answer', async () => {
    const credentials = await verified();

    const first = await completeApplicant(client(), credentials, 'key-1');
    const replay = await completeApplicant(client(), credentials, 'key-1');

    expect(first).toMatchObject({
      ok: true,
      session: { state: 'confirmed', outcome: 'account-created', setPasswordEmail: 'sent' },
    });
    expect(replay).toEqual(first);
  });

  it('maps 502 identity-unavailable, then succeeds on retry', async () => {
    const credentials = await verified({ ...MERCY, surname: 'Otieno', number: '50505050' });

    expect(await completeApplicant(client(), credentials, 'key-1')).toEqual({
      ok: false,
      code: 'identity-unavailable',
    });
    expect(await completeApplicant(client(), credentials, 'key-2')).toMatchObject({ ok: true });
  });

  it('maps 409 email-in-use and already-onboarded', async () => {
    const taken = await verified({ ...MERCY, email: 'taken@example.com' });
    expect(await completeApplicant(client(), taken, 'key-1')).toEqual({
      ok: false,
      code: 'email-in-use',
    });

    // Two sessions for one passport: the second to complete finds the account there.
    const first = await verified(AMINA);
    const second = await verified(AMINA);
    expect(await completeApplicant(client(), first, 'key-a')).toMatchObject({ ok: true });
    expect(await completeApplicant(client(), second, 'key-b')).toEqual({
      ok: false,
      code: 'already-onboarded',
    });
  });

  it('reports a set-password email that could not be sent; resending it works', async () => {
    const credentials = await verified({ ...MERCY, surname: 'Achieng', number: '60606060' });

    expect(await completeApplicant(client(), credentials, 'key-1')).toMatchObject({
      ok: true,
      session: { setPasswordEmail: 'failed' },
    });
    expect(await resendApplicantPasswordEmail(client(), credentials, 'key-2')).toMatchObject({
      ok: true,
      session: {
        setPasswordEmail: 'sent',
        otp: { resendAvailableAt: expect.any(String) as unknown },
      },
    });
  });
});

describe('the applicant cookie', () => {
  function fakeJar() {
    const values = new Map<string, string>();
    const jar: CookieJar = {
      get: (name) => values.get(name),
      set: (name, value) => {
        values.set(name, value);
      },
      delete: (name) => {
        values.delete(name);
      },
    };
    return { jar, values };
  }

  it('holds the session under its own name, never the declarant onboarding cookie', async () => {
    const { jar, values } = fakeJar();
    const cookie = onboardingCookie(jar, { secure: false, name: APPLICANT_ONBOARDING_COOKIE });

    await startApplicantSession(client(), cookie, MERCY);

    expect([...values.keys()]).toEqual([APPLICANT_ONBOARDING_COOKIE]);
    expect(await readApplicantSession(client(), cookie)).toMatchObject({ status: 'active' });
  });

  it('is cleared once the session has ended', async () => {
    const { jar, values } = fakeJar();
    const cookie = onboardingCookie(jar, { secure: false, name: APPLICANT_ONBOARDING_COOKIE });
    await startApplicantSession(client(), cookie, MERCY);
    const credentials = cookie.read();
    if (!credentials) throw new Error('no cookie');

    expireMockApplicantSession(credentials.sessionId);

    expect(await readApplicantSession(client(), cookie)).toEqual({ status: 'ended' });
    expect(values.size).toBe(0);
    expect(
      await runStep(cookie, (stored) => verifyApplicantCode(client(), stored, { code: '123456' })),
    ).toEqual({ ok: false, code: 'ended' });
  });
});
