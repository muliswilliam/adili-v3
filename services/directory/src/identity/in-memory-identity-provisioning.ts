import { randomUUID } from 'node:crypto';

import {
  type ActivationEmailOptions,
  type CreateStaffUserInput,
  EmailTaken,
  IdentityProvisioning,
  type IdentityUser,
  IdentityUserNotFound,
  type RequiredAction,
} from './identity-provisioning.js';

/** Every call made to the fake, in order, with its arguments. */
export type IdentityCall =
  | { operation: 'findByEmail'; email: string }
  | { operation: 'findById'; userId: string }
  | { operation: 'createStaffUser'; input: CreateStaffUserInput }
  | { operation: 'grantRole'; userId: string; role: string }
  | { operation: 'revokeRole'; userId: string; role: string }
  | { operation: 'setEnabled'; userId: string; enabled: boolean }
  | { operation: 'deleteUser'; userId: string }
  | { operation: 'sendActivationEmail'; userId: string; options: ActivationEmailOptions };

export type IdentityOperation = IdentityCall['operation'];

/** An account held by the fake. */
export interface InMemoryUser {
  userId: string;
  email: string;
  name: string | null;
  phone: string | null;
  tenant: string | null;
  roles: string[];
  requiredActions: RequiredAction[];
  enabled: boolean;
}

export interface SeedUser {
  email: string;
  tenant: string | null;
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
  private readonly failures = new Map<IdentityOperation, Error>();

  /** Adds an existing account (for example, one already in another tenant). Returns its id. */
  seedUser(seed: SeedUser): string {
    const userId = seed.userId ?? randomUUID();
    this.users.set(userId, {
      userId,
      email: normalise(seed.email),
      name: seed.name ?? null,
      phone: seed.phone ?? null,
      tenant: seed.tenant,
      roles: [...(seed.roles ?? [])],
      requiredActions: [],
      enabled: seed.enabled ?? true,
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

  /** Forgets every account and call, for reuse between tests. */
  reset(): void {
    this.log.length = 0;
    this.users.clear();
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
      email: normalise(input.email),
      name: input.name,
      phone: input.phone,
      tenant: input.tenant,
      roles: [input.role],
      requiredActions: [...input.requiredActions],
      enabled: true,
    });
    return Promise.resolve(userId);
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
    return this.update(userId, () => undefined);
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

function normalise(email: string): string {
  return email.trim().toLowerCase();
}
