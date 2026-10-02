import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { outbox, persons } from '../../src/db/schema.js';
import { IdentityUnavailable } from '../../src/identity/identity-provisioning.js';
import { componentSchema, contractErrors, okResponse } from '../support/contract.js';
import { type Caller, type DirectoryApi, startDirectoryApi } from '../support/directory-api.js';
import { withOutboxRefusing } from '../support/reporting-officers.js';

/** Spec 10 scenario S11 (provisioning part): law-enforcement officer accounts over HTTP. */
const PLATFORM_ADMIN: Caller = { sub: 'admin-1', tenant: 'platform', roles: ['platform-admin'] };
const ACCESS_OFFICER: Caller = { sub: 'access-1', tenant: 'psc', roles: ['access-officer'] };
const DECLARANT: Caller = { sub: 'declarant-1', tenant: 'psc', roles: ['declarant'] };
const NOTIFICATIONS: Caller = {
  sub: 'service-account-notifications',
  tenant: 'platform',
  azp: 'notifications',
  scope: 'directory:person-contacts',
};

const OFFICER = {
  name: 'Achieng Wafula',
  email: 'achieng.wafula@dci.go.ke',
  phone: '+254712345987',
};
const ACTIVATION = {
  actions: ['VERIFY_EMAIL', 'UPDATE_PASSWORD', 'CONFIGURE_TOTP'],
  lifespanSeconds: 259_200,
  redirectUri: 'http://localhost:3020/auth/login',
  clientId: 'console',
  commissionName: 'Directorate of Criminal Investigations',
  role: 'law-enforcement',
};

interface Account {
  id: string;
  agencyCode: string;
  name: string;
  email: string;
  phone: string;
  state: string;
  invitedAt: string;
  activatedAt: string | null;
  revokedAt: string | null;
}

interface Problem {
  type: string;
  status: number;
  errors?: { path: string; message: string }[];
}

let api: DirectoryApi;

beforeAll(async () => {
  api = await startDirectoryApi();
  return () => api.close();
});

beforeEach(() => api.reset());

const provision = (
  body: unknown = OFFICER,
  {
    code = 'DCI',
    caller = PLATFORM_ADMIN,
    key,
  }: { code?: string; caller?: Caller; key?: string | null } = {},
) =>
  api.post(`/v1/law-enforcement/agencies/${code}/officers`, body, caller, { idempotencyKey: key });

const revoke = (id: string, caller = PLATFORM_ADMIN) =>
  api.post(`/v1/law-enforcement/officers/${id}/revoke`, undefined, caller, {
    idempotencyKey: null,
  });

async function provisioned(body: unknown = OFFICER): Promise<Account> {
  const response = await provision(body);
  expect(response.statusCode).toBe(201);
  return response.json<Account>();
}

const leaEvents = async () =>
  (
    await api.db
      .select({ type: outbox.eventType, envelope: outbox.envelope })
      .from(outbox)
      .orderBy(outbox.id)
  ).filter((event) => event.type.startsWith('lea.account.'));

describe('S11 agencies', () => {
  it('lists the seeded agencies with their legal basis, in display order', async () => {
    const response = await api.get('/v1/law-enforcement/agencies', ACCESS_OFFICER);

    expect(response.statusCode).toBe(200);
    const body = response.json<{ code: string; name: string; legalBasis: string }[]>();
    expect(contractErrors(okResponse('/v1/law-enforcement/agencies', 'get'), body)).toEqual([]);
    expect(body.map((agency) => agency.code)).toEqual(['DCI', 'ODPP', 'ARA', 'FRC']);
    expect(body[0]).toEqual({
      code: 'DCI',
      name: 'Directorate of Criminal Investigations',
      legalBasis: 'National Police Service Act, 2011, s.35',
    });
  });

  it('is reference data for staff and officers, not for declarants', async () => {
    const officer: Caller = { sub: 'lea-1', tenant: 'lea', roles: ['law-enforcement'] };
    expect((await api.get('/v1/law-enforcement/agencies', officer)).statusCode).toBe(200);
    expect((await api.get('/v1/law-enforcement/agencies', DECLARANT)).statusCode).toBe(403);
  });
});

describe('S11 provision', () => {
  it('creates the account with role, tenant lea, agency and person id, and sends one activation email', async () => {
    const response = await provision();

    expect(response.statusCode).toBe(201);
    const body = response.json<Account>();
    expect(
      contractErrors(okResponse('/v1/law-enforcement/agencies/{code}/officers', 'post', 201), body),
    ).toEqual([]);
    expect(body).toMatchObject({
      ...OFFICER,
      agencyCode: 'DCI',
      state: 'invited',
      activatedAt: null,
      revokedAt: null,
    });
    expect(api.identity.calls('createLawEnforcementUser')).toEqual([
      {
        operation: 'createLawEnforcementUser',
        input: { ...OFFICER, agency: 'DCI', personId: body.id },
      },
    ]);
    const emails = api.identity.calls('sendActivationEmail');
    expect(emails).toHaveLength(1);
    expect(emails[0]?.options).toEqual(ACTIVATION);
    expect(api.identity.user(emails[0]?.userId ?? '')).toMatchObject({
      email: OFFICER.email,
      tenant: 'lea',
      agency: 'DCI',
      personId: body.id,
      roles: ['law-enforcement'],
      requiredActions: ['VERIFY_EMAIL', 'UPDATE_PASSWORD', 'CONFIGURE_TOTP'],
      enabled: true,
    });
  });

  it('records a law-enforcement person linked to the account, which services address by id', async () => {
    const officer = await provisioned();
    const userId = api.identity.userByEmail(OFFICER.email)?.userId;

    const [person] = await api.db.select().from(persons).where(eq(persons.id, officer.id));
    expect(person).toMatchObject({
      kind: 'law-enforcement',
      fullName: OFFICER.name,
      email: OFFICER.email,
      phone: OFFICER.phone,
      keycloakUserId: userId,
      nationalId: null,
      ofr: null,
    });

    // Notifications reach the officer by person id, whichever Commission the message is for.
    const contacts = await api.get(`/internal/v1/persons/${officer.id}/contacts`, NOTIFICATIONS, {
      'x-acting-tenant': 'psc',
    });
    expect(contacts.statusCode).toBe(200);
    expect(contacts.json()).toEqual({
      personId: officer.id,
      email: OFFICER.email,
      phone: OFFICER.phone,
    });
  });

  it('records lea.account.provisioned.v1 with ids and the agency only', async () => {
    const officer = await provisioned();
    const userId = api.identity.userByEmail(OFFICER.email)?.userId;

    const events = await leaEvents();
    expect(events.map((event) => event.type)).toEqual(['lea.account.provisioned.v1']);
    expect(events[0]?.envelope).toMatchObject({
      type: 'lea.account.provisioned.v1',
      subject: officer.id,
      tenant: 'lea',
      data: { personId: officer.id, agencyCode: 'DCI', keycloakUserId: userId },
    });
    const serialised = JSON.stringify(events[0]?.envelope);
    expect(serialised).not.toContain(OFFICER.email);
    expect(serialised).not.toContain(OFFICER.name);
    expect(serialised).not.toContain(OFFICER.phone);
  });

  it('is idempotent per Idempotency-Key: one account, one email, one event', async () => {
    const key = randomUUID();
    const first = await provision(OFFICER, { key });
    const again = await provision(OFFICER, { key });

    expect(again.statusCode).toBe(201);
    expect(again.json()).toEqual(first.json());
    expect(api.identity.calls('createLawEnforcementUser')).toHaveLength(1);
    expect(api.identity.calls('sendActivationEmail')).toHaveLength(1);
    expect(await leaEvents()).toHaveLength(1);
  });

  it('provisioning the same officer again corrects name and phone and resends the email while invited', async () => {
    const officer = await provisioned();

    const again = await provision({
      ...OFFICER,
      name: 'Achieng W. Njoroge',
      phone: '+254700111222',
    });

    expect(again.statusCode).toBe(201);
    expect(again.json()).toEqual({
      ...officer,
      name: 'Achieng W. Njoroge',
      phone: '+254700111222',
    });
    expect(api.identity.calls('createLawEnforcementUser')).toHaveLength(1);
    expect(api.identity.calls('sendActivationEmail')).toHaveLength(2);
    expect(api.identity.userByEmail(OFFICER.email)).toMatchObject({
      name: 'Achieng W. Njoroge',
      phone: '+254700111222',
    });
    expect(await leaEvents()).toHaveLength(1);
  });

  it('refuses an email of an officer of another agency, and of an account that is no officer', async () => {
    await provisioned();
    const otherAgency = await provision(OFFICER, { code: 'ODPP' });
    expect(otherAgency.statusCode).toBe(409);
    expect(otherAgency.json<Problem>().type).toBe('lea-officer-of-other-agency');

    api.identity.seedUser({ email: 'kamau@tsc.go.ke', tenant: 'tsc', roles: ['reviewer'] });
    const staff = await provision({ ...OFFICER, email: 'kamau@tsc.go.ke' });
    expect(staff.statusCode).toBe(409);
    const problem = staff.json<Problem>();
    expect(problem.type).toBe('email-belongs-to-other-tenant');
    expect(problem.errors?.map((error) => error.path)).toEqual(['email']);
    expect(contractErrors(componentSchema('ProblemDetails'), problem)).toEqual([]);
    expect(api.identity.calls('createLawEnforcementUser')).toHaveLength(1);
  });

  it('answers 404 for an unknown agency, 400 for an invalid body, 403 for anyone but platform admins', async () => {
    expect((await provision(OFFICER, { code: 'XYZ' })).statusCode).toBe(404);
    const invalid = await provision({ name: 'A', email: 'nope', phone: '0712' });
    expect(invalid.statusCode).toBe(400);
    expect(
      invalid
        .json<Problem>()
        .errors?.map((error) => error.path)
        .sort(),
    ).toEqual(['email', 'name', 'phone']);
    expect((await provision(OFFICER, { caller: ACCESS_OFFICER })).statusCode).toBe(403);
    expect((await provision(OFFICER, { key: null })).statusCode).toBe(400);
    expect(api.identity.calls('createLawEnforcementUser')).toEqual([]);
  });

  it('leaves nothing behind when the identity provider fails', async () => {
    api.identity.failNext('createLawEnforcementUser', new IdentityUnavailable('down'));

    const response = await provision();

    expect(response.statusCode).toBe(502);
    expect(response.json<Problem>().type).toBe('identity-unavailable');
    expect(await api.db.select().from(persons)).toEqual([]);
    expect(await leaEvents()).toEqual([]);
    expect((await provision()).statusCode).toBe(201);
  });

  it('deletes the new account again when the provisioning cannot be recorded', async () => {
    const response = await withOutboxRefusing(api, () => provision());

    expect(response.statusCode).toBe(500);
    const [created] = api.identity.calls('createLawEnforcementUser');
    expect(created).toBeDefined();
    expect(api.identity.userByEmail(OFFICER.email)).toBeUndefined();
    expect(await api.db.select().from(persons)).toEqual([]);
    expect(api.identity.calls('sendActivationEmail')).toEqual([]);
    expect((await provision()).statusCode).toBe(201);
  });

  it('does not take over an account of tenant lea that is no officer', async () => {
    api.identity.seedUser({
      email: 'someone@dci.go.ke',
      tenant: 'lea',
      roles: ['law-enforcement'],
    });

    const response = await provision({ ...OFFICER, email: 'someone@dci.go.ke' });

    expect(response.statusCode).toBe(409);
    expect(response.json<Problem>().type).toBe('email-belongs-to-other-tenant');
    expect(api.identity.calls('createLawEnforcementUser')).toEqual([]);
  });

  it('reports an activation email that was not sent, keeping the officer for a retry', async () => {
    api.identity.failNext('sendActivationEmail', new IdentityUnavailable('smtp down'));

    const response = await provision();

    expect(response.statusCode).toBe(502);
    expect(response.json<Problem>().type).toBe('invitation-not-sent');
    const list = await api.get('/v1/law-enforcement/agencies/DCI/officers', PLATFORM_ADMIN);
    expect(list.json<Account[]>()).toHaveLength(1);
    const retried = await provision();
    expect(retried.statusCode).toBe(201);
    expect(api.identity.calls('sendActivationEmail')).toHaveLength(2);
  });
});

describe('S11 list officers', () => {
  it("lists the agency's officers by name, for platform admins only", async () => {
    await provisioned({ ...OFFICER, name: 'Zawadi Otieno', email: 'zawadi@dci.go.ke' });
    await provisioned();
    await provision({ ...OFFICER, email: 'odpp@odpp.go.ke' }, { code: 'ODPP' });

    const response = await api.get('/v1/law-enforcement/agencies/DCI/officers', PLATFORM_ADMIN);

    expect(response.statusCode).toBe(200);
    const body = response.json<Account[]>();
    expect(
      contractErrors(okResponse('/v1/law-enforcement/agencies/{code}/officers', 'get'), body),
    ).toEqual([]);
    expect(body.map((officer) => officer.name)).toEqual(['Achieng Wafula', 'Zawadi Otieno']);
    expect(
      (await api.get('/v1/law-enforcement/agencies/XYZ/officers', PLATFORM_ADMIN)).statusCode,
    ).toBe(404);
    expect(
      (await api.get('/v1/law-enforcement/agencies/DCI/officers', ACCESS_OFFICER)).statusCode,
    ).toBe(403);
  });
});

describe('S11 revoke', () => {
  it('disables the account, records revoked and lea.account.revoked.v1', async () => {
    const officer = await provisioned();
    const userId = api.identity.userByEmail(OFFICER.email)?.userId;

    const response = await revoke(officer.id);

    expect(response.statusCode).toBe(200);
    const body = response.json<Account>();
    expect(
      contractErrors(okResponse('/v1/law-enforcement/officers/{officerId}/revoke', 'post'), body),
    ).toEqual([]);
    expect(body).toMatchObject({ id: officer.id, state: 'revoked' });
    expect(body.revokedAt).not.toBeNull();
    expect(api.identity.userByEmail(OFFICER.email)?.enabled).toBe(false);
    const events = await leaEvents();
    expect(events.map((event) => event.type)).toEqual([
      'lea.account.provisioned.v1',
      'lea.account.revoked.v1',
    ]);
    expect(events[1]?.envelope).toMatchObject({
      subject: officer.id,
      tenant: 'lea',
      data: { personId: officer.id, agencyCode: 'DCI', keycloakUserId: userId },
    });
  });

  it('changes nothing when revoked again', async () => {
    const officer = await provisioned();
    const first = await revoke(officer.id);

    const again = await revoke(officer.id);

    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual(first.json());
    expect(api.identity.calls('setEnabled')).toHaveLength(1);
    expect(await leaEvents()).toHaveLength(2);
  });

  it('keeps the officer when the identity provider fails', async () => {
    const officer = await provisioned();
    api.identity.failNext('setEnabled', new IdentityUnavailable('down'));

    const response = await revoke(officer.id);

    expect(response.statusCode).toBe(502);
    expect(api.identity.userByEmail(OFFICER.email)?.enabled).toBe(true);
    const list = await api.get('/v1/law-enforcement/agencies/DCI/officers', PLATFORM_ADMIN);
    expect(list.json<Account[]>()[0]?.state).toBe('invited');
  });

  it('answers 404 for an unknown officer, 400 for a malformed id, 403 for anyone but platform admins', async () => {
    const officer = await provisioned();
    expect((await revoke(randomUUID())).statusCode).toBe(404);
    expect((await revoke('not-a-uuid')).statusCode).toBe(400);
    expect((await revoke(officer.id, ACCESS_OFFICER)).statusCode).toBe(403);
  });

  it('provisioning a revoked officer again enables and invites them, with a new event', async () => {
    const officer = await provisioned();
    await revoke(officer.id);

    const response = await provision();

    expect(response.statusCode).toBe(201);
    expect(response.json<Account>()).toMatchObject({
      id: officer.id,
      state: 'invited',
      revokedAt: null,
      activatedAt: null,
    });
    expect(api.identity.userByEmail(OFFICER.email)?.enabled).toBe(true);
    expect(api.identity.calls('sendActivationEmail')).toHaveLength(2);
    expect((await leaEvents()).map((event) => event.type)).toEqual([
      'lea.account.provisioned.v1',
      'lea.account.revoked.v1',
      'lea.account.provisioned.v1',
    ]);
  });
});

describe('S11 activation', () => {
  it("the officer's first authenticated request activates the account, once", async () => {
    const officer = await provisioned();
    const sub = api.identity.userByEmail(OFFICER.email)?.userId ?? '';
    const caller: Caller = { sub, tenant: 'lea', roles: ['law-enforcement'] };

    expect((await api.get('/v1/me', caller)).statusCode).toBe(200);
    expect((await api.get('/v1/me', caller)).statusCode).toBe(200);

    const list = await api.get('/v1/law-enforcement/agencies/DCI/officers', PLATFORM_ADMIN);
    const [activated] = list.json<Account[]>();
    expect(activated).toMatchObject({ id: officer.id, state: 'activated' });
    expect(activated?.activatedAt).not.toBeNull();
    const events = (await leaEvents()).filter((event) => event.type === 'lea.account.activated.v1');
    expect(events).toHaveLength(1);
    expect(events[0]?.envelope).toMatchObject({
      subject: officer.id,
      data: { personId: officer.id, agencyCode: 'DCI', keycloakUserId: sub },
    });
  });

  it('an activated officer provisioned again stays activated and gets no email', async () => {
    await provisioned();
    const sub = api.identity.userByEmail(OFFICER.email)?.userId ?? '';
    await api.get('/v1/me', { sub, tenant: 'lea', roles: ['law-enforcement'] });

    const again = await provision();

    expect(again.json<Account>().state).toBe('activated');
    expect(api.identity.calls('sendActivationEmail')).toHaveLength(1);
  });
});

describe('S11 GET /internal/v1/law-enforcement/officers/{personId} (provenance for access)', () => {
  const ACCESS: Caller = {
    sub: 'service-account-access',
    tenant: 'platform',
    azp: 'access',
    scope: 'profile directory:law-enforcement',
  };
  const ACTING_PSC = { 'x-acting-tenant': 'psc' };
  const path = (personId: string) => `/internal/v1/law-enforcement/officers/${personId}`;

  it("returns the officer's account, agency and state to the access service, audited", async () => {
    const officer = await provisioned();
    const sub = api.identity.userByEmail(OFFICER.email)?.userId ?? '';
    await api.get('/v1/me', { sub, tenant: 'lea', roles: ['law-enforcement'] });

    const response = await api.get(path(officer.id), ACCESS, ACTING_PSC);

    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<Record<string, unknown>>();
    expect(
      contractErrors(okResponse('/internal/v1/law-enforcement/officers/{personId}', 'get'), body),
    ).toEqual([]);
    expect(body).toEqual({
      personId: officer.id,
      keycloakUserId: sub,
      name: OFFICER.name,
      agency: {
        code: 'DCI',
        name: 'Directorate of Criminal Investigations',
        legalBasis: 'National Police Service Act, 2011, s.35',
      },
      state: 'activated',
      activatedAt: expect.any(String) as unknown,
      revokedAt: null,
    });
    const audits = (
      await api.db
        .select({ type: outbox.eventType, envelope: outbox.envelope })
        .from(outbox)
        .orderBy(outbox.id)
    ).filter((event) => event.type === 'audit.read.v1');
    expect(audits.at(-1)?.envelope).toMatchObject({
      tenant: 'psc',
      data: { action: 'lea-officer.read', actor: { subject: 'service-account-access' } },
    });
  });

  it('shows a revoked officer as revoked', async () => {
    const officer = await provisioned();
    await revoke(officer.id);

    const response = await api.get(path(officer.id), ACCESS, ACTING_PSC);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      state: 'revoked',
      revokedAt: expect.any(String) as unknown,
    });
  });

  it('answers 404 for an unknown id, 400 for a bad id or no tenant, 403 without the scope or for a user', async () => {
    const officer = await provisioned();

    expect((await api.get(path(randomUUID()), ACCESS, ACTING_PSC)).statusCode).toBe(404);
    expect((await api.get(path('nope'), ACCESS, ACTING_PSC)).statusCode).toBe(400);
    expect((await api.get(path(officer.id), ACCESS)).statusCode).toBe(400);
    expect(
      (await api.get(path(officer.id), { ...ACCESS, scope: 'profile' }, ACTING_PSC)).statusCode,
    ).toBe(403);
    // Officers' names and accounts are not reference data: directory:internal does not open them.
    expect(
      (
        await api.get(
          path(officer.id),
          {
            ...ACCESS,
            sub: 'service-account-reporting',
            azp: 'reporting',
            scope: 'directory:internal',
          },
          ACTING_PSC,
        )
      ).statusCode,
    ).toBe(403);
    expect((await api.get(path(officer.id), ACCESS_OFFICER, ACTING_PSC)).statusCode).toBe(403);
  });
});
