import { randomBytes, randomUUID } from 'node:crypto';
import { APPLICANT, DECLARANT, LAW_ENFORCEMENT, LAW_ENFORCEMENT_TENANT } from '@adili/roles';

import {
  type ActivationEmailOptions,
  APPLICANT_REQUIRED_ACTIONS,
  type ApplicantIdentityStatus,
  type CreateApplicantUserInput,
  ApiClientExists,
  ApiClientNotFound,
  type ApiClientSecret,
  type CreateApiClientInput,
  type CreateDeclarantUserInput,
  type CreateLawEnforcementUserInput,
  type CreateStaffUserInput,
  DECLARANT_REQUIRED_ACTIONS,
  EmailTaken,
  type ExecuteActionsEmailOptions,
  IdentityProvisioning,
  type IdentityUser,
  IdentityUserNotFound,
  type RequiredAction,
  type Restore,
  STAFF_REQUIRED_ACTIONS,
  type StaffProfile,
  UsernameTaken,
} from './identity-provisioning.js';

/** Every call made to the fake, in order, with its arguments. */
export type IdentityCall =
  | { operation: 'findByEmail'; email: string }
  | { operation: 'findById'; userId: string }
  | { operation: 'createStaffUser'; input: CreateStaffUserInput }
  | { operation: 'createLawEnforcementUser'; input: CreateLawEnforcementUserInput }
  | { operation: 'createDeclarantUser'; input: CreateDeclarantUserInput }
  | { operation: 'createApplicantUser'; input: CreateApplicantUserInput }
  | { operation: 'setIdentityStatus'; userId: string; status: ApplicantIdentityStatus }
  | { operation: 'addTenantToUser'; userId: string; tenant: string }
  | { operation: 'grantRole'; userId: string; role: string }
  | { operation: 'revokeRole'; userId: string; role: string }
  | { operation: 'setEnabled'; userId: string; enabled: boolean }
  | { operation: 'updateProfile'; userId: string; profile: StaffProfile }
  | { operation: 'deleteUser'; userId: string }
  | { operation: 'sendActivationEmail'; userId: string; options: ActivationEmailOptions }
  | { operation: 'sendExecuteActionsEmail'; userId: string; options: ExecuteActionsEmailOptions }
  | { operation: 'createApiClient'; input: CreateApiClientInput }
  | { operation: 'rotateApiClientSecret'; clientId: string }
  | { operation: 'disableApiClient'; clientId: string };

export type IdentityOperation = IdentityCall['operation'];

/** An account held by the fake. */
export interface InMemoryUser {
  userId: string;
  /** The email for staff and applicant accounts, the OFR for declarants. */
  username: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  phone: string | null;
  tenant: string | null;
  /** The multi-valued `tenants` attribute: every Commission a declarant onboarded with. */
  tenants: string[];
  /** Declarants' officer reference and directory person id attributes. */
  ofr: string | null;
  personId: string | null;
  /** A law-enforcement officer's agency code attribute. */
  agency: string | null;
  /** Applicants' identity status attribute. */
  identityStatus: ApplicantIdentityStatus | null;
  roles: string[];
  requiredActions: RequiredAction[];
  enabled: boolean;
  /** Commission and role named by the latest activation email, as Keycloak records them. */
  commissionName: string | null;
  invitedRole: string | null;
}

/** An API client held by the fake, with what its tokens would carry. */
export interface InMemoryApiClient {
  clientId: string;
  /** The hard-coded `tenant` claim of its tokens. */
  tenant: string;
  /** Client scopes of its tokens (`scope` claim). */
  scopes: string[];
  /** Audience of its tokens. */
  audience: string;
  enabled: boolean;
  /** The current secret; the fake keeps it so tests can check what was handed out. */
  secret: string;
}

export interface SeedUser {
  email: string;
  tenant: string | null;
  /** `[tenant]` (or none) by default. */
  tenants?: string[];
  /** The email by default. */
  username?: string;
  ofr?: string;
  personId?: string;
  agency?: string;
  identityStatus?: ApplicantIdentityStatus;
  userId?: string;
  name?: string;
  phone?: string;
  roles?: string[];
  enabled?: boolean;
}

/**
 * In-memory adapter for API tests: behaves like Keycloak for the provisioning contract,
 * records every call and can be pre-seeded with existing accounts.
 */
export class InMemoryIdentityProvisioning extends IdentityProvisioning {
  private readonly log: IdentityCall[] = [];
  private readonly users = new Map<string, InMemoryUser>();
  private readonly apiClients = new Map<string, InMemoryApiClient>();
  private readonly failures = new Map<IdentityOperation, Error>();

  /** @param audience Audience of API client tokens, as the Keycloak adapter's option. */
  constructor(private readonly audience = 'adili-api') {
    super();
  }

  /** Adds an existing account (for example, one already in another tenant). Returns its id. */
  seedUser(seed: SeedUser): string {
    const userId = seed.userId ?? randomUUID();
    this.users.set(userId, {
      userId,
      username: seed.username ?? normalise(seed.email),
      email: normalise(seed.email),
      emailVerified: false,
      name: seed.name ?? null,
      phone: seed.phone ?? null,
      tenant: seed.tenant,
      tenants: seed.tenants ?? (seed.tenant === null ? [] : [seed.tenant]),
      ofr: seed.ofr ?? null,
      personId: seed.personId ?? null,
      agency: seed.agency ?? null,
      identityStatus: seed.identityStatus ?? null,
      roles: [...(seed.roles ?? [])],
      requiredActions: [],
      enabled: seed.enabled ?? true,
      commissionName: null,
      invitedRole: null,
    });
    return userId;
  }

  /**
   * Makes the next call of `operation` fail with `error` (for example IdentityUnavailable)
   * without any effect. The call is still recorded.
   */
  failNext(operation: IdentityOperation, error: Error): void {
    this.failures.set(operation, error);
  }

  /** Every call so far, or only those of one operation. */
  calls(): readonly IdentityCall[];
  calls<TOperation extends IdentityOperation>(
    operation: TOperation,
  ): readonly Extract<IdentityCall, { operation: TOperation }>[];
  calls(operation?: IdentityOperation): readonly IdentityCall[] {
    return operation ? this.log.filter((call) => call.operation === operation) : [...this.log];
  }

  /** A snapshot of an account, or undefined. */
  user(userId: string): InMemoryUser | undefined {
    const user = this.users.get(userId);
    return user && structuredClone(user);
  }

  /** A snapshot of the account with this email, or undefined. Not recorded as a call. */
  userByEmail(email: string): InMemoryUser | undefined {
    const user = this.byEmail(email);
    return user && structuredClone(user);
  }

  /** A snapshot of an API client, or undefined. Not recorded as a call. */
  apiClient(clientId: string): InMemoryApiClient | undefined {
    const client = this.apiClients.get(clientId);
    return client && structuredClone(client);
  }

  /** Forgets every account, API client and call, for reuse between tests. */
  reset(): void {
    this.log.length = 0;
    this.users.clear();
    this.apiClients.clear();
    this.failures.clear();
  }

  findByEmail(email: string): Promise<IdentityUser | null> {
    this.log.push({ operation: 'findByEmail', email });
    const failure = this.takeFailure('findByEmail');
    if (failure) return Promise.reject(failure);
    return Promise.resolve(identityUser(this.byEmail(email)));
  }

  findById(userId: string): Promise<IdentityUser | null> {
    this.log.push({ operation: 'findById', userId });
    const failure = this.takeFailure('findById');
    if (failure) return Promise.reject(failure);
    return Promise.resolve(identityUser(this.users.get(userId)));
  }

  createStaffUser(input: CreateStaffUserInput): Promise<string> {
    this.log.push({ operation: 'createStaffUser', input: structuredClone(input) });
    const failure = this.takeFailure('createStaffUser');
    if (failure) return Promise.reject(failure);
    if (this.byEmail(input.email)) {
      return Promise.reject(new EmailTaken(input.email));
    }
    const userId = randomUUID();
    this.users.set(userId, {
      userId,
      username: normalise(input.email),
      email: normalise(input.email),
      emailVerified: false,
      name: input.name,
      phone: input.phone,
      tenant: input.tenant,
      tenants: [input.tenant],
      ofr: null,
      personId: null,
      agency: null,
      identityStatus: null,
      roles: [input.role],
      requiredActions: [...input.requiredActions],
      enabled: true,
      commissionName: null,
      invitedRole: null,
    });
    return Promise.resolve(userId);
  }

  createLawEnforcementUser(input: CreateLawEnforcementUserInput): Promise<string> {
    this.log.push({ operation: 'createLawEnforcementUser', input: structuredClone(input) });
    const failure = this.takeFailure('createLawEnforcementUser');
    if (failure) return Promise.reject(failure);
    if (this.byEmail(input.email)) return Promise.reject(new EmailTaken(input.email));
    const userId = randomUUID();
    this.users.set(userId, {
      userId,
      username: normalise(input.email),
      email: normalise(input.email),
      emailVerified: false,
      name: input.name,
      phone: input.phone,
      tenant: LAW_ENFORCEMENT_TENANT,
      tenants: [],
      ofr: null,
      personId: input.personId,
      agency: input.agency,
      identityStatus: null,
      roles: [LAW_ENFORCEMENT],
      requiredActions: [...STAFF_REQUIRED_ACTIONS],
      enabled: true,
      commissionName: null,
      invitedRole: null,
    });
    return Promise.resolve(userId);
  }

  createDeclarantUser(input: CreateDeclarantUserInput): Promise<string> {
    this.log.push({ operation: 'createDeclarantUser', input: structuredClone(input) });
    const failure = this.takeFailure('createDeclarantUser');
    if (failure) return Promise.reject(failure);
    const username = normalise(input.ofr);
    const holder = [...this.users.values()].find((user) => user.username === username);
    if (holder) {
      // A leftover of an attempt that rolled back is replaced; any other holder is not.
      if (holder.ofr !== input.ofr) return Promise.reject(new UsernameTaken(username));
      this.users.delete(holder.userId);
    }
    if (this.byEmail(input.email)) return Promise.reject(new EmailTaken(input.email));
    const userId = randomUUID();
    this.users.set(userId, {
      userId,
      username,
      email: normalise(input.email),
      emailVerified: true,
      name: input.name,
      phone: input.phone,
      tenant: input.tenant,
      tenants: [input.tenant],
      ofr: input.ofr,
      personId: input.personId,
      agency: null,
      identityStatus: null,
      roles: [DECLARANT],
      requiredActions: [...DECLARANT_REQUIRED_ACTIONS],
      enabled: true,
      commissionName: null,
      invitedRole: null,
    });
    return Promise.resolve(userId);
  }

  createApplicantUser(input: CreateApplicantUserInput): Promise<string> {
    this.log.push({ operation: 'createApplicantUser', input: structuredClone(input) });
    const failure = this.takeFailure('createApplicantUser');
    if (failure) return Promise.reject(failure);
    if (this.byEmail(input.email)) return Promise.reject(new EmailTaken(input.email));
    const userId = randomUUID();
    this.users.set(userId, {
      userId,
      username: normalise(input.email),
      email: normalise(input.email),
      emailVerified: false,
      name: `${input.firstName} ${input.lastName}`,
      phone: input.phone,
      tenant: null,
      tenants: [],
      ofr: null,
      personId: input.personId,
      agency: null,
      identityStatus: input.identityStatus,
      roles: [APPLICANT],
      requiredActions: [...APPLICANT_REQUIRED_ACTIONS],
      enabled: true,
      commissionName: null,
      invitedRole: null,
    });
    return Promise.resolve(userId);
  }

  setIdentityStatus(userId: string, status: ApplicantIdentityStatus): Promise<Restore | null> {
    this.log.push({ operation: 'setIdentityStatus', userId, status });
    const failure = this.takeFailure('setIdentityStatus');
    if (failure) return Promise.reject(failure);
    const user = this.users.get(userId);
    if (!user) return Promise.reject(new IdentityUserNotFound(userId));
    const previous = user.identityStatus;
    if (previous === status) return Promise.resolve(null);
    user.identityStatus = status;
    // Not recorded: an undo is not a call the code under test makes.
    return Promise.resolve(() =>
      this.update(userId, (restored) => {
        restored.identityStatus = previous;
      }),
    );
  }

  addTenantToUser(userId: string, tenant: string): Promise<Restore | null> {
    this.log.push({ operation: 'addTenantToUser', userId, tenant });
    const failure = this.takeFailure('addTenantToUser');
    if (failure) return Promise.reject(failure);
    const user = this.users.get(userId);
    if (!user) return Promise.reject(new IdentityUserNotFound(userId));
    if (user.tenants.includes(tenant)) return Promise.resolve(null);
    const setsTenant = user.tenant === null;
    user.tenants.push(tenant);
    user.tenant ??= tenant;
    // Not recorded: an undo is not a call the code under test makes. It takes out this tenant
    // only, as the account is then.
    return Promise.resolve(() =>
      this.update(userId, (restored) => {
        restored.tenants = restored.tenants.filter((held) => held !== tenant);
        if (setsTenant && restored.tenant === tenant) restored.tenant = null;
      }),
    );
  }

  grantRole(userId: string, role: string): Promise<void> {
    this.log.push({ operation: 'grantRole', userId, role });
    const failure = this.takeFailure('grantRole');
    if (failure) return Promise.reject(failure);
    return this.update(userId, (user) => {
      if (!user.roles.includes(role)) {
        user.roles.push(role);
      }
    });
  }

  revokeRole(userId: string, role: string): Promise<void> {
    this.log.push({ operation: 'revokeRole', userId, role });
    const failure = this.takeFailure('revokeRole');
    if (failure) return Promise.reject(failure);
    return this.update(userId, (user) => {
      user.roles = user.roles.filter((held) => held !== role);
    });
  }

  setEnabled(userId: string, enabled: boolean): Promise<void> {
    this.log.push({ operation: 'setEnabled', userId, enabled });
    const failure = this.takeFailure('setEnabled');
    if (failure) return Promise.reject(failure);
    return this.update(userId, (user) => {
      user.enabled = enabled;
    });
  }

  updateProfile(userId: string, profile: StaffProfile): Promise<Restore | null> {
    this.log.push({ operation: 'updateProfile', userId, profile: { ...profile } });
    const failure = this.takeFailure('updateProfile');
    if (failure) return Promise.reject(failure);
    const user = this.users.get(userId);
    if (!user) return Promise.reject(new IdentityUserNotFound(userId));
    const previous = { name: user.name, phone: user.phone };
    if (previous.name === profile.name && previous.phone === profile.phone) {
      return Promise.resolve(null);
    }
    Object.assign(user, profile);
    // Not recorded: an undo is not a call the code under test makes.
    return Promise.resolve(() =>
      this.update(userId, (restored) => Object.assign(restored, previous)),
    );
  }

  deleteUser(userId: string): Promise<void> {
    this.log.push({ operation: 'deleteUser', userId });
    const failure = this.takeFailure('deleteUser');
    if (failure) return Promise.reject(failure);
    this.users.delete(userId);
    return Promise.resolve();
  }

  sendActivationEmail(userId: string, options: ActivationEmailOptions): Promise<void> {
    this.log.push({ operation: 'sendActivationEmail', userId, options: structuredClone(options) });
    const failure = this.takeFailure('sendActivationEmail');
    if (failure) return Promise.reject(failure);
    return this.update(userId, (user) => {
      user.commissionName = options.commissionName;
      user.invitedRole = options.role;
    });
  }

  sendExecuteActionsEmail(userId: string, options: ExecuteActionsEmailOptions): Promise<void> {
    this.log.push({
      operation: 'sendExecuteActionsEmail',
      userId,
      options: structuredClone(options),
    });
    const failure = this.takeFailure('sendExecuteActionsEmail');
    if (failure) return Promise.reject(failure);
    return this.users.has(userId)
      ? Promise.resolve()
      : Promise.reject(new IdentityUserNotFound(userId));
  }

  createApiClient(input: CreateApiClientInput): Promise<ApiClientSecret> {
    this.log.push({ operation: 'createApiClient', input: structuredClone(input) });
    const failure = this.takeFailure('createApiClient');
    if (failure) return Promise.reject(failure);
    if (this.apiClients.has(input.clientId)) {
      return Promise.reject(new ApiClientExists(input.clientId));
    }
    const secret = newSecret();
    this.apiClients.set(input.clientId, {
      clientId: input.clientId,
      tenant: input.tenant,
      scopes: [...input.scopes],
      audience: this.audience,
      enabled: true,
      secret,
    });
    return Promise.resolve({ clientId: input.clientId, secret });
  }

  rotateApiClientSecret(clientId: string): Promise<ApiClientSecret> {
    this.log.push({ operation: 'rotateApiClientSecret', clientId });
    const failure = this.takeFailure('rotateApiClientSecret');
    if (failure) return Promise.reject(failure);
    const client = this.apiClients.get(clientId);
    if (!client) return Promise.reject(new ApiClientNotFound(clientId));
    client.secret = newSecret();
    return Promise.resolve({ clientId, secret: client.secret });
  }

  disableApiClient(clientId: string): Promise<void> {
    this.log.push({ operation: 'disableApiClient', clientId });
    const failure = this.takeFailure('disableApiClient');
    if (failure) return Promise.reject(failure);
    const client = this.apiClients.get(clientId);
    if (client) client.enabled = false;
    return Promise.resolve();
  }

  private takeFailure(operation: IdentityOperation): Error | undefined {
    const failure = this.failures.get(operation);
    this.failures.delete(operation);
    return failure;
  }

  private byEmail(email: string): InMemoryUser | undefined {
    const wanted = normalise(email);
    return [...this.users.values()].find((user) => user.email === wanted);
  }

  private update(userId: string, change: (user: InMemoryUser) => void): Promise<void> {
    const user = this.users.get(userId);
    if (!user) {
      return Promise.reject(new IdentityUserNotFound(userId));
    }
    change(user);
    return Promise.resolve();
  }
}

function identityUser(user: InMemoryUser | undefined): IdentityUser | null {
  return user
    ? { userId: user.userId, tenant: user.tenant, enabled: user.enabled, roles: [...user.roles] }
    : null;
}

/** Random like Keycloak's generated secrets (32 characters). */
function newSecret(): string {
  return randomBytes(24).toString('base64url');
}

function normalise(email: string): string {
  return email.trim().toLowerCase();
}
