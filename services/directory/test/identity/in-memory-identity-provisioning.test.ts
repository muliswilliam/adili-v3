import { describe, expect, it } from 'vitest';

import { IdentityUnavailable, UsernameTaken } from '../../src/identity/identity-provisioning.js';
import { InMemoryIdentityProvisioning } from '../../src/identity/in-memory-identity-provisioning.js';
import {
  ACTIVATION,
  declarant,
  identityProvisioningContract,
  reportingOfficer,
  uniqueEmail,
} from './identity-provisioning.contract.js';

const fake = new InMemoryIdentityProvisioning();

identityProvisioningContract('InMemoryIdentityProvisioning', () => ({
  adapter: fake,
  inspect: (userId) => {
    const user = fake.user(userId);
    if (!user) {
      throw new Error(`No user ${userId}`);
    }
    return Promise.resolve({
      username: user.username,
      email: user.email,
      emailVerified: user.emailVerified,
      name: user.name ?? '',
      tenant: user.tenant,
      tenants: user.tenants,
      ofr: user.ofr,
      personId: user.personId,
      phone: user.phone,
      realmRoles: user.roles,
      requiredActions: user.requiredActions,
      enabled: user.enabled,
      commissionName: user.commissionName,
      invitedRole: user.invitedRole,
    });
  },
  expectActivationDelivered: (_email, userId, options = ACTIVATION) => {
    expect(fake.calls('sendActivationEmail')).toContainEqual({
      operation: 'sendActivationEmail',
      userId,
      options,
    });
    return Promise.resolve();
  },
  expectExecuteActionsDelivered: (_email, userId, options) => {
    expect(fake.calls('sendExecuteActionsEmail')).toContainEqual({
      operation: 'sendExecuteActionsEmail',
      userId,
      options,
    });
    return Promise.resolve();
  },
  clientCredentials: (clientId, secret) => {
    const client = fake.apiClient(clientId);
    const admitted = client?.enabled && client.secret === secret && client.audience === 'adili-api';
    return Promise.resolve(
      admitted ? { tenant: client.tenant, scopes: client.scopes, clientId: client.clientId } : null,
    );
  },
  cleanup: () => {
    fake.reset();
    return Promise.resolve();
  },
  cleanupApiClients: () => Promise.resolve(),
}));

describe('InMemoryIdentityProvisioning', () => {
  it('records every call in order with its arguments', async () => {
    const identity = new InMemoryIdentityProvisioning();
    const input = reportingOfficer('officer@tsc.go.ke');

    await identity.findByEmail('officer@tsc.go.ke');
    const userId = await identity.createStaffUser(input);
    await identity.grantRole(userId, 'reviewer');
    await identity.sendActivationEmail(userId, ACTIVATION);
    await identity.revokeRole(userId, 'reporting-officer');
    await identity.setEnabled(userId, false);
    await identity.findById(userId);
    await identity.deleteUser(userId);

    expect(identity.calls()).toEqual([
      { operation: 'findByEmail', email: 'officer@tsc.go.ke' },
      { operation: 'createStaffUser', input },
      { operation: 'grantRole', userId, role: 'reviewer' },
      { operation: 'sendActivationEmail', userId, options: ACTIVATION },
      { operation: 'revokeRole', userId, role: 'reporting-officer' },
      { operation: 'setEnabled', userId, enabled: false },
      { operation: 'findById', userId },
      { operation: 'deleteUser', userId },
    ]);
    expect(identity.calls('createStaffUser')).toEqual([{ operation: 'createStaffUser', input }]);
  });

  it('records API client calls and holds what their tokens would carry', async () => {
    const identity = new InMemoryIdentityProvisioning('adili-test-api');
    const input = { tenant: 'psc', clientId: 'roster-psc-1', scopes: ['roster:write'] };

    const created = await identity.createApiClient(input);
    const rotated = await identity.rotateApiClientSecret('roster-psc-1');
    await identity.disableApiClient('roster-psc-1');

    expect(identity.calls()).toEqual([
      { operation: 'createApiClient', input },
      { operation: 'rotateApiClientSecret', clientId: 'roster-psc-1' },
      { operation: 'disableApiClient', clientId: 'roster-psc-1' },
    ]);
    expect(created.secret).not.toBe(rotated.secret);
    expect(identity.apiClient('roster-psc-1')).toEqual({
      clientId: 'roster-psc-1',
      tenant: 'psc',
      scopes: ['roster:write'],
      audience: 'adili-test-api',
      enabled: false,
      secret: rotated.secret,
    });
  });

  it('records calls that fail', async () => {
    const identity = new InMemoryIdentityProvisioning();
    identity.seedUser({ email: 'taken@psc.go.ke', tenant: 'psc' });

    await expect(identity.createStaffUser(reportingOfficer('taken@psc.go.ke'))).rejects.toThrow();

    expect(identity.calls('createStaffUser')).toHaveLength(1);
  });

  it('fails the next call of an operation on request, without effect, then recovers', async () => {
    const identity = new InMemoryIdentityProvisioning();
    const outage = new IdentityUnavailable('Keycloak is down');
    identity.failNext('createStaffUser', outage);

    await expect(identity.createStaffUser(reportingOfficer('new@tsc.go.ke'))).rejects.toBe(outage);
    await expect(identity.findByEmail('new@tsc.go.ke')).resolves.toBeNull();
    await expect(identity.createStaffUser(reportingOfficer('new@tsc.go.ke'))).resolves.toEqual(
      expect.any(String),
    );
    expect(identity.calls('createStaffUser')).toHaveLength(2);
  });

  it('can be seeded with users per tenant', async () => {
    const identity = new InMemoryIdentityProvisioning();
    const pscOfficer = identity.seedUser({
      email: 'Officer@PSC.go.ke',
      tenant: 'psc',
      roles: ['reporting-officer'],
    });
    const tscOfficer = identity.seedUser({ email: 'officer@tsc.go.ke', tenant: 'tsc' });
    const tenantless = identity.seedUser({
      email: 'someone@example.com',
      tenant: null,
      userId: 'fixed-id',
    });

    await expect(identity.findByEmail('officer@psc.go.ke')).resolves.toEqual({
      userId: pscOfficer,
      tenant: 'psc',
      enabled: true,
      roles: ['reporting-officer'],
    });
    await expect(identity.findByEmail('officer@tsc.go.ke')).resolves.toEqual({
      userId: tscOfficer,
      tenant: 'tsc',
      enabled: true,
      roles: [],
    });
    await expect(identity.findByEmail('someone@example.com')).resolves.toMatchObject({
      userId: 'fixed-id',
      tenant: null,
    });
    expect(tenantless).toBe('fixed-id');
    expect(identity.user(pscOfficer)?.roles).toEqual(['reporting-officer']);
  });

  it('hands out snapshots, not live state', async () => {
    const identity = new InMemoryIdentityProvisioning();
    const userId = identity.seedUser({ email: 'a@psc.go.ke', tenant: 'psc' });

    const before = identity.user(userId);
    await identity.grantRole(userId, 'reviewer');

    expect(before?.roles).toEqual([]);
    expect(identity.user(userId)?.roles).toEqual(['reviewer']);
  });

  it('forgets users and calls on reset', async () => {
    const identity = new InMemoryIdentityProvisioning();
    identity.seedUser({ email: 'a@psc.go.ke', tenant: 'psc' });
    await identity.findByEmail('a@psc.go.ke');

    identity.reset();

    expect(identity.calls()).toEqual([]);
    await expect(identity.findByEmail('a@psc.go.ke')).resolves.toBeNull();
  });

  it('refuses an OFR held by an account that is not a leftover declarant account', async () => {
    const identity = new InMemoryIdentityProvisioning();
    const holder = identity.seedUser({
      email: 'holder@psc.go.ke',
      username: 'ofr-0000001-x',
      tenant: null,
    });

    await expect(
      identity.createDeclarantUser(declarant(uniqueEmail('blocked'), 'OFR-0000001-X')),
    ).rejects.toBeInstanceOf(UsernameTaken);
    expect(identity.user(holder)).toBeDefined();
  });
});
