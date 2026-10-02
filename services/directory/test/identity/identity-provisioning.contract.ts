import { randomInt, randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import {
  type ActivationEmailOptions,
  ApiClientExists,
  type CreateApplicantUserInput,
  ApiClientNotFound,
  type CreateApiClientInput,
  type CreateDeclarantUserInput,
  type CreateLawEnforcementUserInput,
  type CreateStaffUserInput,
  EmailTaken,
  type ExecuteActionsEmailOptions,
  type IdentityProvisioning,
  IdentityUserNotFound,
  STAFF_REQUIRED_ACTIONS,
} from '../../src/identity/identity-provisioning.js';

/** An account as the identity provider holds it, read back independently of the adapter. */
export interface InspectedUser {
  username: string;
  email: string;
  emailVerified: boolean;
  /** Given and family names joined. */
  name: string;
  tenant: string | null;
  /** The multi-valued `tenants` attribute. */
  tenants: string[];
  ofr: string | null;
  personId: string | null;
  /** A law-enforcement officer's agency code attribute. */
  agency: string | null;
  phone: string | null;
  /** Applicants' `identityStatus` attribute. */
  identityStatus: string | null;
  realmRoles: string[];
  requiredActions: string[];
  enabled: boolean;
  /** Commission and role the latest activation email named. */
  commissionName: string | null;
  invitedRole: string | null;
}

/** What a token obtained with the client credentials grant carries, as services verify it. */
export interface ClientToken {
  tenant: string | null;
  scopes: readonly string[];
  /** `azp`: the client the token was issued to. */
  clientId: string | null;
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
  /** Asserts one execute-actions email for `email` was delivered (or recorded) with `options`. */
  expectExecuteActionsDelivered(
    email: string,
    userId: string,
    options: ExecuteActionsEmailOptions,
  ): Promise<void>;
  /**
   * Obtains a token with the client credentials grant and verifies it for the `adili-api`
   * audience; null when the identity provider refuses the client or secret.
   */
  clientCredentials(clientId: string, secret: string): Promise<ClientToken | null>;
  /** Marks the account's email verified, as its owner does when they activate. */
  verifyEmail(userId: string): Promise<void>;
  /** Removes accounts the suite created. */
  cleanup(userIds: string[]): Promise<void>;
  /** Removes API clients the suite created. */
  cleanupApiClients(clientIds: string[]): Promise<void>;
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

/** The set-password email of a new declarant (spec 03): 24 hours, back to the portal. */
export const SET_PASSWORD: ExecuteActionsEmailOptions = {
  actions: ['UPDATE_PASSWORD'],
  lifespanSeconds: 24 * 60 * 60,
  redirectUri: 'http://localhost:3010/auth/login',
  clientId: 'portal',
};

/** An officer reference no other test run uses (the check character is not checked here). */
export function uniqueOfr(): string {
  return `OFR-${String(randomInt(10_000_000)).padStart(7, '0')}-X`;
}

export function declarant(email: string, ofr = uniqueOfr()): CreateDeclarantUserInput {
  return {
    ofr,
    email,
    name: 'Wanjiru Achieng Otieno',
    phone: '+254712345123',
    tenant: 'tsc',
    personId: randomUUID(),
  };
}

export function lawEnforcementOfficer(email: string): CreateLawEnforcementUserInput {
  return {
    email,
    name: 'Achieng Wafula Njoroge',
    phone: '+254712345987',
    agency: 'DCI',
    personId: randomUUID(),
  };
}

export function applicant(
  email: string,
  identityStatus: CreateApplicantUserInput['identityStatus'] = 'pending-verification',
): CreateApplicantUserInput {
  return {
    email,
    firstName: 'Amina Nakato',
    lastName: 'Okello',
    phone: '+256772123456',
    personId: randomUUID(),
    identityStatus,
  };
}

/** A client id no other test run uses. */
export function uniqueClientId(label: string): string {
  return `contract-${label.toLowerCase()}-${randomUUID().slice(0, 8)}`;
}

export function rosterClient(clientId: string): CreateApiClientInput {
  return { tenant: 'tsc', clientId, scopes: ['roster:write'] };
}

/** Behaviour every IdentityProvisioning adapter must have (spec #6, S17; spec #27, S19). */
export function identityProvisioningContract(name: string, harness: () => ContractHarness): void {
  describe(`${name} satisfies the identity provisioning contract`, () => {
    const created: string[] = [];

    async function create(input: CreateStaffUserInput): Promise<string> {
      const userId = await harness().adapter.createStaffUser(input);
      created.push(userId);
      return userId;
    }

    const createdClients: string[] = [];

    async function createClient(label: string) {
      const clientId = uniqueClientId(label);
      createdClients.push(clientId);
      const issued = await harness().adapter.createApiClient(rosterClient(clientId));
      return issued;
    }

    afterAll(async () => {
      await harness().cleanup(created);
      await harness().cleanupApiClients(createdClients);
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

    it('updates the name and phone, keeping roles and attributes, and restores them exactly', async () => {
      const userId = await create(reportingOfficer(uniqueEmail('profile')));

      const restore = await harness().adapter.updateProfile(userId, {
        name: 'Achieng Atieno',
        phone: '+254733444555',
      });
      const updated = await harness().inspect(userId);
      await restore?.();

      expect(updated).toMatchObject({
        name: 'Achieng Atieno',
        phone: '+254733444555',
        tenant: 'tsc',
        enabled: true,
      });
      expect(updated.realmRoles).toContain('reporting-officer');
      expect(await harness().inspect(userId)).toMatchObject({
        name: 'Otieno Odhiambo Ouma',
        phone: '+254712345678',
        tenant: 'tsc',
      });
    });

    it('changes nothing, and has nothing to restore, when the profile already matches', async () => {
      const userId = await create(reportingOfficer(uniqueEmail('same-profile')));

      await expect(
        harness().adapter.updateProfile(userId, {
          name: 'Otieno Odhiambo Ouma',
          phone: '+254712345678',
        }),
      ).resolves.toBeNull();
    });

    it("lists a Commission's enabled staff with a verified email holding a role", async () => {
      // A tenant of its own, so accounts other runs left in the realm stay out of it.
      const tenant = `c${String(randomInt(1_000_000_000))}`;
      const staff = async (label: string, role: string, options: { tenant?: string } = {}) => {
        const email = uniqueEmail(label);
        const userId = await create({
          ...reportingOfficer(email),
          tenant: options.tenant ?? tenant,
          role,
        });
        await harness().verifyEmail(userId);
        return { subject: userId, email };
      };
      const supervisor = await staff('supervisor', 'supervisor');
      const officer = await staff('officer', 'reporting-officer');
      const disabled = await staff('disabled', 'supervisor');
      await harness().adapter.setEnabled(disabled.subject, false);
      await create({ ...reportingOfficer(uniqueEmail('unverified')), tenant, role: 'supervisor' });
      await staff('elsewhere', 'supervisor', { tenant: `${tenant}x` });

      await expect(harness().adapter.listStaffWithRole(tenant, 'supervisor')).resolves.toEqual([
        supervisor,
      ]);
      await expect(
        harness().adapter.listStaffWithRole(tenant, 'reporting-officer'),
      ).resolves.toEqual([officer]);
      await expect(
        harness().adapter.listStaffWithRole(tenant, 'commission-admin'),
      ).resolves.toEqual([]);
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
      await expect(
        adapter.updateProfile(UNKNOWN_USER_ID, { name: 'Nobody', phone: '+254700000000' }),
      ).rejects.toBeInstanceOf(IdentityUserNotFound);
      await expect(adapter.sendActivationEmail(UNKNOWN_USER_ID, ACTIVATION)).rejects.toBeInstanceOf(
        IdentityUserNotFound,
      );
    });

    it('S11: creates a declarant with the OFR as username, verified email, attributes, role and UPDATE_PASSWORD', async () => {
      const email = uniqueEmail('S11');
      const input = declarant(email.toUpperCase());

      const userId = await harness().adapter.createDeclarantUser(input);
      created.push(userId);

      const user = await harness().inspect(userId);
      // Keycloak keeps usernames lower-case; sign-in with the OFR is case-insensitive.
      expect(user.username).toBe(input.ofr.toLowerCase());
      expect(user).toMatchObject({
        email,
        emailVerified: true,
        name: 'Wanjiru Achieng Otieno',
        tenant: 'tsc',
        tenants: ['tsc'],
        ofr: input.ofr,
        personId: input.personId,
        phone: '+254712345123',
        enabled: true,
        requiredActions: ['UPDATE_PASSWORD'],
      });
      expect(user.realmRoles).toContain('declarant');
      await expect(harness().adapter.findById(userId)).resolves.toMatchObject({
        tenant: 'tsc',
        roles: ['declarant'],
      });
    });

    it('S11: creates a law-enforcement officer with tenant lea, agency, person id, role and the staff required actions', async () => {
      const email = uniqueEmail('S11-lea');
      const input = lawEnforcementOfficer(email.toUpperCase());

      const userId = await harness().adapter.createLawEnforcementUser(input);
      created.push(userId);

      const user = await harness().inspect(userId);
      expect(user).toMatchObject({
        username: email,
        email,
        emailVerified: false,
        name: 'Achieng Wafula Njoroge',
        tenant: 'lea',
        agency: 'DCI',
        personId: input.personId,
        ofr: null,
        phone: '+254712345987',
        enabled: true,
      });
      expect(user.realmRoles).toContain('law-enforcement');
      expect([...user.requiredActions].sort()).toEqual(
        ['CONFIGURE_TOTP', 'UPDATE_PASSWORD', 'VERIFY_EMAIL'].sort(),
      );
      await expect(harness().adapter.findByEmail(email)).resolves.toMatchObject({
        userId,
        tenant: 'lea',
        roles: ['law-enforcement'],
      });
    });

    it('reports a law-enforcement officer whose email has an account as EmailTaken', async () => {
      const email = uniqueEmail('lea-taken');
      await create(reportingOfficer(email));

      await expect(
        harness().adapter.createLawEnforcementUser(lawEnforcementOfficer(email)),
      ).rejects.toBeInstanceOf(EmailTaken);
    });

    it('reports a declarant whose email has an account as EmailTaken', async () => {
      const email = uniqueEmail('declarant-taken');
      await create(reportingOfficer(email));

      await expect(
        harness().adapter.createDeclarantUser(declarant(email.toUpperCase())),
      ).rejects.toBeInstanceOf(EmailTaken);
    });

    it('replaces a declarant account left behind for the same OFR by an attempt that rolled back', async () => {
      const ofr = uniqueOfr();
      // Not cleaned up by the suite: replacing it deletes it.
      const leftover = await harness().adapter.createDeclarantUser(
        declarant(uniqueEmail('leftover'), ofr),
      );
      const email = uniqueEmail('reused-ofr');

      const userId = await harness().adapter.createDeclarantUser(declarant(email, ofr));
      created.push(userId);

      expect(userId).not.toBe(leftover);
      await expect(harness().adapter.findById(leftover)).resolves.toBeNull();
      expect(await harness().inspect(userId)).toMatchObject({ email, ofr });
    });

    it('reports an email taken by another account as EmailTaken even when it also replaced a leftover', async () => {
      const ofr = uniqueOfr();
      // Replaced (deleted) before the email is found taken.
      await harness().adapter.createDeclarantUser(declarant(uniqueEmail('leftover-2'), ofr));
      const taken = uniqueEmail('taken');
      await create(reportingOfficer(taken));

      await expect(
        harness().adapter.createDeclarantUser(declarant(taken, ofr)),
      ).rejects.toBeInstanceOf(EmailTaken);
    });

    it('undoes an added tenant only, keeping one another confirm added meanwhile', async () => {
      const userId = await harness().adapter.createDeclarantUser(declarant(uniqueEmail('undo')));
      created.push(userId);

      const restore = await harness().adapter.addTenantToUser(userId, 'psc');
      await harness().adapter.addTenantToUser(userId, 'jsc');
      await restore?.();

      expect(await harness().inspect(userId)).toMatchObject({
        tenant: 'tsc',
        tenants: ['tsc', 'jsc'],
      });
    });

    it('S15: adds a tenant to the tenants attribute, keeping the first tenant, idempotently, and restores it exactly', async () => {
      const userId = await harness().adapter.createDeclarantUser(declarant(uniqueEmail('S15')));
      created.push(userId);

      const restore = await harness().adapter.addTenantToUser(userId, 'psc');
      const linked = await harness().inspect(userId);
      const again = await harness().adapter.addTenantToUser(userId, 'psc');
      await restore?.();

      expect(linked).toMatchObject({
        tenant: 'tsc',
        tenants: ['tsc', 'psc'],
        phone: '+254712345123',
      });
      expect(linked.realmRoles).toContain('declarant');
      expect(again).toBeNull();
      expect(await harness().inspect(userId)).toMatchObject({ tenant: 'tsc', tenants: ['tsc'] });
      await expect(harness().adapter.addTenantToUser(userId, 'tsc')).resolves.toBeNull();
    });

    it('S1: creates an applicant with the email as username, unverified, no tenant, attributes, role and UPDATE_PASSWORD', async () => {
      const email = uniqueEmail('S1-applicant');
      const input = applicant(email.toUpperCase());

      const userId = await harness().adapter.createApplicantUser(input);
      created.push(userId);

      expect(await harness().inspect(userId)).toMatchObject({
        username: email,
        email,
        emailVerified: false,
        name: 'Amina Nakato Okello',
        tenant: null,
        tenants: [],
        ofr: null,
        personId: input.personId,
        phone: '+256772123456',
        identityStatus: 'pending-verification',
        enabled: true,
        requiredActions: ['UPDATE_PASSWORD'],
      });
      await expect(harness().adapter.findById(userId)).resolves.toMatchObject({
        tenant: null,
        roles: ['applicant'],
      });
    });

    it('reports an applicant whose email has an account as EmailTaken', async () => {
      const email = uniqueEmail('applicant-taken');
      await create(reportingOfficer(email));

      await expect(
        harness().adapter.createApplicantUser(applicant(email.toUpperCase())),
      ).rejects.toBeInstanceOf(EmailTaken);
    });

    it('S2: sets the identity status, idempotently, keeping everything else, and restores it exactly', async () => {
      const userId = await harness().adapter.createApplicantUser(
        applicant(uniqueEmail('identity-status')),
      );
      created.push(userId);

      const restore = await harness().adapter.setIdentityStatus(userId, 'verified');
      const verified = await harness().inspect(userId);
      const again = await harness().adapter.setIdentityStatus(userId, 'verified');
      await restore?.();

      expect(verified).toMatchObject({
        identityStatus: 'verified',
        phone: '+256772123456',
        tenant: null,
      });
      expect(verified.realmRoles).toContain('applicant');
      expect(again).toBeNull();
      expect(await harness().inspect(userId)).toMatchObject({
        identityStatus: 'pending-verification',
      });
      await expect(
        harness().adapter.setIdentityStatus(UNKNOWN_USER_ID, 'verified'),
      ).rejects.toBeInstanceOf(IdentityUserNotFound);
    });

    it('S11, S17: sends an execute-actions email each time it is asked, recording nothing on the account', async () => {
      const email = uniqueEmail('set-password');
      const userId = await harness().adapter.createDeclarantUser(declarant(email));
      created.push(userId);

      await harness().adapter.sendExecuteActionsEmail(userId, SET_PASSWORD);
      await harness().expectExecuteActionsDelivered(email, userId, SET_PASSWORD);
      await harness().adapter.sendExecuteActionsEmail(userId, SET_PASSWORD);
      await harness().expectExecuteActionsDelivered(email, userId, SET_PASSWORD);

      expect(await harness().inspect(userId)).toMatchObject({
        commissionName: null,
        invitedRole: null,
        requiredActions: ['UPDATE_PASSWORD'],
      });
      await expect(
        harness().adapter.sendExecuteActionsEmail(UNKNOWN_USER_ID, SET_PASSWORD),
      ).rejects.toBeInstanceOf(IdentityUserNotFound);
      await expect(
        harness().adapter.addTenantToUser(UNKNOWN_USER_ID, 'psc'),
      ).rejects.toBeInstanceOf(IdentityUserNotFound);
    });

    it('S19: creates an API client whose token carries its scope, its tenant and the API audience', async () => {
      const { clientId, secret } = await createClient('S19');

      expect(secret).toEqual(expect.any(String));
      expect(secret.length).toBeGreaterThanOrEqual(32);
      const token = await harness().clientCredentials(clientId, secret);
      expect(token).toMatchObject({ tenant: 'tsc', clientId });
      expect(token?.scopes).toContain('roster:write');
      await expect(harness().clientCredentials(clientId, 'not-the-secret')).resolves.toBeNull();
    });

    it('S19: rotating the secret stops the previous one at once', async () => {
      const { clientId, secret: previous } = await createClient('rotate');

      const rotated = await harness().adapter.rotateApiClientSecret(clientId);

      expect(rotated.clientId).toBe(clientId);
      expect(rotated.secret).not.toBe(previous);
      await expect(harness().clientCredentials(clientId, previous)).resolves.toBeNull();
      await expect(harness().clientCredentials(clientId, rotated.secret)).resolves.toMatchObject({
        tenant: 'tsc',
      });
    });

    it('S19: a disabled API client obtains no token; disabling is idempotent', async () => {
      const { clientId, secret } = await createClient('disable');

      await harness().adapter.disableApiClient(clientId);
      await harness().adapter.disableApiClient(clientId);

      await expect(harness().clientCredentials(clientId, secret)).resolves.toBeNull();
      await expect(
        harness().adapter.disableApiClient(uniqueClientId('nobody')),
      ).resolves.toBeUndefined();
    });

    it('reports a taken client id as ApiClientExists, even when that client is disabled', async () => {
      const { clientId, secret } = await createClient('duplicate');

      await expect(
        harness().adapter.createApiClient({ ...rosterClient(clientId), tenant: 'psc' }),
      ).rejects.toBeInstanceOf(ApiClientExists);
      await expect(harness().clientCredentials(clientId, secret)).resolves.toMatchObject({
        tenant: 'tsc',
      });
      await harness().adapter.disableApiClient(clientId);
      await expect(
        harness().adapter.createApiClient(rosterClient(clientId)),
      ).rejects.toBeInstanceOf(ApiClientExists);
    });

    it('reports rotating an unknown API client as ApiClientNotFound', async () => {
      await expect(
        harness().adapter.rotateApiClientSecret(uniqueClientId('nobody')),
      ).rejects.toBeInstanceOf(ApiClientNotFound);
    });
  });
}
