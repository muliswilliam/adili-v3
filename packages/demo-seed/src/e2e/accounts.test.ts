import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { KeycloakAdmin } from '../clients/keycloak.js';
import { loadConfig } from '../config.js';
import type { SyntheticOfficer } from '../data/synthetic.js';
import { REPO_ROOT } from '../repo.js';
import {
  checkDomain,
  declarantRow,
  e2eAccounts,
  ensureStaffAccount,
  reportTable,
  SETUP_LINK_LIFESPAN_SECONDS,
  type StaffAccount,
} from './accounts.js';

const realmRoles = (
  JSON.parse(readFileSync(join(REPO_ROOT, 'infra/compose/keycloak/adili-realm.json'), 'utf8')) as {
    roles: { realm: { name: string }[] };
  }
).roles.realm.map((role) => role.name);

describe('e2eAccounts', () => {
  const accounts = e2eAccounts('example.org');

  it('has one account per realm role, each at <role>@<domain>', () => {
    expect(accounts.map((account) => account.role).sort()).toEqual([...realmRoles].sort());
    for (const account of accounts) expect(account.email).toBe(`${account.role}@example.org`);
  });

  it('gives staff an e2e- username and the tenant of their role', () => {
    const staff = accounts.filter((account) => account.kind === 'staff');
    expect(staff).toHaveLength(10);
    expect(Object.fromEntries(staff.map((s) => [s.username, s.tenant]))).toMatchObject({
      'e2e-reviewer': 'psc',
      'e2e-eacc-analyst': 'eacc',
      'e2e-auditor': 'eacc',
      'e2e-platform-admin': 'platform',
    });
  });
});

describe('checkDomain', () => {
  it('accepts a domain, lowercased', () => {
    expect(checkDomain(' Example.ORG ')).toBe('example.org');
  });

  it.each([undefined, '', 'localhost', 'a@b.com', "x.com'; drop", '.example.org', 'ex..org'])(
    'refuses %j',
    (domain) => {
      expect(() => checkDomain(domain)).toThrow(/E2E_EMAIL_DOMAIN/);
    },
  );
});

describe('declarantRow', () => {
  it('is the registry person with the e2e mailbox as email', () => {
    const person = {
      personnelFileNumber: 'PSC/2014/00000',
      fullName: 'Akinyi Grace Kariuki',
      nationalId: '69000000',
      designation: 'Accountant',
      jobGroup: 'J',
      reportingEntity: 'Public Service Commission',
      employerCode: 'PSC',
      appointmentDate: '2014-02-03',
      email: 'akinyi.kariuki.0@example.org',
      phone: '+254790000000',
    } as SyntheticOfficer;
    expect(declarantRow(person, 'declarant@example.org')).toEqual({
      ...person,
      email: 'declarant@example.org',
    });
  });
});

describe('reportTable', () => {
  it('is a Markdown table, one row per account', () => {
    const table = reportTable([
      {
        role: 'reviewer',
        username: 'e2e-reviewer',
        email: 'reviewer@example.org',
        state: 'set up',
        signIn: 'console | password',
        details: 'tenant psc',
        changed: 0,
      },
    ]);
    expect(table.split('\n')).toEqual([
      '| Role | Username | Email | State | Sign in | Details |',
      '| --- | --- | --- | --- | --- | --- |',
      '| reviewer | e2e-reviewer | reviewer@example.org | set up | console / password | tenant psc |',
    ]);
  });
});

interface FakeUser {
  id: string;
  username: string;
  email?: string;
  emailVerified?: boolean;
  firstName?: string;
  lastName?: string;
  attributes?: Record<string, string[]>;
  requiredActions?: string[];
  roles: string[];
}

/** The parts of Keycloak's admin API the staff accounts use, with what they were asked to do. */
function fakeKeycloak() {
  const users = new Map<string, FakeUser>();
  const emails: { userId: string; query: Record<string, string>; actions: string[] }[] = [];
  const body = async (request: IncomingMessage) => {
    let text = '';
    for await (const chunk of request) text += String(chunk);
    return text ? (JSON.parse(text) as unknown) : undefined;
  };
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://keycloak');
      const send = (status: number, payload?: unknown) => {
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(payload === undefined ? '' : JSON.stringify(payload));
      };
      const path = url.pathname.replace('/admin/realms/adili', '');
      const user = /^\/users\/([^/]+)/.exec(path)?.[1];
      const found = user ? users.get(user) : undefined;
      const view = (fakeUser: FakeUser) => ({ ...fakeUser, roles: undefined });
      if (url.pathname === '/realms/master/protocol/openid-connect/token') {
        send(200, { access_token: 'admin-token', expires_in: 60 });
      } else if (request.method === 'GET' && path === '/users') {
        const username = url.searchParams.get('username');
        send(200, [...users.values()].filter((u) => u.username === username).map(view));
      } else if (request.method === 'POST' && path === '/users') {
        const created = (await body(request)) as FakeUser;
        const id = `user-${String(users.size + 1)}`;
        users.set(id, { ...created, id, roles: [] });
        send(201);
      } else if (found && request.method === 'GET' && path === `/users/${found.id}`) {
        send(200, view(found));
      } else if (found && request.method === 'PUT' && path === `/users/${found.id}`) {
        const updated = (await body(request)) as FakeUser;
        users.set(found.id, { ...found, ...updated, roles: found.roles });
        send(204);
      } else if (found && path.endsWith('/role-mappings/realm')) {
        if (request.method === 'GET')
          send(
            200,
            found.roles.map((name) => ({ name })),
          );
        else {
          const granted = (await body(request)) as { name: string }[];
          found.roles.push(...granted.map((role) => role.name));
          send(204);
        }
      } else if (request.method === 'GET' && path.startsWith('/roles/')) {
        const name = decodeURIComponent(path.slice('/roles/'.length));
        send(200, { id: `role-${name}`, name });
      } else if (found && request.method === 'PUT' && path.endsWith('/execute-actions-email')) {
        emails.push({
          userId: found.id,
          query: Object.fromEntries(url.searchParams),
          actions: (await body(request)) as string[],
        });
        send(204);
      } else {
        send(404, { error: `unexpected ${request.method ?? ''} ${url.pathname}` });
      }
    })();
  });
  return { server, users, emails };
}

describe('ensureStaffAccount', () => {
  let fake: ReturnType<typeof fakeKeycloak>;
  let server: Server;
  let keycloak: KeycloakAdmin;
  const reviewer = e2eAccounts('example.org').find(
    (account): account is StaffAccount => account.role === 'reviewer',
  );
  if (!reviewer) throw new Error('no reviewer account');
  const options = { consoleUrl: 'https://console.example.org', resend: false };

  beforeEach(async () => {
    fake = fakeKeycloak();
    server = fake.server;
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
    keycloak = new KeycloakAdmin(loadConfig({ KEYCLOAK_URL: base }));
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('creates a real account: role, tenant, verified email, no demo key, MFA and password to set', async () => {
    const report = await ensureStaffAccount(keycloak, reviewer, options);

    const [user] = [...fake.users.values()];
    expect(user).toMatchObject({
      username: 'e2e-reviewer',
      email: 'reviewer@example.org',
      emailVerified: true,
      firstName: 'E2E',
      lastName: 'Reviewer',
      attributes: {
        tenant: ['psc'],
        commissionName: ['Public Service Commission'],
        invitedRole: ['reviewer'],
      },
      requiredActions: ['CONFIGURE_TOTP', 'UPDATE_PASSWORD'],
      roles: ['reviewer'],
    });
    expect(user?.attributes).not.toHaveProperty('demo_key');
    expect(fake.emails).toEqual([
      {
        userId: user?.id,
        query: {
          lifespan: String(SETUP_LINK_LIFESPAN_SECONDS),
          client_id: 'console',
          redirect_uri: 'https://console.example.org/auth/login',
        },
        actions: ['CONFIGURE_TOTP', 'UPDATE_PASSWORD'],
      },
    ]);
    expect(report).toMatchObject({ state: 'created, setup email sent', changed: 2 });
  });

  it('changes nothing and sends no email on a second run', async () => {
    await ensureStaffAccount(keycloak, reviewer, options);
    const report = await ensureStaffAccount(keycloak, reviewer, options);

    expect(fake.emails).toHaveLength(1);
    expect(report).toMatchObject({ changed: 0 });
    expect(report.state).toMatch(/^setup pending/);
  });

  it('with resend, emails the link again for the actions still pending, and only those', async () => {
    await ensureStaffAccount(keycloak, reviewer, options);
    const [user] = [...fake.users.values()];
    if (user) user.requiredActions = ['UPDATE_PASSWORD'];

    const report = await ensureStaffAccount(keycloak, reviewer, { ...options, resend: true });

    expect(fake.emails.map((email) => email.actions)).toEqual([
      ['CONFIGURE_TOTP', 'UPDATE_PASSWORD'],
      ['UPDATE_PASSWORD'],
    ]);
    expect(report.state).toBe('setup email sent again');
  });

  it('sends nothing to an account that has set up, even with resend', async () => {
    await ensureStaffAccount(keycloak, reviewer, options);
    const [user] = [...fake.users.values()];
    if (user) user.requiredActions = [];

    const report = await ensureStaffAccount(keycloak, reviewer, { ...options, resend: true });

    expect(fake.emails).toHaveLength(1);
    expect(report).toMatchObject({ state: 'set up', changed: 0 });
  });

  it('puts back a drifted account: a demo key removed, the tenant and role restored', async () => {
    fake.users.set('user-1', {
      id: 'user-1',
      username: 'e2e-reviewer',
      email: 'reviewer@example.org',
      attributes: { tenant: ['tsc'], demo_key: ['reviewer'], phone: ['+254700000000'] },
      requiredActions: [],
      roles: [],
    });

    const report = await ensureStaffAccount(keycloak, reviewer, options);

    expect(fake.users.get('user-1')).toMatchObject({
      attributes: {
        tenant: ['psc'],
        phone: ['+254700000000'],
        commissionName: ['Public Service Commission'],
        invitedRole: ['reviewer'],
      },
      roles: ['reviewer'],
    });
    expect(fake.users.get('user-1')?.attributes).not.toHaveProperty('demo_key');
    expect(fake.emails).toHaveLength(0);
    expect(report.changed).toBe(2);
  });
});
