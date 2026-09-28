import { randomUUID } from 'node:crypto';

import { withTenant } from '@adili/data-access';
import { hasValidCheckCharacter } from '@adili/numbering';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PLATFORM_TENANT } from '../../src/commissions/access.js';
import { onboardingSessions, outbox, persons, rosterRecords } from '../../src/db/schema.js';
import { IdentityUnavailable } from '../../src/identity/identity-provisioning.js';
import type { OnboardingConfirmResult } from '../../src/onboarding/representation.js';
import type { OnboardingState } from '../../src/onboarding/session-state.js';
import { componentSchema, contractErrors, okResponse } from '../support/contract.js';
import { type Caller, type DirectoryApi, startDirectoryApi } from '../support/directory-api.js';
import { givenCommissions } from '../support/fixtures.js';
import { getSession, givenRoster, givenSession, onSession } from '../support/onboarding.js';
import { withOutboxRefusing } from '../support/reporting-officers.js';

/**
 * Spec 03 S11-S17 over HTTP: the confirm step (IPRS check, person and OFR, account created or
 * linked, record onboarded, events) and resending the set-password email, with the in-memory
 * IPRS lookup and identity adapter and the test clock.
 */

const NOW = new Date('2026-10-01T09:00:00Z');
const SECOND = 1000;
const CONFIRM_PATH = '/v1/onboarding/sessions/{sessionId}/confirm';
const PLATFORM_ADMIN: Caller = { tenant: 'platform', roles: ['platform-admin'] };
const OFR_PATTERN = /^OFR-[0-9]{7}-[0-9A-Z]$/;

const WANJIRU = {
  personnelFileNumber: 'TSC/100200',
  fullName: 'Otieno Wanjiru',
  nationalId: '12345678',
  designation: 'Senior Teacher',
  reportingEntity: 'Kisumu Girls High School',
  email: 'wanjiru.otieno@tsc.go.ke',
  phone: '+254712345123',
};
/** IPRS holds her middle name too, and a punctuated last name; the rule still matches. */
const WANJIRU_IPRS = { firstName: 'Wanjiru', middleName: 'Achieng', lastName: "O'tieno" };

let api: DirectoryApi;
let tscRecord: string;
let kamauRecord: string;
let pscRecord: string;

beforeAll(async () => {
  api = await startDirectoryApi();
});

beforeEach(async () => {
  await api.reset();
  api.clock.set(NOW);
  await givenCommissions(api.db, [
    { slug: 'tsc', name: 'Teachers Service Commission' },
    { slug: 'psc', name: 'Public Service Commission' },
  ]);
  const tsc = await givenRoster(api, 'tsc', [
    WANJIRU,
    { personnelFileNumber: 'TSC/100201', fullName: 'Kamau Njoroge', nationalId: '23456789' },
  ]);
  tscRecord = tsc.get('TSC/100200') ?? '';
  kamauRecord = tsc.get('TSC/100201') ?? '';
  // She moved: the same national ID on another Commission's roster, without a phone there.
  pscRecord =
    (
      await givenRoster(api, 'psc', [
        { ...WANJIRU, personnelFileNumber: 'PSC/2019/0001', email: null, phone: null },
      ])
    ).get('PSC/2019/0001') ?? '';
  api.iprs.givenPerson(WANJIRU.nationalId, WANJIRU_IPRS);
});

afterAll(async () => {
  await api.close();
});

/** A session at the confirm step for `recordId`, both contacts verified. */
function atConfirm(
  recordId: string,
  contacts: Partial<Parameters<typeof givenSession>[1]> = {},
): Promise<{ id: string; secret: string }> {
  return givenSession(api, {
    recordId,
    state: 'phone-verified',
    email: WANJIRU.email,
    emailVerified: true,
    phone: WANJIRU.phone,
    phoneVerified: true,
    ...contacts,
  });
}

function confirm(session: { id: string; secret: string }) {
  return onSession(api, 'POST', session.id, '/confirm', session.secret);
}

function resendPasswordEmail(session: { id: string; secret: string }) {
  return onSession(api, 'POST', session.id, '/resend-password-email', session.secret);
}

/** A POST on the session with this Idempotency-Key (none if null), as the portal sends it. */
function postWithKey(
  session: { id: string; secret: string },
  path: '/confirm' | '/resend-password-email',
  idempotencyKey: string | null,
  secret = session.secret,
) {
  return api.anonymous({
    method: 'POST',
    url: `/v1/onboarding/sessions/${session.id}${path}`,
    headers: {
      'x-onboarding-secret': secret,
      ...(idempotencyKey === null ? {} : { 'idempotency-key': idempotencyKey }),
    },
  });
}

async function events(type?: string) {
  const rows = await api.db
    .select({ type: outbox.eventType, envelope: outbox.envelope })
    .from(outbox)
    .orderBy(asc(outbox.id));
  return rows
    .filter((row) => type === undefined || row.type === type)
    .map(({ type: eventType, envelope }) => ({
      type: eventType,
      tenant: envelope.tenant,
      data: envelope.data,
    }));
}

async function record(id: string) {
  const [row] = await withTenant(api.db, { tenant: PLATFORM_TENANT, subject: 'test' }, (tx) =>
    tx.select().from(rosterRecords).where(eq(rosterRecords.id, id)),
  );
  if (!row) throw new Error(`no record ${id}`);
  return row;
}

async function sessionRow(id: string) {
  const [row] = await withTenant(api.db, { tenant: PLATFORM_TENANT, subject: 'test' }, (tx) =>
    tx.select().from(onboardingSessions).where(eq(onboardingSessions.id, id)),
  );
  return row;
}

function allPersons() {
  return api.db.select().from(persons).orderBy(asc(persons.createdAt));
}

async function onboardedCount(slug: string): Promise<number> {
  const response = await api.get(`/v1/commissions/${slug}/roster/summary`, PLATFORM_ADMIN);
  expect(response.statusCode).toBe(200);
  return response.json<{ onboardedDeclarants: number }>().onboardedDeclarants;
}

async function rosterRecordView(slug: string, id: string) {
  const response = await api.get(`/v1/commissions/${slug}/roster/records/${id}`, PLATFORM_ADMIN);
  expect(response.statusCode).toBe(200);
  return response.json<{ state: string; email: string | null; phone: string | null }>();
}

describe('S11 confirm creates the account', () => {
  it('creates the person with a valid OFR and the declarant account, sends one set-password email, onboards the record and records the events', async () => {
    const session = await atConfirm(tscRecord);
    const before = await onboardedCount('tsc');

    const response = await confirm(session);

    expect(response.statusCode, response.body).toBe(200);
    const result = response.json<OnboardingConfirmResult>();
    expect(contractErrors(okResponse(CONFIRM_PATH, 'post'), result)).toEqual([]);
    expect(result).toMatchObject({
      outcome: 'account-created',
      session: {
        id: session.id,
        state: 'confirmed',
        outcome: 'account-created',
        details: { fullName: 'Otieno Wanjiru', personnelFileNumber: 'TSC/100200' },
        setPasswordEmail: 'sent',
      },
    });
    const ofr = result.session.ofr ?? '';
    expect(ofr).toMatch(OFR_PATTERN);
    expect(hasValidCheckCharacter(ofr)).toBe(true);
    expect(api.iprs.calls()).toEqual([WANJIRU.nationalId]);

    const [person, ...others] = await allPersons();
    expect(others).toEqual([]);
    expect(person).toMatchObject({
      nationalId: WANJIRU.nationalId,
      fullName: 'Otieno Wanjiru',
      ofr,
      email: WANJIRU.email,
      phone: WANJIRU.phone,
    });
    const personId = person?.id ?? '';
    const keycloakUserId = person?.keycloakUserId ?? '';

    expect(api.identity.calls('createDeclarantUser')).toEqual([
      {
        operation: 'createDeclarantUser',
        input: {
          ofr,
          email: WANJIRU.email,
          name: 'Otieno Wanjiru',
          phone: WANJIRU.phone,
          tenant: 'tsc',
          personId,
        },
      },
    ]);
    expect(api.identity.user(keycloakUserId)).toMatchObject({
      username: ofr.toLowerCase(),
      email: WANJIRU.email,
      emailVerified: true,
      tenant: 'tsc',
      tenants: ['tsc'],
      ofr,
      personId,
      phone: WANJIRU.phone,
      roles: ['declarant'],
      requiredActions: ['UPDATE_PASSWORD'],
    });
    expect(api.identity.calls('sendExecuteActionsEmail')).toEqual([
      {
        operation: 'sendExecuteActionsEmail',
        userId: keycloakUserId,
        options: {
          actions: ['UPDATE_PASSWORD'],
          lifespanSeconds: 24 * 60 * 60,
          redirectUri: 'http://localhost:3010/auth/login',
          clientId: 'portal',
        },
      },
    ]);

    expect(await record(tscRecord)).toMatchObject({
      state: 'onboarded',
      personId,
      onboardedAt: NOW,
      identityMismatchAt: null,
    });
    expect(await onboardedCount('tsc')).toBe(before + 1);
    expect(await events('declarant.onboarded.v1')).toEqual([
      {
        type: 'declarant.onboarded.v1',
        tenant: 'tsc',
        data: { personId, ofr, rosterRecordId: tscRecord, keycloakUserId, linked: false },
      },
    ]);
    expect(await events('onboarding.session.ended.v1')).toEqual([
      {
        type: 'onboarding.session.ended.v1',
        tenant: 'tsc',
        data: { sessionId: session.id, outcome: 'confirmed' },
      },
    ]);
  });

  it('keeps the session readable for the check-email step, with when the email may be sent again', async () => {
    const session = await atConfirm(tscRecord);
    const { session: confirmed } = (await confirm(session)).json<OnboardingConfirmResult>();

    const read = await getSession(api, session.id, session.secret);

    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual(confirmed);
    expect(confirmed.otp).toEqual({
      channel: null,
      resendAvailableAt: new Date(NOW.getTime() + 60 * SECOND).toISOString(),
      resendsLeft: 0,
      attemptsLeft: 0,
    });
    // A successful step: ten more minutes to receive the email and ask for another.
    expect(confirmed.expiresAt).toBe(new Date(NOW.getTime() + 40 * 60 * SECOND).toISOString());
    api.clock.advance(60 * SECOND);
    expect((await getSession(api, session.id, session.secret)).json()).toMatchObject({
      otp: { resendAvailableAt: null },
    });
  });

  it('writes the contacts the declarant supplied back to the record, as theirs, and keeps the roster ones', async () => {
    const session = await atConfirm(pscRecord, {
      email: 'wanjiru@example.com',
      emailSource: 'declarant',
      phone: '+254700111222',
      phoneSource: 'declarant',
    });

    expect((await confirm(session)).statusCode).toBe(200);

    expect(await record(pscRecord)).toMatchObject({
      email: 'wanjiru@example.com',
      emailSource: 'declarant',
      phone: '+254700111222',
      phoneSource: 'declarant',
    });
    expect(await rosterRecordView('psc', pscRecord)).toMatchObject({
      state: 'onboarded',
      email: 'wanjiru@example.com',
      phone: '+254700111222',
    });
  });

  it('leaves roster-sourced contacts as the roster had them', async () => {
    expect((await confirm(await atConfirm(tscRecord))).statusCode).toBe(200);

    expect(await record(tscRecord)).toMatchObject({
      email: WANJIRU.email,
      emailSource: 'roster',
      phone: WANJIRU.phone,
      phoneSource: 'roster',
    });
  });

  it('clears an identity-mismatch flag from an earlier attempt once IPRS agrees', async () => {
    api.iprs.givenPerson(WANJIRU.nationalId, { ...WANJIRU_IPRS, lastName: 'Kamau' });
    await confirm(await atConfirm(tscRecord));
    expect((await record(tscRecord)).identityMismatchAt).toEqual(NOW);
    api.iprs.givenPerson(WANJIRU.nationalId, WANJIRU_IPRS);

    expect((await confirm(await atConfirm(tscRecord))).json()).toMatchObject({
      outcome: 'account-created',
    });
    expect((await record(tscRecord)).identityMismatchAt).toBeNull();
  });

  it('allocates OFRs in turn', async () => {
    api.iprs.givenPerson('23456789', { firstName: 'Kamau', middleName: null, lastName: 'Njoroge' });

    const first = (await confirm(await atConfirm(tscRecord))).json<OnboardingConfirmResult>();
    const second = (
      await confirm(await atConfirm(kamauRecord, { email: 'kamau@tsc.go.ke' }))
    ).json<OnboardingConfirmResult>();

    expect(first.session.ofr?.slice(0, 12)).toBe('OFR-0000001-');
    expect(second.session.ofr?.slice(0, 12)).toBe('OFR-0000002-');
  });
});

describe('S12, S13 identity mismatch', () => {
  it.each([
    ['S12: a different last name', { ...WANJIRU_IPRS, lastName: 'Kamau' }, 'mismatch'],
    ['S13: no IPRS record', null, 'not-found'],
  ] as const)(
    '%s ends the session identity-mismatch, flags the record and creates nothing',
    async (_case, iprsPerson, iprsOutcome) => {
      api.iprs.reset();
      if (iprsPerson) api.iprs.givenPerson(WANJIRU.nationalId, iprsPerson);
      const session = await atConfirm(tscRecord);

      const response = await confirm(session);

      expect(response.statusCode, response.body).toBe(200);
      const result = response.json<OnboardingConfirmResult>();
      expect(contractErrors(okResponse(CONFIRM_PATH, 'post'), result)).toEqual([]);
      expect(result).toMatchObject({
        outcome: 'identity-mismatch',
        session: {
          state: 'identity-mismatch',
          outcome: 'identity-mismatch',
          ofr: null,
          setPasswordEmail: null,
        },
      });
      expect(await sessionRow(session.id)).toMatchObject({ iprsOutcome, personId: null });
      expect(await record(tscRecord)).toMatchObject({
        state: 'not_onboarded',
        personId: null,
        identityMismatchAt: NOW,
      });
      expect(await allPersons()).toEqual([]);
      expect(api.identity.calls()).toEqual([]);
      expect(await events('declarant.onboarded.v1')).toEqual([]);
      expect(await events('onboarding.identity-mismatch.v1')).toEqual([
        {
          type: 'onboarding.identity-mismatch.v1',
          tenant: 'tsc',
          data: { rosterRecordId: tscRecord, sessionId: session.id },
        },
      ]);
      expect(await events('onboarding.session.ended.v1')).toEqual([
        {
          type: 'onboarding.session.ended.v1',
          tenant: 'tsc',
          data: { sessionId: session.id, outcome: 'identity-mismatch' },
        },
      ]);
      expect((await confirm(session)).statusCode).toBe(409);
    },
  );

  it('requires every IPRS name but the middle one among the roster names', async () => {
    api.iprs.givenPerson(WANJIRU.nationalId, {
      firstName: 'Wanjiru Njeri',
      middleName: null,
      lastName: 'Otieno',
    });

    expect((await confirm(await atConfirm(tscRecord))).json()).toMatchObject({
      outcome: 'identity-mismatch',
    });
  });
});

describe('S14 IPRS unavailable', () => {
  it('answers 503 iprs-unavailable, leaves the session at phone-verified, and a retry succeeds', async () => {
    const session = await atConfirm(tscRecord);
    api.iprs.failNext();

    const response = await confirm(session);

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: 'iprs-unavailable', status: 503 });
    expect(contractErrors(componentSchema('OnboardingProblem'), response.json())).toEqual([]);
    expect((await getSession(api, session.id, session.secret)).json()).toMatchObject({
      state: 'phone-verified',
    });
    expect(await record(tscRecord)).toMatchObject({
      state: 'not_onboarded',
      identityMismatchAt: null,
    });
    expect(await events()).toEqual([]);
    expect(api.identity.calls()).toEqual([]);

    const retry = await confirm(session);
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toMatchObject({ outcome: 'account-created' });
  });
});

describe('S15 a person onboarded with another Commission', () => {
  it('links the record to the existing person and account, adds the Commission to tenants, and asks them to sign in', async () => {
    const first = (await confirm(await atConfirm(tscRecord))).json<OnboardingConfirmResult>();
    const [person] = await allPersons();
    const keycloakUserId = person?.keycloakUserId ?? '';
    const session = await atConfirm(pscRecord, {
      email: 'wanjiru@example.com',
      emailSource: 'declarant',
      phone: '+254700111222',
      phoneSource: 'declarant',
    });

    const response = await confirm(session);

    expect(response.statusCode, response.body).toBe(200);
    const result = response.json<OnboardingConfirmResult>();
    expect(contractErrors(okResponse(CONFIRM_PATH, 'post'), result)).toEqual([]);
    expect(result).toMatchObject({
      outcome: 'linked-existing-account',
      session: {
        state: 'confirmed',
        outcome: 'linked-existing-account',
        ofr: first.session.ofr,
        setPasswordEmail: null,
      },
    });
    // No password to set: nothing to resend.
    expect(result.session.otp.resendAvailableAt).toBeNull();

    // Linking adds the Commission only: the person keeps the contacts their account has.
    expect(await allPersons()).toEqual([
      expect.objectContaining({
        id: person?.id,
        ofr: first.session.ofr,
        keycloakUserId,
        email: WANJIRU.email,
        phone: WANJIRU.phone,
      }),
    ]);
    expect(api.identity.user(keycloakUserId)).toMatchObject({
      email: WANJIRU.email,
      phone: WANJIRU.phone,
    });
    expect(api.identity.calls('createDeclarantUser')).toHaveLength(1);
    expect(api.identity.calls('sendExecuteActionsEmail')).toHaveLength(1);
    expect(api.identity.calls('addTenantToUser')).toEqual([
      { operation: 'addTenantToUser', userId: keycloakUserId, tenant: 'psc' },
    ]);
    expect(api.identity.user(keycloakUserId)).toMatchObject({
      tenant: 'tsc',
      tenants: ['tsc', 'psc'],
    });
    // The new Commission's record still gets the contacts verified for it.
    expect(await record(pscRecord)).toMatchObject({
      state: 'onboarded',
      personId: person?.id,
      onboardedAt: NOW,
      email: 'wanjiru@example.com',
      emailSource: 'declarant',
      phone: '+254700111222',
      phoneSource: 'declarant',
    });
    expect(await onboardedCount('psc')).toBe(1);
    expect(await events('declarant.onboarded.v1')).toEqual([
      expect.objectContaining({ tenant: 'tsc' }),
      {
        type: 'declarant.onboarded.v1',
        tenant: 'psc',
        data: {
          personId: person?.id,
          ofr: first.session.ofr,
          rosterRecordId: pscRecord,
          keycloakUserId,
          linked: true,
        },
      },
    ]);
  });
});

describe('S16 transaction boundaries', () => {
  async function expectNothingChanged(session: { id: string; secret: string }) {
    expect(await allPersons()).toEqual([]);
    expect(await record(tscRecord)).toMatchObject({
      state: 'not_onboarded',
      personId: null,
      onboardedAt: null,
    });
    expect(await onboardedCount('tsc')).toBe(0);
    expect(await events()).toEqual([]);
    expect((await getSession(api, session.id, session.secret)).json()).toMatchObject({
      state: 'phone-verified',
    });
  }

  it('answers 502 identity-unavailable when the account cannot be created, changing nothing', async () => {
    const session = await atConfirm(tscRecord);
    api.identity.failNext('createDeclarantUser', new IdentityUnavailable('Keycloak is down'));

    const response = await confirm(session);

    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({ code: 'identity-unavailable', status: 502 });
    expect(contractErrors(componentSchema('OnboardingProblem'), response.json())).toEqual([]);
    await expectNothingChanged(session);
    expect(api.identity.calls('sendExecuteActionsEmail')).toEqual([]);

    // The OFR allocated in the rolled-back transaction is allocated again: no gap.
    const retry = (await confirm(session)).json<OnboardingConfirmResult>();
    expect(retry.session.ofr?.slice(0, 12)).toBe('OFR-0000001-');
  });

  it('keeps the committed account when the set-password email fails, and says so, with resend open at once', async () => {
    const session = await atConfirm(tscRecord);
    api.identity.failNext('sendExecuteActionsEmail', new IdentityUnavailable('SMTP is down'));

    const response = await confirm(session);

    expect(response.statusCode, response.body).toBe(200);
    const result = response.json<OnboardingConfirmResult>();
    expect(contractErrors(okResponse(CONFIRM_PATH, 'post'), result)).toEqual([]);
    expect(result).toMatchObject({
      outcome: 'account-created',
      session: { state: 'confirmed', setPasswordEmail: 'failed', otp: { resendAvailableAt: null } },
    });
    const [person] = await allPersons();
    expect(person).toBeDefined();
    expect(api.identity.calls('deleteUser')).toEqual([]);
    expect(api.identity.user(person?.keycloakUserId ?? '')).toBeDefined();
    expect(await record(tscRecord)).toMatchObject({ state: 'onboarded', personId: person?.id });
    // The check-email step reads the same from the session.
    expect((await getSession(api, session.id, session.secret)).json()).toEqual(result.session);

    // No cooldown for an email that never went: the resend delivers it now.
    expect((await resendPasswordEmail(session)).statusCode).toBe(202);
    expect(api.identity.calls('sendExecuteActionsEmail')).toHaveLength(2);
    expect((await getSession(api, session.id, session.secret)).json()).toMatchObject({
      setPasswordEmail: 'sent',
      otp: { resendAvailableAt: new Date(NOW.getTime() + 60 * SECOND).toISOString() },
    });
  });

  it('keeps saying failed when the resend fails too', async () => {
    const session = await atConfirm(tscRecord);
    api.identity.failNext('sendExecuteActionsEmail', new IdentityUnavailable('SMTP is down'));
    await confirm(session);
    api.identity.failNext('sendExecuteActionsEmail', new IdentityUnavailable('SMTP is down'));

    const resend = await resendPasswordEmail(session);

    expect(resend.statusCode).toBe(502);
    expect(resend.json()).toMatchObject({ code: 'identity-unavailable' });
    expect((await getSession(api, session.id, session.secret)).json()).toMatchObject({
      setPasswordEmail: 'failed',
      otp: { resendAvailableAt: null },
    });
  });

  it('sends the set-password email only once the account and record are committed', async () => {
    const session = await atConfirm(tscRecord);

    const refused = await withOutboxRefusing(api, () => confirm(session));

    expect(refused.statusCode).toBe(500);
    expect(api.identity.calls('createDeclarantUser')).toHaveLength(1);
    expect(api.identity.calls('sendExecuteActionsEmail')).toEqual([]);
  });

  it('recovers from an account whose undo failed: the next confirm reuses its OFR', async () => {
    const session = await atConfirm(tscRecord);
    api.identity.failNext('deleteUser', new IdentityUnavailable('Keycloak is down'));

    const refused = await withOutboxRefusing(api, () => confirm(session));
    const [leftover] = api.identity.calls('createDeclarantUser');
    const retry = await confirm(session);

    expect(refused.statusCode).toBe(500);
    expect(retry.statusCode, retry.body).toBe(200);
    const result = retry.json<OnboardingConfirmResult>();
    expect(result.outcome).toBe('account-created');
    expect(result.session.ofr).toBe(leftover?.input.ofr);
    // The leftover (same OFR, same email) was replaced by the person's account.
    const [person] = await allPersons();
    expect(person?.ofr).toBe(leftover?.input.ofr);
    expect(api.identity.userByEmail(WANJIRU.email)).toMatchObject({
      userId: person?.keycloakUserId,
      ofr: person?.ofr,
    });
  });

  it('deletes the account it created when the transaction fails after it', async () => {
    const session = await atConfirm(tscRecord);

    const response = await withOutboxRefusing(api, () => confirm(session));

    expect(response.statusCode).toBe(500);
    await expectNothingChanged(session);
    const [created] = api.identity.calls('deleteUser');
    expect(created).toBeDefined();
    expect(api.identity.user(created?.userId ?? '')).toBeUndefined();
    expect(api.identity.calls('sendExecuteActionsEmail')).toEqual([]);
  });

  it('answers 502 when the existing account cannot be linked, and puts its tenants back when the transaction fails after linking', async () => {
    await confirm(await atConfirm(tscRecord));
    const [person] = await allPersons();
    const keycloakUserId = person?.keycloakUserId ?? '';
    const session = await atConfirm(pscRecord);
    const before = await events();
    api.identity.failNext('addTenantToUser', new IdentityUnavailable('Keycloak is down'));

    const failed = await confirm(session);
    const refused = await withOutboxRefusing(api, () => confirm(session));

    expect(failed.statusCode).toBe(502);
    expect(failed.json()).toMatchObject({ code: 'identity-unavailable' });
    expect(refused.statusCode).toBe(500);
    expect(api.identity.calls('addTenantToUser')).toHaveLength(2);
    expect(api.identity.user(keycloakUserId)).toMatchObject({ tenants: ['tsc'] });
    expect(await record(pscRecord)).toMatchObject({ state: 'not_onboarded', personId: null });
    expect(await events()).toEqual(before);
  });

  it('answers 409 email-in-use when the verified email belongs to another account, changing nothing', async () => {
    api.identity.seedUser({ email: WANJIRU.email, tenant: 'tsc', roles: ['reporting-officer'] });
    const session = await atConfirm(tscRecord);

    const response = await confirm(session);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'email-in-use', status: 409 });
    expect(contractErrors(componentSchema('OnboardingProblem'), response.json())).toEqual([]);
    await expectNothingChanged(session);
  });
});

describe('retrying confirm and resend (Idempotency-Key, ADR-013 §7.5)', () => {
  it('replays the first answer to a retry of confirm with the same key, creating one account', async () => {
    const session = await atConfirm(tscRecord);
    const key = randomUUID();

    const first = await postWithKey(session, '/confirm', key);
    const retry = await postWithKey(session, '/confirm', key);

    expect(first.statusCode, first.body).toBe(200);
    expect(retry.statusCode).toBe(200);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.json()).toEqual(first.json());
    expect(await allPersons()).toHaveLength(1);
    expect(api.identity.calls('createDeclarantUser')).toHaveLength(1);
    expect(api.identity.calls('sendExecuteActionsEmail')).toHaveLength(1);
    expect(await events('declarant.onboarded.v1')).toHaveLength(1);
  });

  it('runs a new submission (another key) against the session as it now is', async () => {
    const session = await atConfirm(tscRecord);
    await postWithKey(session, '/confirm', randomUUID());

    const again = await postWithKey(session, '/confirm', randomUUID());

    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: 'wrong-step' });
  });

  it('never replays a stored answer to a caller without the secret', async () => {
    const session = await atConfirm(tscRecord);
    const key = randomUUID();
    await postWithKey(session, '/confirm', key);

    const guessed = await postWithKey(session, '/confirm', key, 'not-the-secret');

    expect(guessed.statusCode).toBe(404);
    expect(guessed.headers['idempotent-replayed']).toBeUndefined();
  });

  it('does not keep a 503, so a retry with the same key runs the check again', async () => {
    const session = await atConfirm(tscRecord);
    const key = randomUUID();
    api.iprs.failNext();

    const unavailable = await postWithKey(session, '/confirm', key);
    const retry = await postWithKey(session, '/confirm', key);

    expect(unavailable.statusCode).toBe(503);
    expect(retry.statusCode, retry.body).toBe(200);
    expect(retry.headers['idempotent-replayed']).toBeUndefined();
    expect(retry.json()).toMatchObject({ outcome: 'account-created' });
  });

  it('replays a resent set-password email instead of sending another', async () => {
    const session = await atConfirm(tscRecord);
    await confirm(session);
    api.clock.advance(60 * SECOND);
    const key = randomUUID();

    const first = await postWithKey(session, '/resend-password-email', key);
    const retry = await postWithKey(session, '/resend-password-email', key);
    const another = await postWithKey(session, '/resend-password-email', randomUUID());

    expect(first.statusCode).toBe(202);
    expect(retry.statusCode).toBe(202);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(api.identity.calls('sendExecuteActionsEmail')).toHaveLength(2);
    expect(another.statusCode).toBe(429);
    expect(another.json()).toMatchObject({ code: 'resend-cooldown' });
  });

  it.each(['/confirm', '/resend-password-email'] as const)(
    'refuses %s without a key',
    async (path) => {
      const session = await atConfirm(tscRecord);

      const response = await postWithKey(session, path, null);

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ type: 'idempotency-key-missing' });
      expect(api.iprs.calls()).toEqual([]);
    },
  );
});

describe('confirm against a changing roster', () => {
  it('keeps a contact an import added to the record during the session', async () => {
    const session = await atConfirm(pscRecord, {
      email: 'wanjiru@example.com',
      emailSource: 'declarant',
      phone: '+254700111222',
      phoneSource: 'declarant',
    });
    await withTenant(api.db, { tenant: PLATFORM_TENANT, subject: 'test' }, (tx) =>
      tx
        .update(rosterRecords)
        .set({ phone: '+254733000111', phoneSource: 'roster' })
        .where(eq(rosterRecords.id, pscRecord)),
    );

    expect((await confirm(session)).statusCode).toBe(200);

    expect(await record(pscRecord)).toMatchObject({
      email: 'wanjiru@example.com',
      emailSource: 'declarant',
      phone: '+254733000111',
      phoneSource: 'roster',
    });
  });

  it('holds no lock while IPRS answers: the session stays readable meanwhile', async () => {
    const session = await atConfirm(tscRecord);
    const release = api.iprs.holdNext();

    const confirming = confirm(session);
    await expect.poll(() => api.iprs.calls().length).toBe(1);
    const read = await getSession(api, session.id, session.secret);
    release();

    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({ state: 'phone-verified' });
    expect((await confirming).json()).toMatchObject({ outcome: 'account-created' });
  });

  it('asks IPRS again when the record changed while it answered', async () => {
    const session = await atConfirm(tscRecord);
    api.iprs.givenPerson('87654321', { firstName: 'Kamau', middleName: null, lastName: 'Njoroge' });
    const release = api.iprs.holdNext();

    const confirming = confirm(session);
    await expect.poll(() => api.iprs.calls().length).toBe(1);
    // An import corrects the record's national ID and name while IPRS answers for the old ones.
    await withTenant(api.db, { tenant: PLATFORM_TENANT, subject: 'test' }, (tx) =>
      tx
        .update(rosterRecords)
        .set({ nationalId: '87654321', fullName: 'Kamau Njoroge' })
        .where(eq(rosterRecords.id, tscRecord)),
    );
    release();
    const response = await confirming;

    expect(response.statusCode, response.body).toBe(200);
    expect(api.iprs.calls()).toEqual([WANJIRU.nationalId, '87654321']);
    expect(await allPersons()).toEqual([
      expect.objectContaining({ nationalId: '87654321', fullName: 'Kamau Njoroge' }),
    ]);
  });
});

describe('confirm from the wrong step', () => {
  it.each<OnboardingState>(['email-pending', 'email-verified', 'phone-pending'])(
    'answers 409 from %s without asking IPRS',
    async (state) => {
      const session = await givenSession(api, {
        recordId: tscRecord,
        state,
        email: WANJIRU.email,
        phone: WANJIRU.phone,
      });

      const response = await confirm(session);

      expect(response.statusCode).toBe(409);
      expect(api.iprs.calls()).toEqual([]);
    },
  );

  it('answers 409 to a second confirm, creating one account', async () => {
    const session = await atConfirm(tscRecord);

    const [first, second] = await Promise.all([confirm(session), confirm(session)]);

    expect([first.statusCode, second.statusCode].sort()).toEqual([200, 409]);
    expect(await allPersons()).toHaveLength(1);
    expect(api.identity.calls('createDeclarantUser')).toHaveLength(1);
  });

  it('ends the session (410) when the record exited meanwhile', async () => {
    const session = await atConfirm(tscRecord);
    await withTenant(api.db, { tenant: PLATFORM_TENANT, subject: 'test' }, (tx) =>
      tx
        .update(rosterRecords)
        .set({ state: 'exited', stateBeforeExit: 'not_onboarded', exitDate: '2026-09-30' })
        .where(eq(rosterRecords.id, tscRecord)),
    );

    const response = await confirm(session);

    expect(response.statusCode).toBe(410);
    expect(response.json()).toMatchObject({ code: 'session-expired' });
    expect(await sessionRow(session.id)).toMatchObject({ state: 'expired', endReason: 'expired' });
    expect(api.iprs.calls()).toEqual([]);
  });
});

describe('S17 resend the set-password email', () => {
  it('sends it again from confirmed, a minute after the last one', async () => {
    const session = await atConfirm(tscRecord);
    await confirm(session);
    const [person] = await allPersons();

    const tooSoon = await resendPasswordEmail(session);
    api.clock.advance(60 * SECOND);
    const resent = await resendPasswordEmail(session);

    expect(tooSoon.statusCode).toBe(429);
    expect(tooSoon.json()).toMatchObject({ code: 'resend-cooldown', retryAfterSeconds: 60 });
    expect(contractErrors(componentSchema('OnboardingProblem'), tooSoon.json())).toEqual([]);
    expect(resent.statusCode).toBe(202);
    expect(resent.body).toBe('');
    const emails = api.identity.calls('sendExecuteActionsEmail');
    expect(emails).toHaveLength(2);
    expect(emails[1]).toEqual({ ...emails[0], userId: person?.keycloakUserId });
    expect((await getSession(api, session.id, session.secret)).json()).toMatchObject({
      state: 'confirmed',
      otp: {
        resendAvailableAt: new Date(NOW.getTime() + 120 * SECOND).toISOString(),
      },
    });
  });

  it('answers 502 when the email fails, and starts no cooldown', async () => {
    const session = await atConfirm(tscRecord);
    await confirm(session);
    api.clock.advance(60 * SECOND);
    api.identity.failNext('sendExecuteActionsEmail', new IdentityUnavailable('SMTP is down'));

    const failed = await resendPasswordEmail(session);
    const retry = await resendPasswordEmail(session);

    expect(failed.statusCode).toBe(502);
    expect(failed.json()).toMatchObject({ code: 'identity-unavailable' });
    expect(retry.statusCode).toBe(202);
  });

  it.each<OnboardingState>([
    'email-pending',
    'email-verified',
    'phone-pending',
    'phone-verified',
    'identity-mismatch',
  ])('answers 409 from %s', async (state) => {
    const session = await givenSession(api, {
      recordId: tscRecord,
      state,
      email: WANJIRU.email,
      phone: WANJIRU.phone,
    });

    expect((await resendPasswordEmail(session)).statusCode).toBe(409);
    expect(api.identity.calls('sendExecuteActionsEmail')).toEqual([]);
  });

  it('answers 409 for a session linked to an existing account', async () => {
    await confirm(await atConfirm(tscRecord));
    const linked = await atConfirm(pscRecord);
    await confirm(linked);
    api.clock.advance(60 * SECOND);

    expect((await resendPasswordEmail(linked)).statusCode).toBe(409);
    expect(api.identity.calls('sendExecuteActionsEmail')).toHaveLength(1);
  });
});
