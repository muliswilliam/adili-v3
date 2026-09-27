import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import {
  type ActivationEmailOptions,
  type CreateStaffUserInput,
  EmailTaken,
  type IdentityProvisioning,
  IdentityUserNotFound,
  STAFF_REQUIRED_ACTIONS,
} from '../../src/identity/identity-provisioning.js';

/** An account as the identity provider holds it, read back independently of the adapter. */
export interface InspectedUser {
  username: string;
  email: string;
  /** Given and family names joined. */
  name: string;
  tenant: string | null;
  phone: string | null;
  realmRoles: string[];
  requiredActions: string[];
  enabled: boolean;
  /** Commission and role the latest activation email named. */
  commissionName: string | null;
  invitedRole: string | null;
}

export interface ContractHarness {
  adapter: IdentityProvisioning;
  inspect(userId: string): Promise<InspectedUser>;
  /** Asserts the activation email for `email` was delivered (or recorded), by default ACTIVATION. */
  expectActivationDelivered(
    email: string,
    userId: string,
    options?: ActivationEmailOptions,
  ): Promise<void>;
  /** Removes accounts the suite created. */
  cleanup(userIds: string[]): Promise<void>;
}

export const ACTIVATION: ActivationEmailOptions = {
  actions: STAFF_REQUIRED_ACTIONS,
  lifespanSeconds: 72 * 60 * 60,
  redirectUri: 'http://localhost:3020/auth/login',
  clientId: 'console',
  commissionName: 'Teachers Service Commission',
  role: 'reporting-officer',
};

/** An id no account has (Keycloak ids are UUIDs). */
const UNKNOWN_USER_ID = '00000000-0000-4000-8000-000000000000';

export function uniqueEmail(label: string): string {
  return `${label.toLowerCase()}-${randomUUID()}@contract.adili.test`;
}

export function reportingOfficer(email: string): CreateStaffUserInput {
  return {
    email,
    name: 'Otieno Odhiambo Ouma',
    phone: '+254712345678',
    tenant: 'tsc',
    role: 'reporting-officer',
    requiredActions: STAFF_REQUIRED_ACTIONS,
  };
}

/** Behaviour every IdentityProvisioning adapter must have (spec #6, S17). */
export function identityProvisioningContract(name: string, harness: () => ContractHarness): void {
  describe(`${name} satisfies the identity provisioning contract`, () => {
    const created: string[] = [];

    async function create(input: CreateStaffUserInput): Promise<string> {
      const userId = await harness().adapter.createStaffUser(input);
      created.push(userId);
      return userId;
    }

    afterAll(async () => {
      await harness().cleanup(created);
    });

    it('S17: creates a staff user with the tenant attribute, role and three required actions', async () => {
      const email = uniqueEmail('S17');

      const userId = await create(reportingOfficer(email.toUpperCase()));

      const user = await harness().inspect(userId);
      expect(user).toMatchObject({
        username: email,
        email,
        name: 'Otieno Odhiambo Ouma',
        tenant: 'tsc',
        phone: '+254712345678',
        enabled: true,
      });
      expect(user.realmRoles).toContain('reporting-officer');
      expect([...user.requiredActions].sort()).toEqual(
        ['CONFIGURE_TOTP', 'UPDATE_PASSWORD', 'VERIFY_EMAIL'].sort(),
      );
    });

    it('finds a user by email, case-insensitively, with its tenant', async () => {
      const email = uniqueEmail('find');
      const userId = await create(reportingOfficer(email));

      await expect(harness().adapter.findByEmail(email.toUpperCase())).resolves.toEqual({
        userId,
        tenant: 'tsc',
        enabled: true,
        roles: ['reporting-officer'],
      });
      await expect(harness().adapter.findByEmail(uniqueEmail('nobody'))).resolves.toBeNull();
    });

    it('finds a user by id with its state and directly granted roles, or null', async () => {
      const userId = await create(reportingOfficer(uniqueEmail('byid')));
      await harness().adapter.grantRole(userId, 'reviewer');
      await harness().adapter.setEnabled(userId, false);

      const found = await harness().adapter.findById(userId);

      expect(found).toMatchObject({ userId, tenant: 'tsc', enabled: false });
      expect([...(found?.roles ?? [])].sort()).toEqual(['reporting-officer', 'reviewer']);
      await expect(harness().adapter.findById(UNKNOWN_USER_ID)).resolves.toBeNull();
    });

    it('reports a duplicate email as EmailTaken and keeps the original account', async () => {
      const email = uniqueEmail('duplicate');
      const userId = await create(reportingOfficer(email));

      const duplicate = harness().adapter.createStaffUser({
        ...reportingOfficer(email.toUpperCase()),
        tenant: 'psc',
      });

      await expect(duplicate).rejects.toBeInstanceOf(EmailTaken);
      await expect(harness().adapter.findByEmail(email)).resolves.toMatchObject({
        userId,
        tenant: 'tsc',
      });
    });

    it('grants a role idempotently', async () => {
      const userId = await create(reportingOfficer(uniqueEmail('grant')));

      await harness().adapter.grantRole(userId, 'reviewer');
      await harness().adapter.grantRole(userId, 'reviewer');

      const { realmRoles } = await harness().inspect(userId);
      expect(realmRoles).toEqual(expect.arrayContaining(['reporting-officer', 'reviewer']));
    });

    it('revokes a role idempotently, keeping the account enabled and its attributes', async () => {
      const userId = await create(reportingOfficer(uniqueEmail('revoke')));

      await harness().adapter.revokeRole(userId, 'reporting-officer');
      await harness().adapter.revokeRole(userId, 'reporting-officer');

      const user = await harness().inspect(userId);
      expect(user.realmRoles).not.toContain('reporting-officer');
      expect(user.enabled).toBe(true);
      expect(user.tenant).toBe('tsc');
      expect(user.phone).toBe('+254712345678');
    });

    it('disables and enables an account, keeping its roles and attributes', async () => {
      const userId = await create(reportingOfficer(uniqueEmail('enable')));

      await harness().adapter.setEnabled(userId, false);
      await harness().adapter.setEnabled(userId, false);
      const disabled = await harness().inspect(userId);
      await harness().adapter.setEnabled(userId, true);

      expect(disabled.enabled).toBe(false);
      const enabled = await harness().inspect(userId);
      expect(enabled.enabled).toBe(true);
      for (const user of [disabled, enabled]) {
        expect(user.realmRoles).toContain('reporting-officer');
        expect(user.tenant).toBe('tsc');
        expect(user.phone).toBe('+254712345678');
      }
    });

    it('deletes an account idempotently', async () => {
      const email = uniqueEmail('delete');
      const userId = await harness().adapter.createStaffUser(reportingOfficer(email));

      await harness().adapter.deleteUser(userId);
      await harness().adapter.deleteUser(userId);

      await expect(harness().adapter.findByEmail(email)).resolves.toBeNull();
      await expect(harness().adapter.findById(userId)).resolves.toBeNull();
    });

    it('sends the activation email, naming the Commission and role on the account', async () => {
      const email = uniqueEmail('activation');
      const userId = await create(reportingOfficer(email));

      await harness().adapter.sendActivationEmail(userId, ACTIVATION);

      await harness().expectActivationDelivered(email, userId);
      const user = await harness().inspect(userId);
      expect(user).toMatchObject({
        commissionName: 'Teachers Service Commission',
        invitedRole: 'reporting-officer',
        tenant: 'tsc',
        phone: '+254712345678',
      });
      expect(user.realmRoles).toContain('reporting-officer');
    });

    it('names the Commission of the latest activation email', async () => {
      const email = uniqueEmail('renamed');
      const userId = await create(reportingOfficer(email));
      await harness().adapter.sendActivationEmail(userId, ACTIVATION);
      await harness().expectActivationDelivered(email, userId);

      const renamed = { ...ACTIVATION, commissionName: 'Teachers Service Commission of Kenya' };
      await harness().adapter.sendActivationEmail(userId, renamed);

      await harness().expectActivationDelivered(email, userId, renamed);
      expect((await harness().inspect(userId)).commissionName).toBe(
        'Teachers Service Commission of Kenya',
      );
    });

    it('reports an unknown user id as IdentityUserNotFound', async () => {
      const { adapter } = harness();

      await expect(adapter.grantRole(UNKNOWN_USER_ID, 'reviewer')).rejects.toBeInstanceOf(
        IdentityUserNotFound,
      );
      await expect(adapter.revokeRole(UNKNOWN_USER_ID, 'reviewer')).rejects.toBeInstanceOf(
        IdentityUserNotFound,
      );
      await expect(adapter.setEnabled(UNKNOWN_USER_ID, false)).rejects.toBeInstanceOf(
        IdentityUserNotFound,
      );
      await expect(adapter.sendActivationEmail(UNKNOWN_USER_ID, ACTIVATION)).rejects.toBeInstanceOf(
        IdentityUserNotFound,
      );
    });
  });
}
