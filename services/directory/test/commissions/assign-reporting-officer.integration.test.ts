import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { outbox } from '../../src/db/schema.js';
import { IdentityUnavailable } from '../../src/identity/identity-provisioning.js';
import { componentSchema, contractErrors, okResponse } from '../support/contract.js';
import { type Caller, type DirectoryApi, startDirectoryApi } from '../support/directory-api.js';

/** Spec 01 scenarios S8-S10: assigning a Commission's reporting officer over HTTP. */
const PLATFORM_ADMIN: Caller = { sub: 'admin-1', tenant: 'platform', roles: ['platform-admin'] };

const OFFICER = {
  name: 'Fatuma Wanjiru',
  email: 'fatuma.wanjiru@tsc.go.ke',
  phone: '+254712345678',
};
const ACTIVATION = {
  actions: ['VERIFY_EMAIL', 'UPDATE_PASSWORD', 'CONFIGURE_TOTP'],
  lifespanSeconds: 259_200,
  redirectUri: 'http://localhost:3020/',
  clientId: 'console',
};

interface Problem {
  type: string;
  status: number;
  detail?: string;
  errors?: { path: string; message: string }[];
}

interface CommissionBody {
  reportingOfficer: {
    id: string;
    name: string;
    email: string;
    phone: string;
    state: string;
    invitedAt: string;
    activatedAt: string | null;
  } | null;
}

let api: DirectoryApi;

beforeAll(async () => {
  api = await startDirectoryApi();
});

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await api.reset();
  const created = await api.post(
    '/v1/commissions',
    { slug: 'tsc', name: 'Teachers Service Commission', type: 'hosted', categories: [] },
    PLATFORM_ADMIN,
  );
  expect(created.statusCode).toBe(201);
});

const assign = (
  body: unknown,
  {
    caller = PLATFORM_ADMIN,
    slug = 'tsc',
    key,
  }: { caller?: Caller; slug?: string; key?: string | null } = {},
) => api.put(`/v1/commissions/${slug}/reporting-officer`, body, caller, { idempotencyKey: key });

const officerOf = async (slug = 'tsc') =>
  (await api.get(`/v1/commissions/${slug}`, PLATFORM_ADMIN)).json<CommissionBody>()
    .reportingOfficer;

const assignedEvents = async () =>
  (await api.db.select({ type: outbox.eventType, envelope: outbox.envelope }).from(outbox)).filter(
    (event) => event.type === 'commission.reporting-officer.assigned.v1',
  );

const errorPaths = (body: Problem) => (body.errors ?? []).map((error) => error.path).sort();

describe('S8 assign', () => {
  it('invites the officer and returns the Commission with the assignment', async () => {
    const response = await assign(OFFICER);

    expect(response.statusCode).toBe(200);
    const body = response.json<CommissionBody>();
    expect(
      contractErrors(okResponse('/v1/commissions/{slug}/reporting-officer', 'put'), body),
    ).toEqual([]);
    expect(body.reportingOfficer).toMatchObject({
      ...OFFICER,
      state: 'invited',
      activatedAt: null,
    });
    expect(Date.now() - Date.parse(body.reportingOfficer?.invitedAt ?? '')).toBeLessThan(60_000);

    const read = await api.get('/v1/commissions/tsc', PLATFORM_ADMIN);
    expect(read.json()).toEqual(body);
    const invited = await api.get('/v1/commissions?reportingOfficer=invited', PLATFORM_ADMIN);
    expect(invited.json<{ total: number }>().total).toBe(1);
  });

  it('creates one staff account with tenant, role and the three required actions, and sends one email', async () => {
    await assign(OFFICER);

    const created = api.identity.calls('createStaffUser');
    expect(created).toEqual([
      {
        operation: 'createStaffUser',
        input: {
          ...OFFICER,
          tenant: 'tsc',
          role: 'reporting-officer',
          requiredActions: ['VERIFY_EMAIL', 'UPDATE_PASSWORD', 'CONFIGURE_TOTP'],
        },
      },
    ]);
    const emails = api.identity.calls('sendActivationEmail');
    expect(emails).toHaveLength(1);
    expect(emails[0]?.options).toEqual(ACTIVATION);
    expect(api.identity.user(emails[0]?.userId ?? '')?.email).toBe(OFFICER.email);
    expect(api.identity.calls('grantRole')).toEqual([]);
  });

  it('records commission.reporting-officer.assigned.v1 with ids only', async () => {
    const response = await assign(OFFICER);
    const commission = response.json<{ id: string } & CommissionBody>();
    const userId = api.identity.calls('sendActivationEmail')[0]?.userId;

    const events = await assignedEvents();
    expect(events).toHaveLength(1);
    const envelope = events[0]?.envelope;
    expect(envelope).toMatchObject({
      type: 'commission.reporting-officer.assigned.v1',
      source: 'adili/directory',
      subject: commission.id,
      tenant: 'tsc',
      data: {
        commissionId: commission.id,
        assignmentId: commission.reportingOfficer?.id,
        keycloakUserId: userId,
        replacedAssignmentId: null,
      },
    });
    expect(Object.keys(envelope?.data ?? {}).sort()).toEqual([
      'assignmentId',
      'commissionId',
      'keycloakUserId',
      'replacedAssignmentId',
    ]);
    const serialised = JSON.stringify(envelope);
    for (const personal of [OFFICER.name, 'Fatuma', OFFICER.email, OFFICER.phone, '712345678']) {
      expect(serialised).not.toContain(personal);
    }
  });

  it('stores the email in lower case and trims the name and email', async () => {
    const response = await assign({
      name: '  Fatuma Wanjiru ',
      email: ' Fatuma.Wanjiru@TSC.go.ke ',
      phone: OFFICER.phone,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<CommissionBody>().reportingOfficer).toMatchObject({
      name: 'Fatuma Wanjiru',
      email: 'fatuma.wanjiru@tsc.go.ke',
    });
    expect(api.identity.calls('createStaffUser')[0]?.input.email).toBe('fatuma.wanjiru@tsc.go.ke');
  });

  it('replays the same key and body without a second account, email or event', async () => {
    const key = randomUUID();
    const first = await assign(OFFICER, { key });
    const replay = await assign(OFFICER, { key });

    expect(replay.statusCode).toBe(200);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.json()).toEqual(first.json());
    expect(api.identity.calls('createStaffUser')).toHaveLength(1);
    expect(api.identity.calls('sendActivationEmail')).toHaveLength(1);
    expect(await assignedEvents()).toHaveLength(1);
  });
});

describe('S9 email in another tenant', () => {
  it.each([
    ['another tenant', 'psc'],
    ['no tenant', null],
  ])(
    'refuses an email whose account belongs to %s (409), with no assignment and no email',
    async (_case, tenant) => {
      api.identity.seedUser({ email: OFFICER.email, tenant });

      const response = await assign(OFFICER);

      expect(response.statusCode).toBe(409);
      expect(response.headers['content-type']).toContain('application/problem+json');
      const problem = response.json<Problem>();
      expect(contractErrors(componentSchema('ProblemDetails'), problem)).toEqual([]);
      expect(problem.type).toBe('email-belongs-to-other-tenant');
      expect(errorPaths(problem)).toEqual(['email']);
      expect(await officerOf()).toBeNull();
      expect(api.identity.calls('createStaffUser')).toEqual([]);
      expect(api.identity.calls('grantRole')).toEqual([]);
      expect(api.identity.calls('sendActivationEmail')).toEqual([]);
      expect(await assignedEvents()).toEqual([]);
    },
  );
});

describe('S10 email in the same tenant', () => {
  it('reuses the account, grants the role and sends one email', async () => {
    const userId = api.identity.seedUser({
      email: OFFICER.email,
      tenant: 'tsc',
      roles: ['reviewer'],
    });

    const response = await assign(OFFICER);

    expect(response.statusCode).toBe(200);
    expect(response.json<CommissionBody>().reportingOfficer?.state).toBe('invited');
    expect(api.identity.calls('createStaffUser')).toEqual([]);
    expect(api.identity.calls('grantRole')).toEqual([
      { operation: 'grantRole', userId, role: 'reporting-officer' },
    ]);
    expect(api.identity.calls('setEnabled')).toEqual([]);
    expect(api.identity.calls('sendActivationEmail')).toEqual([
      { operation: 'sendActivationEmail', userId, options: ACTIVATION },
    ]);
    expect(api.identity.user(userId)?.roles).toEqual(['reviewer', 'reporting-officer']);
    expect((await assignedEvents())[0]?.envelope.data).toMatchObject({ keycloakUserId: userId });
  });
});

describe('identity provider failures', () => {
  it.each(['findByEmail', 'createStaffUser', 'sendActivationEmail'] as const)(
    'answers 502 and keeps no assignment when %s fails',
    async (operation) => {
      api.identity.failNext(operation, new IdentityUnavailable('Keycloak is unreachable'));

      const response = await assign(OFFICER);

      expect(response.statusCode).toBe(502);
      const problem = response.json<Problem>();
      expect(contractErrors(componentSchema('ProblemDetails'), problem)).toEqual([]);
      expect(problem.type).toBe('identity-unavailable');
      expect(problem.detail).not.toContain('unreachable');
      expect(await officerOf()).toBeNull();
      expect(await assignedEvents()).toEqual([]);
    },
  );

  it('removes the account a failed attempt created', async () => {
    api.identity.failNext('sendActivationEmail', new IdentityUnavailable('SMTP timeout'));

    expect((await assign(OFFICER)).statusCode).toBe(502);

    expect(api.identity.userByEmail(OFFICER.email)).toBeUndefined();
  });

  it('returns a reused account to how it was when a later step fails', async () => {
    const userId = api.identity.seedUser({
      email: OFFICER.email,
      tenant: 'tsc',
      roles: ['reviewer'],
    });
    api.identity.failNext('sendActivationEmail', new IdentityUnavailable('SMTP timeout'));

    expect((await assign(OFFICER)).statusCode).toBe(502);

    expect(api.identity.user(userId)).toMatchObject({ enabled: true, roles: ['reviewer'] });
  });

  it('can be retried with the same key after a 502', async () => {
    const key = randomUUID();
    api.identity.failNext('sendActivationEmail', new IdentityUnavailable('timeout'));
    expect((await assign(OFFICER, { key })).statusCode).toBe(502);

    const retry = await assign(OFFICER, { key });

    expect(retry.statusCode).toBe(200);
    expect(retry.headers['idempotent-replayed']).toBeUndefined();
    expect(api.identity.calls('createStaffUser')).toHaveLength(2);
    expect(api.identity.calls('sendActivationEmail')).toHaveLength(2);
    expect(api.identity.userByEmail(OFFICER.email)?.userId).toBe(
      api.identity.calls('sendActivationEmail')[1]?.userId,
    );
    expect(await assignedEvents()).toHaveLength(1);
  });

  it('reuses on retry an account that a failed attempt could not remove', async () => {
    const key = randomUUID();
    api.identity.failNext('sendActivationEmail', new IdentityUnavailable('timeout'));
    api.identity.failNext('deleteUser', new IdentityUnavailable('timeout'));
    expect((await assign(OFFICER, { key })).statusCode).toBe(502);
    const leftover = api.identity.userByEmail(OFFICER.email);
    expect(leftover).toMatchObject({ tenant: 'tsc', roles: ['reporting-officer'] });

    const retry = await assign(OFFICER, { key });

    expect(retry.statusCode).toBe(200);
    expect(api.identity.calls('createStaffUser')).toHaveLength(1);
    expect(api.identity.calls('sendActivationEmail').at(-1)?.userId).toBe(leftover?.userId);
    expect(await assignedEvents()).toHaveLength(1);
  });
});

describe('refusals', () => {
  it('answers 404 for a Commission that does not exist', async () => {
    const response = await assign(OFFICER, { slug: 'nope' });

    expect(response.statusCode).toBe(404);
    expect(api.identity.calls()).toEqual([]);
  });

  it('lists every invalid field', async () => {
    const response = await assign({ name: 'F', email: 'fatuma@', phone: '0712345678', role: 'x' });

    expect(response.statusCode).toBe(400);
    expect(errorPaths(response.json<Problem>())).toEqual(['', 'email', 'name', 'phone']);
    expect(api.identity.calls()).toEqual([]);
  });

  it.each(['12345', '+0712345678', '+2547123456789012', '0712 345 678'])(
    'accepts only E.164 phone numbers (%s is refused)',
    async (phone) => {
      const response = await assign({ ...OFFICER, phone });

      expect(response.statusCode).toBe(400);
      expect(errorPaths(response.json<Problem>())).toEqual(['phone']);
    },
  );

  it('requires an Idempotency-Key', async () => {
    const response = await assign(OFFICER, { key: null });

    expect(response.statusCode).toBe(400);
    expect(response.json<Problem>().type).toBe('idempotency-key-missing');
  });

  it.each([
    ['eacc-supervisor', { tenant: 'eacc', roles: ['eacc-supervisor'] }],
    ['a reporting officer of the tenant', { tenant: 'tsc', roles: ['reporting-officer'] }],
    ['a token without roles', { tenant: 'platform', roles: [] }],
  ])('refuses %s (403)', async (_who, caller: Caller) => {
    const response = await assign(OFFICER, { caller });

    expect(response.statusCode).toBe(403);
    expect(await officerOf()).toBeNull();
    expect(api.identity.calls()).toEqual([]);
  });
});
