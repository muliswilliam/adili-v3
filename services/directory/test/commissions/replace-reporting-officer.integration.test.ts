import { randomUUID } from 'node:crypto';

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { IdentityUnavailable } from '../../src/identity/identity-provisioning.js';
import { componentSchema, contractErrors, okResponse } from '../support/contract.js';
import { type DirectoryApi, startDirectoryApi } from '../support/directory-api.js';
import {
  ACTIVATION,
  assign,
  assignedEvents,
  assignmentRows,
  type CommissionBody,
  givenActivated,
  givenOfficer,
  givenTsc,
  officerOf,
  type Problem,
  withOutboxRefusing,
  withTscLocked,
} from '../support/reporting-officers.js';

/** Spec 01 scenario S11: replacing a Commission's reporting officer over HTTP. */
const FIRST = { name: 'Fatuma Wanjiru', email: 'fatuma.wanjiru@tsc.go.ke', phone: '+254712345678' };
const SECOND = { name: 'Brian Otieno', email: 'brian.otieno@tsc.go.ke', phone: '+254722000111' };

let api: DirectoryApi;

beforeAll(async () => {
  api = await startDirectoryApi();
  return () => api.close();
});

beforeEach(async () => {
  await api.reset();
  await givenTsc(api);
});

describe('S11 replace', () => {
  it('marks the previous assignment replaced by the new one, which is invited', async () => {
    const previous = await givenOfficer(api, FIRST);

    const response = await assign(api, SECOND);

    expect(response.statusCode).toBe(200);
    const body = response.json<CommissionBody>();
    expect(
      contractErrors(okResponse('/v1/commissions/{slug}/reporting-officer', 'put'), body),
    ).toEqual([]);
    expect(body.reportingOfficer).toMatchObject({ ...SECOND, state: 'invited', activatedAt: null });
    expect(body.reportingOfficer?.id).not.toBe(previous.assignmentId);
    expect(await officerOf(api)).toEqual(body.reportingOfficer);

    const rows = await assignmentRows(api);
    expect(rows).toEqual([
      expect.objectContaining({
        id: previous.assignmentId,
        email: FIRST.email,
        state: 'replaced',
        replacedBy: body.reportingOfficer?.id,
        replacedAt: expect.any(Date) as Date,
      }),
      expect.objectContaining({
        id: body.reportingOfficer?.id,
        email: SECOND.email,
        state: 'invited',
        replacedBy: null,
        replacedAt: null,
      }),
    ]);
  });

  it('revokes the role of the previous account and disables it, then invites the new officer', async () => {
    const previous = await givenOfficer(api, FIRST);

    await assign(api, SECOND);

    expect(api.identity.calls('revokeRole')).toEqual([
      { operation: 'revokeRole', userId: previous.userId, role: 'reporting-officer' },
    ]);
    expect(api.identity.calls('setEnabled')).toEqual([
      { operation: 'setEnabled', userId: previous.userId, enabled: false },
    ]);
    expect(api.identity.user(previous.userId)).toMatchObject({ enabled: false, roles: [] });
    const created = api.identity.calls('createStaffUser');
    expect(created.map((call) => call.input.email)).toEqual([FIRST.email, SECOND.email]);
    const emails = api.identity.calls('sendActivationEmail');
    expect(emails).toHaveLength(2);
    const newUserId = emails[1]?.userId ?? '';
    expect(emails[1]?.options).toEqual(ACTIVATION);
    expect(api.identity.user(newUserId)).toMatchObject({
      email: SECOND.email,
      tenant: 'tsc',
      roles: ['reporting-officer'],
      enabled: true,
    });
  });

  it('records the replacement in commission.reporting-officer.assigned.v1', async () => {
    const previous = await givenOfficer(api, FIRST);

    const response = await assign(api, SECOND);

    const body = response.json<CommissionBody>();
    const events = await assignedEvents(api);
    expect(events).toHaveLength(2);
    expect(events[1]?.envelope).toMatchObject({
      subject: body.id,
      tenant: 'tsc',
      data: {
        commissionId: body.id,
        assignmentId: body.reportingOfficer?.id,
        keycloakUserId: api.identity.calls('sendActivationEmail')[1]?.userId,
        replacedAssignmentId: previous.assignmentId,
      },
    });
    const serialised = JSON.stringify(events[1]?.envelope);
    for (const personal of [FIRST.name, FIRST.email, SECOND.name, SECOND.email, SECOND.phone]) {
      expect(serialised).not.toContain(personal);
    }
  });

  it('replaces an activated officer the same way', async () => {
    const previous = await givenOfficer(api, FIRST);
    await givenActivated(api, previous.assignmentId);

    const response = await assign(api, SECOND);

    expect(response.statusCode).toBe(200);
    expect(response.json<CommissionBody>().reportingOfficer?.state).toBe('invited');
    expect((await assignmentRows(api)).map((row) => row.state)).toEqual(['replaced', 'invited']);
    expect(api.identity.user(previous.userId)?.enabled).toBe(false);
  });

  it('only takes the role from a previous officer whose account holds other roles', async () => {
    const reviewer = api.identity.seedUser({
      email: FIRST.email,
      tenant: 'tsc',
      roles: ['reviewer'],
    });
    await givenOfficer(api, FIRST);

    const response = await assign(api, SECOND);

    expect(response.statusCode).toBe(200);
    expect(api.identity.user(reviewer)).toMatchObject({ enabled: true, roles: ['reviewer'] });
  });

  it('corrects the details of the invited officer in place and sends their email again', async () => {
    const previous = await givenOfficer(api, FIRST);
    const corrected = { ...FIRST, name: 'Fatuma Wanjiru Kamau', phone: '+254733444555' };

    const response = await assign(api, corrected);

    expect(response.statusCode).toBe(200);
    expect(response.json<CommissionBody>().reportingOfficer).toMatchObject({
      ...corrected,
      id: previous.assignmentId,
      state: 'invited',
    });
    expect((await assignmentRows(api)).map((row) => row.state)).toEqual(['invited']);
    expect(await assignedEvents(api)).toHaveLength(1);
    expect(api.identity.calls('revokeRole')).toEqual([]);
    expect(api.identity.user(previous.userId)).toMatchObject({
      name: corrected.name,
      phone: corrected.phone,
      enabled: true,
      roles: ['reporting-officer'],
    });
    const emails = api.identity.calls('sendActivationEmail');
    expect(emails.map((email) => email.userId)).toEqual([previous.userId, previous.userId]);
  });

  it('corrects the details of an activated officer without an email or a new invitation', async () => {
    const previous = await givenOfficer(api, FIRST);
    await givenActivated(api, previous.assignmentId);
    const activated = await officerOf(api);

    const response = await assign(api, { ...FIRST, phone: '+254733444555' });

    expect(response.statusCode).toBe(200);
    expect(response.json<CommissionBody>().reportingOfficer).toEqual({
      ...activated,
      phone: '+254733444555',
    });
    expect((await assignmentRows(api)).map((row) => row.state)).toEqual(['activated']);
    expect(await assignedEvents(api)).toHaveLength(1);
    expect(api.identity.calls('sendActivationEmail')).toHaveLength(1);
    expect(api.identity.user(previous.userId)).toMatchObject({ phone: '+254733444555' });
  });

  it('enables the account of a previously replaced officer who is assigned again', async () => {
    const first = await givenOfficer(api, FIRST);
    const second = await givenOfficer(api, SECOND);
    expect(api.identity.user(first.userId)?.enabled).toBe(false);

    const response = await assign(api, FIRST);

    expect(response.statusCode).toBe(200);
    expect(api.identity.calls('createStaffUser')).toHaveLength(2);
    expect(api.identity.user(first.userId)).toMatchObject({
      enabled: true,
      roles: ['reporting-officer'],
    });
    expect(api.identity.user(second.userId)).toMatchObject({ enabled: false, roles: [] });
    expect(api.identity.calls('sendActivationEmail').at(-1)?.userId).toBe(first.userId);
    expect((await assignmentRows(api)).map((row) => row.state)).toEqual([
      'replaced',
      'replaced',
      'invited',
    ]);
  });

  it('still replaces an officer whose account was deleted in Keycloak by hand', async () => {
    const previous = await givenOfficer(api, FIRST);
    await api.identity.deleteUser(previous.userId);

    const response = await assign(api, SECOND);

    expect(response.statusCode).toBe(200);
    expect((await officerOf(api))?.email).toBe(SECOND.email);
  });

  it('replays the same key and body without a second replacement', async () => {
    await givenOfficer(api, FIRST);
    const key = randomUUID();

    const first = await assign(api, SECOND, { key });
    const replay = await assign(api, SECOND, { key });

    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.json()).toEqual(first.json());
    expect(await assignmentRows(api)).toHaveLength(2);
    expect(api.identity.calls('revokeRole')).toHaveLength(1);
    expect(api.identity.calls('sendActivationEmail')).toHaveLength(2);
  });

  it('serialises concurrent replacements, leaving one current assignment', async () => {
    await givenOfficer(api, FIRST);

    const responses = await Promise.all([
      assign(api, SECOND),
      assign(api, { ...SECOND, name: 'Cynthia Achieng', email: 'cynthia.achieng@tsc.go.ke' }),
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual([200, 200]);
    const rows = await assignmentRows(api);
    expect(rows.map((row) => row.state)).toEqual(['replaced', 'replaced', 'invited']);
    expect(rows[0]?.replacedBy).toBe(rows[1]?.id);
    expect(rows[1]?.replacedBy).toBe(rows[2]?.id);
  });
});

describe('S11 refusals and failures leave the current officer in place', () => {
  it('refuses an email of another tenant (409) before the current officer loses access', async () => {
    const previous = await givenOfficer(api, FIRST);
    api.identity.seedUser({ email: SECOND.email, tenant: 'psc' });

    const response = await assign(api, SECOND);

    expect(response.statusCode).toBe(409);
    expect(response.json<Problem>().type).toBe('email-belongs-to-other-tenant');
    expect(api.identity.calls('revokeRole')).toEqual([]);
    expect(api.identity.user(previous.userId)?.enabled).toBe(true);
    expect((await officerOf(api))?.id).toBe(previous.assignmentId);
    expect(await assignedEvents(api)).toHaveLength(1);
  });

  it.each(['findById', 'revokeRole', 'setEnabled', 'createStaffUser'] as const)(
    'answers 502, records nothing and leaves both accounts as they were when %s fails',
    async (operation) => {
      const previous = await givenOfficer(api, FIRST);
      api.identity.failNext(operation, new IdentityUnavailable('Keycloak is unreachable'));

      const response = await assign(api, SECOND);

      expect(response.statusCode).toBe(502);
      const problem = response.json<Problem>();
      expect(contractErrors(componentSchema('ProblemDetails'), problem)).toEqual([]);
      expect(problem.type).toBe('identity-unavailable');
      expect((await officerOf(api))?.id).toBe(previous.assignmentId);
      expect((await assignmentRows(api)).map((row) => row.state)).toEqual(['invited']);
      expect(await assignedEvents(api)).toHaveLength(1);
      expect(api.identity.user(previous.userId)).toMatchObject({
        enabled: true,
        roles: ['reporting-officer'],
      });
      expect(api.identity.userByEmail(SECOND.email)).toBeUndefined();
      expect(api.identity.calls('sendActivationEmail')).toHaveLength(1);
    },
  );

  it('returns both accounts to how they were when recording the replacement fails', async () => {
    const previous = await givenOfficer(api, FIRST);
    const reviewer = api.identity.seedUser({
      email: SECOND.email,
      tenant: 'tsc',
      name: 'Brian O.',
      phone: '+254700000002',
      roles: ['reviewer'],
    });

    expect((await withOutboxRefusing(api, () => assign(api, SECOND))).statusCode).toBe(500);

    expect(api.identity.user(reviewer)).toMatchObject({
      enabled: true,
      roles: ['reviewer'],
      name: 'Brian O.',
      phone: '+254700000002',
    });
    expect(api.identity.user(previous.userId)).toMatchObject({
      enabled: true,
      roles: ['reporting-officer'],
    });
    expect((await officerOf(api))?.id).toBe(previous.assignmentId);
    expect(api.identity.calls('sendActivationEmail')).toHaveLength(1);
  });

  it('keeps the replacement and answers 502 invitation-not-sent when the email fails', async () => {
    const previous = await givenOfficer(api, FIRST);
    api.identity.failNext('sendActivationEmail', new IdentityUnavailable('SMTP timeout'));

    const response = await assign(api, SECOND);

    expect(response.statusCode).toBe(502);
    expect(response.json<Problem>().type).toBe('invitation-not-sent');
    expect((await officerOf(api))?.email).toBe(SECOND.email);
    expect((await assignmentRows(api)).map((row) => row.state)).toEqual(['replaced', 'invited']);
    expect(api.identity.user(previous.userId)).toMatchObject({ enabled: false, roles: [] });
  });

  it('sends the email, without replacing again, when retried with the same key after it failed', async () => {
    await givenOfficer(api, FIRST);
    const key = randomUUID();
    api.identity.failNext('sendActivationEmail', new IdentityUnavailable('timeout'));
    expect((await assign(api, SECOND, { key })).statusCode).toBe(502);

    const retry = await assign(api, SECOND, { key });

    expect(retry.statusCode).toBe(200);
    expect(api.identity.calls('createStaffUser')).toHaveLength(2);
    expect(api.identity.calls('revokeRole')).toHaveLength(1);
    const emails = api.identity.calls('sendActivationEmail');
    expect(emails).toHaveLength(3);
    expect(emails[2]?.userId).toBe(api.identity.userByEmail(SECOND.email)?.userId);
    expect((await assignmentRows(api)).map((row) => row.state)).toEqual(['replaced', 'invited']);
    expect(await assignedEvents(api)).toHaveLength(2);
  });

  it('refuses (409) rather than queue behind a change that holds the Commission', async () => {
    const previous = await givenOfficer(api, FIRST);

    const response = await withTscLocked(api, () => assign(api, SECOND));

    expect(response.statusCode).toBe(409);
    expect(response.json<Problem>().type).toBe('reporting-officer-busy');
    expect((await officerOf(api))?.id).toBe(previous.assignmentId);
    expect(api.identity.userByEmail(SECOND.email)).toBeUndefined();
  });
});
