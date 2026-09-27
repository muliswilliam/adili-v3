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
}

export interface ContractHarness {
  adapter: IdentityProvisioning;
  inspect(userId: string): Promise<InspectedUser>;
  /** Asserts the activation email for `email` was delivered (or recorded). */
  expectActivationDelivered(email: string, userId: string): Promise<void>;
  /** Removes accounts the suite created. */
  cleanup(userIds: string[]): Promise<void>;
}

export const ACTIVATION: ActivationEmailOptions = {
  actions: STAFF_REQUIRED_ACTIONS,
  lifespanSeconds: 72 * 60 * 60,
  redirectUri: 'http://localhost:3020/',
  clientId: 'console',
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
      });
      await expect(harness().adapter.findByEmail(uniqueEmail('nobody'))).resolves.toBeNull();
    });

    it('reports a duplicate email as EmailTaken and keeps the original account', async () => {
      const email = uniqueEmail('duplicate');
      const userId = await create(reportingOfficer(email));

      const duplicate = harness().adapter.createStaffUser({
        ...reportingOfficer(email.toUpperCase()),
        tenant: 'psc',
      });

      await expect(duplicate).rejects.toBeInstanceOf(EmailTaken);
      await expect(harness().adapter.findByEmail(email)).resolves.toEqual({
        userId,
        tenant: 'tsc',
      });
    });

    it('grants a role idempotently', async () => {
      const userId = await create(reportingOfficer(uniqueEmail('grant')));

      await harness().adapter.grantRoleAndEnable(userId, 'reviewer');
      await harness().adapter.grantRoleAndEnable(userId, 'reviewer');

      const { realmRoles } = await harness().inspect(userId);
      expect(realmRoles).toEqual(expect.arrayContaining(['reporting-officer', 'reviewer']));
    });

    it('grants a role back to a disabled user and enables it again', async () => {
      const userId = await create(reportingOfficer(uniqueEmail('reenable')));
      await harness().adapter.revokeRoleAndDisable(userId, 'reporting-officer');

      await harness().adapter.grantRoleAndEnable(userId, 'reporting-officer');

      const user = await harness().inspect(userId);
      expect(user.realmRoles).toContain('reporting-officer');
      expect(user.enabled).toBe(true);
      expect(user.tenant).toBe('tsc');
      expect(user.phone).toBe('+254712345678');
    });

    it('revokes a role and disables the user, keeping the tenant attribute', async () => {
      const userId = await create(reportingOfficer(uniqueEmail('revoke')));

      await harness().adapter.revokeRoleAndDisable(userId, 'reporting-officer');

      const user = await harness().inspect(userId);
      expect(user.realmRoles).not.toContain('reporting-officer');
      expect(user.enabled).toBe(false);
      expect(user.tenant).toBe('tsc');
      expect(user.phone).toBe('+254712345678');
    });

    it('sends the activation email', async () => {
      const email = uniqueEmail('activation');
      const userId = await create(reportingOfficer(email));

      await harness().adapter.sendActivationEmail(userId, ACTIVATION);

      await harness().expectActivationDelivered(email, userId);
    });

    it('reports an unknown user id as IdentityUserNotFound', async () => {
      const { adapter } = harness();

      await expect(adapter.grantRoleAndEnable(UNKNOWN_USER_ID, 'reviewer')).rejects.toBeInstanceOf(
        IdentityUserNotFound,
      );
      await expect(
        adapter.revokeRoleAndDisable(UNKNOWN_USER_ID, 'reporting-officer'),
      ).rejects.toBeInstanceOf(IdentityUserNotFound);
      await expect(adapter.sendActivationEmail(UNKNOWN_USER_ID, ACTIVATION)).rejects.toBeInstanceOf(
        IdentityUserNotFound,
      );
    });
  });
}
