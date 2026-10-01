import { PLATFORM_TENANT } from '@adili/api-kit';
import { withTenant } from '@adili/data-access';
import { asc } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { onboardingSessions, outbox, persons } from '../../src/db/schema.js';
import { EmailTaken, IdentityUnavailable } from '../../src/identity/identity-provisioning.js';
import type {
  ApplicantOnboardingSession,
  ApplicantOnboardingSessionCreated,
} from '../../src/onboarding/applicants/representation.js';
import type { OnboardingSessionCreated } from '../../src/onboarding/representation.js';
import { componentSchema, contractErrors, okResponse } from '../support/contract.js';
import { type DirectoryApi, startDirectoryApi } from '../support/directory-api.js';
import { givenCommissions } from '../support/fixtures.js';
import {
  givenApplicant,
  givenRoster,
  identify,
  onApplicantSession,
  onSession,
  startApplicant,
  type StartApplicantInput,
} from '../support/onboarding.js';

/**
 * Spec 10 S1 over HTTP: applicant onboarding at the directory seam. Start (IPRS for a national
 * ID, none for a passport), the phone's code, complete (person and account with role
 * `applicant`), the set-password email, rate limits, with the in-memory IPRS lookup, identity
 * adapter and code delivery and the test clock.
 */

const NOW = new Date('2026-10-01T09:00:00Z');
const START = '/v1/onboarding/applicants';
const SESSION = '/v1/onboarding/applicants/{sessionId}';

const NJOKI: StartApplicantInput = {
  identityDocument: { kind: 'national-id', number: '2345 6789' },
  names: { surname: 'Wambua', firstName: 'Njoki', otherNames: 'Wairimu' },
  phone: '0722 123 456',
  email: '  Njoki.Wambua@Example.com ',
};
/** IPRS orders and punctuates differently; the name rule still matches. */
const NJOKI_IPRS = { firstName: 'NJOKI', middleName: 'Wairimu', lastName: 'Wambua' };

const AMINA: StartApplicantInput = {
  identityDocument: { kind: 'passport', number: 'b 1234567', country: 'ug' },
  names: { surname: 'Okello', firstName: 'Amina' },
  phone: '+256772123456',
  email: 'amina.okello@example.com',
};

let api: DirectoryApi;
let nextIp = 1;
const freshIp = () => `198.51.100.${nextIp++}`;

async function outboxEvents() {
  return api.db
    .select({ type: outbox.eventType, envelope: outbox.envelope })
    .from(outbox)
    .orderBy(asc(outbox.id));
}

async function storedPersons() {
  return withTenant(api.db, { tenant: PLATFORM_TENANT, subject: 'test' }, (tx) =>
    tx.select().from(persons),
  );
}

async function storedSessions() {
  return withTenant(api.db, { tenant: PLATFORM_TENANT, subject: 'test' }, (tx) =>
    tx.select().from(onboardingSessions),
  );
}

/** Starts as `input` and verifies the phone's code: the session at the complete step. */
async function phoneVerified(input: StartApplicantInput) {
  const started = await startApplicant(api, input, freshIp());
  expect(started.statusCode, started.body).toBe(201);
  const { id, secret } = started.json<ApplicantOnboardingSessionCreated>();
  const code = api.otpDelivery.last()?.code ?? '';
  const verified = await onApplicantSession(api, 'POST', id, '/otp/verify', secret, { code });
  expect(verified.statusCode, verified.body).toBe(200);
  return { id, secret };
}

beforeAll(async () => {
  api = await startDirectoryApi();
  return () => api.close();
});

beforeEach(async () => {
  await api.reset();
  api.clock.set(NOW);
  api.iprs.givenPerson('23456789', NJOKI_IPRS);
});

describe('S1 start with a national ID', () => {
  it('checks IPRS, starts a session in phone-pending with the code sent and the secret once', async () => {
    const response = await startApplicant(api, NJOKI, freshIp());

    expect(response.statusCode, response.body).toBe(201);
    const created = response.json<ApplicantOnboardingSessionCreated>();
    expect(contractErrors(okResponse(START, 'post', 201), created)).toEqual([]);
    expect(created).toEqual({
      id: expect.any(String) as unknown,
      secret: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) as unknown,
      state: 'phone-pending',
      // What was entered, normalised, so the applicant can check it before complete.
      fullName: 'Njoki Wairimu Wambua',
      identityDocument: { kind: 'national-id', number: '23456789', country: null },
      identityStatus: 'verified',
      contacts: {
        phone: { masked: '07** *** 456', verified: false },
        email: { masked: 'n***@example.com' },
      },
      otp: {
        channel: 'phone',
        resendAvailableAt: '2026-10-01T09:01:00.000Z',
        resendsLeft: 3,
        attemptsLeft: 5,
      },
      outcome: null,
      setPasswordEmail: null,
      expiresAt: '2026-10-01T09:30:00.000Z',
    });
    expect(api.iprs.calls()).toEqual(['23456789']);
    // One code, by SMS, naming no Commission, for no tenant.
    expect(api.otpDelivery.sent()).toEqual([
      {
        channel: 'phone',
        to: '+254722123456',
        code: expect.stringMatching(/^\d{6}$/) as unknown,
        expiresInMinutes: 10,
      },
    ]);

    const read = await onApplicantSession(api, 'GET', created.id, '', created.secret);
    expect(read.statusCode, read.body).toBe(200);
    const { secret, ...session } = created;
    expect(read.json<ApplicantOnboardingSession>()).toEqual(session);
    expect(read.body).not.toContain(secret);

    const [stored] = await storedSessions();
    expect(stored).toMatchObject({
      kind: 'applicant',
      tenant: null,
      rosterRecordId: null,
      documentKind: 'national-id',
      documentNumber: '23456789',
      documentCountry: null,
      surname: 'Wambua',
      firstName: 'Njoki',
      otherNames: 'Wairimu',
      email: 'njoki.wambua@example.com',
      emailSource: 'applicant',
      phone: '+254722123456',
      phoneSource: 'applicant',
      iprsOutcome: 'match',
    });
  });

  it('records the start and the first step, with no tenant and no identifiers', async () => {
    const response = await startApplicant(api, NJOKI, freshIp());
    const { id, secret } = response.json<ApplicantOnboardingSessionCreated>();

    const events = await outboxEvents();
    expect(events.map(({ type }) => type)).toEqual([
      'onboarding.session.started.v1',
      'onboarding.session.advanced.v1',
    ]);
    expect(events.map(({ envelope }) => envelope.data)).toEqual([
      { sessionId: id, kind: 'applicant' },
      { sessionId: id, from: 'identified', state: 'phone-pending' },
    ]);
    expect(events.every(({ envelope }) => envelope.tenant === undefined)).toBe(true);
    const serialised = JSON.stringify(events);
    for (const identifier of ['23456789', 'Wambua', 'njoki.wambua', '722123456', secret]) {
      expect(serialised).not.toContain(identifier);
    }
  });

  it('answers 409 identity-mismatch when IPRS disagrees with the names, or has no such person, storing nothing', async () => {
    const wrongNames = await startApplicant(
      api,
      { ...NJOKI, names: { surname: 'Kamau', firstName: 'Njoki' } },
      freshIp(),
    );
    const unknown = await startApplicant(
      api,
      { ...NJOKI, identityDocument: { kind: 'national-id', number: '99999999' } },
      freshIp(),
    );

    for (const response of [wrongNames, unknown]) {
      expect(response.statusCode, response.body).toBe(409);
      expect(response.json()).toMatchObject({ code: 'identity-mismatch', status: 409 });
      expect(
        contractErrors(componentSchema('ApplicantOnboardingProblem'), response.json()),
      ).toEqual([]);
    }
    expect(api.otpDelivery.sent()).toEqual([]);
    expect(await storedSessions()).toEqual([]);
    expect(await outboxEvents()).toEqual([]);
  });

  it('answers 503 iprs-unavailable when IPRS cannot be asked, storing nothing', async () => {
    api.iprs.failNext();

    const response = await startApplicant(api, NJOKI, freshIp());

    expect(response.statusCode, response.body).toBe(503);
    expect(response.json()).toMatchObject({ code: 'iprs-unavailable' });
    expect(await storedSessions()).toEqual([]);
  });

  it('answers 409 already-onboarded, with links, for a national ID an applicant onboarded with', async () => {
    await givenApplicant(api, { kind: 'national-id', number: '23456789' });

    const response = await startApplicant(api, NJOKI, freshIp());

    expect(response.statusCode, response.body).toBe(409);
    expect(response.json()).toMatchObject({
      code: 'already-onboarded',
      links: {
        signIn: 'http://localhost:3010/auth/login',
        recoverAccess: 'http://localhost:3010/auth/recover',
      },
    });
    expect(api.otpDelivery.sent()).toEqual([]);
  });

  it('answers 502 and keeps no session when the code cannot be sent', async () => {
    api.otpDelivery.failNext();

    const response = await startApplicant(api, NJOKI, freshIp());

    expect(response.statusCode, response.body).toBe(502);
    expect(response.json()).toMatchObject({ code: 'otp-send-failed' });
    expect(await storedSessions()).toEqual([]);
    expect(await outboxEvents()).toEqual([]);
  });

  it('rejects malformed input with 400 before asking IPRS', async () => {
    const bodies: unknown[] = [
      { ...NJOKI, identityDocument: { kind: 'national-id', number: '1234' } },
      { ...NJOKI, identityDocument: { kind: 'national-id', number: '23456789', country: 'KE' } },
      { ...AMINA, identityDocument: { kind: 'passport', number: 'B1234567' } },
      { ...AMINA, identityDocument: { kind: 'passport', number: 'B1-23', country: 'UG' } },
      { ...NJOKI, phone: '12' },
      { ...NJOKI, email: 'not-an-email' },
      { ...NJOKI, email: undefined },
      { ...NJOKI, names: { surname: '', firstName: 'Njoki' } },
      { ...NJOKI, names: { surname: 'Wambua', firstName: '<script>' } },
    ];
    const responses = await Promise.all(
      bodies.map((body) => api.anonymous({ method: 'POST', url: START, body, ip: freshIp() })),
    );

    expect(responses.map((response) => response.statusCode)).toEqual(bodies.map(() => 400));
    expect(api.iprs.calls()).toEqual([]);
  });
});

describe('S1 start with a passport', () => {
  it('asks no IPRS and starts a session whose account will be pending verification', async () => {
    const response = await startApplicant(api, AMINA, freshIp());

    expect(response.statusCode, response.body).toBe(201);
    expect(response.json()).toMatchObject({
      state: 'phone-pending',
      fullName: 'Amina Okello',
      identityDocument: { kind: 'passport', number: 'B1234567', country: 'UG' },
      identityStatus: 'pending-verification',
      contacts: { phone: { masked: expect.stringContaining('456') as unknown, verified: false } },
    });
    expect(api.iprs.calls()).toEqual([]);
    expect(api.otpDelivery.last()?.to).toBe('+256772123456');
    const [stored] = await storedSessions();
    expect(stored).toMatchObject({
      documentKind: 'passport',
      documentNumber: 'B1234567',
      documentCountry: 'UG',
      iprsOutcome: null,
    });
  });

  it('answers 409 already-onboarded for a passport an applicant onboarded with', async () => {
    await givenApplicant(api, { kind: 'passport', number: 'B1234567', country: 'UG' });

    const response = await startApplicant(api, AMINA, freshIp());

    expect(response.statusCode, response.body).toBe(409);
    expect(response.json()).toMatchObject({ code: 'already-onboarded' });
  });

  it('starts for the same number issued by another country', async () => {
    await givenApplicant(api, { kind: 'passport', number: 'B1234567', country: 'TZ' });

    const response = await startApplicant(api, AMINA, freshIp());

    expect(response.statusCode, response.body).toBe(201);
  });
});

describe('S1 phone code', () => {
  it('verifies the phone and moves to the complete step', async () => {
    const started = await startApplicant(api, NJOKI, freshIp());
    const { id, secret } = started.json<ApplicantOnboardingSessionCreated>();
    const code = api.otpDelivery.last()?.code ?? '';

    const response = await onApplicantSession(api, 'POST', id, '/otp/verify', secret, { code });

    expect(response.statusCode, response.body).toBe(200);
    const session = response.json<ApplicantOnboardingSession>();
    expect(contractErrors(okResponse(`${SESSION}/otp/verify`, 'post'), session)).toEqual([]);
    expect(session).toMatchObject({
      state: 'phone-verified',
      contacts: { phone: { verified: true } },
      otp: { channel: null },
      expiresAt: '2026-10-01T09:40:00.000Z',
    });
  });

  it('counts a wrong code and sends a new one on resend', async () => {
    const started = await startApplicant(api, AMINA, freshIp());
    const { id, secret } = started.json<ApplicantOnboardingSessionCreated>();

    const wrong = await onApplicantSession(api, 'POST', id, '/otp/verify', secret, {
      code: '000000',
    });
    expect(wrong.statusCode, wrong.body).toBe(400);
    expect(wrong.json()).toMatchObject({ code: 'otp-invalid', attemptsLeft: 4 });

    const early = await onApplicantSession(api, 'POST', id, '/otp/resend', secret);
    expect(early.statusCode, early.body).toBe(429);
    expect(early.json()).toMatchObject({ code: 'resend-cooldown' });

    api.clock.advance(60_000);
    const resent = await onApplicantSession(api, 'POST', id, '/otp/resend', secret);
    expect(resent.statusCode, resent.body).toBe(202);
    expect(api.otpDelivery.sent()).toHaveLength(2);
    const read = await onApplicantSession(api, 'GET', id, '', secret);
    expect(read.json()).toMatchObject({ otp: { resendsLeft: 2, attemptsLeft: 5 } });
  });

  it('ends the session after five wrong codes', async () => {
    const started = await startApplicant(api, AMINA, freshIp());
    const { id, secret } = started.json<ApplicantOnboardingSessionCreated>();

    const statuses = [];
    for (let attempt = 0; attempt < 5; attempt++) {
      const response = await onApplicantSession(api, 'POST', id, '/otp/verify', secret, {
        code: '000000',
      });
      statuses.push(response.statusCode);
    }

    expect(statuses).toEqual([400, 400, 400, 400, 410]);
    const [stored] = await storedSessions();
    expect(stored).toMatchObject({ state: 'expired', endReason: 'rate-limited' });
  });
});

describe('S1 complete', () => {
  it('creates the person and an applicant account, verified for a national ID, and sends the set-password email', async () => {
    const { id, secret } = await phoneVerified(NJOKI);

    const response = await onApplicantSession(api, 'POST', id, '/complete', secret);

    expect(response.statusCode, response.body).toBe(200);
    const session = response.json<ApplicantOnboardingSession>();
    expect(contractErrors(okResponse(`${SESSION}/complete`, 'post'), session)).toEqual([]);
    expect(session).toMatchObject({
      state: 'confirmed',
      outcome: 'account-created',
      identityStatus: 'verified',
      setPasswordEmail: 'sent',
      expiresAt: '2026-10-02T09:00:00.000Z',
    });

    const [person] = await storedPersons();
    expect(person).toMatchObject({
      kind: 'applicant',
      nationalId: '23456789',
      passportNumber: null,
      ofr: null,
      fullName: 'Njoki Wairimu Wambua',
      identityStatus: 'verified',
      identityVerifiedAt: NOW,
      identityVerifiedBy: null,
      email: 'njoki.wambua@example.com',
      phone: '+254722123456',
    });
    const [created] = api.identity.calls('createApplicantUser');
    expect(created?.input).toEqual({
      email: 'njoki.wambua@example.com',
      firstName: 'Njoki Wairimu',
      lastName: 'Wambua',
      phone: '+254722123456',
      personId: person?.id,
      identityStatus: 'verified',
    });
    const user = api.identity.userByEmail('njoki.wambua@example.com');
    expect(user).toMatchObject({
      userId: person?.keycloakUserId,
      roles: ['applicant'],
      tenant: null,
      personId: person?.id,
      identityStatus: 'verified',
    });
    expect(api.identity.calls('sendExecuteActionsEmail')).toEqual([
      {
        operation: 'sendExecuteActionsEmail',
        userId: person?.keycloakUserId,
        options: {
          actions: ['UPDATE_PASSWORD'],
          lifespanSeconds: 24 * 60 * 60,
          redirectUri: 'http://localhost:3010/auth/login',
          clientId: 'portal',
        },
      },
    ]);

    const events = await outboxEvents();
    const onboarded = events.find(({ type }) => type === 'applicant.onboarded.v1');
    expect(onboarded?.envelope).toMatchObject({
      subject: person?.id,
      data: {
        personId: person?.id,
        keycloakUserId: person?.keycloakUserId,
        sessionId: id,
        documentKind: 'national-id',
        identityStatus: 'verified',
      },
    });
    expect(onboarded?.envelope.tenant).toBeUndefined();
    expect(events.map(({ type }) => type)).toContain('onboarding.session.ended.v1');
  });

  it('creates a passport applicant pending verification', async () => {
    const { id, secret } = await phoneVerified(AMINA);

    const response = await onApplicantSession(api, 'POST', id, '/complete', secret);

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ identityStatus: 'pending-verification' });
    const [person] = await storedPersons();
    expect(person).toMatchObject({
      kind: 'applicant',
      nationalId: null,
      passportNumber: 'B1234567',
      passportCountry: 'UG',
      fullName: 'Amina Okello',
      identityStatus: 'pending-verification',
      identityVerifiedAt: null,
    });
    expect(api.identity.userByEmail(AMINA.email)).toMatchObject({
      roles: ['applicant'],
      identityStatus: 'pending-verification',
    });
  });

  it('answers 409 wrong-step before the phone is verified', async () => {
    const started = await startApplicant(api, AMINA, freshIp());
    const { id, secret } = started.json<ApplicantOnboardingSessionCreated>();

    const response = await onApplicantSession(api, 'POST', id, '/complete', secret);

    expect(response.statusCode, response.body).toBe(409);
    expect(response.json()).toMatchObject({ code: 'wrong-step' });
    expect(await storedPersons()).toEqual([]);
  });

  it('answers 409 email-in-use, changing nothing, when the email has an account', async () => {
    const { id, secret } = await phoneVerified(AMINA);
    api.identity.failNext('createApplicantUser', new EmailTaken(AMINA.email));

    const response = await onApplicantSession(api, 'POST', id, '/complete', secret);

    expect(response.statusCode, response.body).toBe(409);
    expect(response.json()).toMatchObject({ code: 'email-in-use' });
    expect(await storedPersons()).toEqual([]);
    expect((await storedSessions())[0]).toMatchObject({ state: 'phone-verified' });
  });

  it('answers 409 already-onboarded when another session completed for the document first', async () => {
    const { id, secret } = await phoneVerified(AMINA);
    await givenApplicant(api, { kind: 'passport', number: 'B1234567', country: 'UG' });

    const response = await onApplicantSession(api, 'POST', id, '/complete', secret);

    expect(response.statusCode, response.body).toBe(409);
    expect(response.json()).toMatchObject({ code: 'already-onboarded' });
    expect(api.identity.calls('createApplicantUser')).toEqual([]);
  });

  it('rolls back and deletes the account when the transaction cannot commit', async () => {
    const { id, secret } = await phoneVerified(AMINA);
    // Another applicant already holds the account's id, so the person insert fails after the
    // account was created.
    await givenApplicant(api, {
      kind: 'national-id',
      number: '11111111',
      keycloakUserId: 'fixed-user',
    });
    const original = api.identity.createApplicantUser.bind(api.identity);
    api.identity.createApplicantUser = async (input) => {
      await original(input);
      return 'fixed-user';
    };

    try {
      const response = await onApplicantSession(api, 'POST', id, '/complete', secret);
      expect(response.statusCode).toBe(500);
    } finally {
      api.identity.createApplicantUser = original;
    }
    expect(api.identity.calls('deleteUser')).toEqual([
      { operation: 'deleteUser', userId: 'fixed-user' },
    ]);
    expect((await storedSessions())[0]).toMatchObject({ state: 'phone-verified' });
  });

  it('answers 502 identity-unavailable, changing nothing, when the account cannot be created', async () => {
    const { id, secret } = await phoneVerified(AMINA);
    api.identity.failNext('createApplicantUser', new IdentityUnavailable('down'));

    const response = await onApplicantSession(api, 'POST', id, '/complete', secret);

    expect(response.statusCode, response.body).toBe(502);
    expect(response.json()).toMatchObject({ code: 'identity-unavailable' });
    expect(await storedPersons()).toEqual([]);
  });

  it('keeps the account when the set-password email fails, and lets it be resent', async () => {
    const { id, secret } = await phoneVerified(AMINA);
    api.identity.failNext('sendExecuteActionsEmail', new IdentityUnavailable('smtp down'));

    const response = await onApplicantSession(api, 'POST', id, '/complete', secret);

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      state: 'confirmed',
      setPasswordEmail: 'failed',
      otp: { resendAvailableAt: null },
    });
    expect(await storedPersons()).toHaveLength(1);

    const resent = await onApplicantSession(api, 'POST', id, '/resend-password-email', secret);
    expect(resent.statusCode, resent.body).toBe(202);
    expect(api.identity.calls('sendExecuteActionsEmail')).toHaveLength(2);
    const read = await onApplicantSession(api, 'GET', id, '', secret);
    expect(read.json()).toMatchObject({
      setPasswordEmail: 'sent',
      otp: { resendAvailableAt: '2026-10-01T09:01:00.000Z' },
    });
  });
});

describe('S1 sessions of the other kind', () => {
  it("answers 404 for a declarant's session on applicant routes, and an applicant's on declarant routes", async () => {
    await givenCommissions(api.db, [{ slug: 'tsc', name: 'Teachers Service Commission' }]);
    await givenRoster(api, 'tsc', [
      {
        personnelFileNumber: 'TSC/100200',
        fullName: 'Otieno Wanjiru',
        nationalId: '12345678',
        email: 'wanjiru@tsc.go.ke',
        phone: '+254712345123',
      },
    ]);
    const declarant = (
      await identify(
        api,
        { commission: 'tsc', personnelFileNumber: 'TSC/100200', nationalId: '12345678' },
        freshIp(),
      )
    ).json<OnboardingSessionCreated>();
    const applicant = (
      await startApplicant(api, AMINA, freshIp())
    ).json<ApplicantOnboardingSessionCreated>();

    const responses = await Promise.all([
      onApplicantSession(api, 'GET', declarant.id, '', declarant.secret),
      onApplicantSession(api, 'POST', declarant.id, '/complete', declarant.secret),
      onSession(api, 'GET', applicant.id, '', applicant.secret),
      onSession(api, 'POST', applicant.id, '/otp/phone/verify', applicant.secret, {
        code: '123456',
      }),
      onSession(api, 'POST', applicant.id, '/confirm', applicant.secret),
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual([404, 404, 404, 404, 404]);
  });
});

describe('S1 rate limits', () => {
  it("refuses the sixth start from one IP within 15 minutes, sharing identify's budget", async () => {
    const ip = freshIp();
    const attempts = [];
    for (let attempt = 0; attempt < 5; attempt++) {
      attempts.push(
        await startApplicant(
          api,
          { ...NJOKI, identityDocument: { kind: 'national-id', number: `8765432${attempt}` } },
          ip,
        ),
      );
    }
    const sixth = await startApplicant(api, AMINA, ip);
    const identifying = await identify(
      api,
      { commission: 'tsc', personnelFileNumber: 'TSC/1', nationalId: '12345678' },
      ip,
    );

    expect(attempts.map((response) => response.statusCode)).toEqual([409, 409, 409, 409, 409]);
    expect(sixth.statusCode).toBe(429);
    expect(sixth.json()).toMatchObject({ code: 'rate-limit-exceeded', retryAfterSeconds: 900 });
    expect(contractErrors(componentSchema('ApplicantOnboardingProblem'), sixth.json())).toEqual([]);
    expect(identifying.statusCode).toBe(429);
    expect((await startApplicant(api, AMINA, freshIp())).statusCode).toBe(201);
  });
});

describe('S1 expiry', () => {
  it("ends an abandoned applicant's session in the sweep, with no tenant", async () => {
    await startApplicant(api, AMINA, freshIp());
    api.clock.advance(31 * 60_000);

    await api.expirySchedule.trigger();
    await expect
      .poll(async () => (await storedSessions())[0]?.state, { timeout: 20_000, interval: 250 })
      .toBe('expired');
    const ended = (await outboxEvents()).find(({ type }) => type === 'onboarding.session.ended.v1');
    expect(ended?.envelope.tenant).toBeUndefined();
  });
});
