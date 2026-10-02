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
  IdentityUnavailable,
  type IdentityUser,
  IdentityUserNotFound,
  type Restore,
  STAFF_REQUIRED_ACTIONS,
  type StaffContact,
  type StaffProfile,
  UsernameTaken,
} from './identity-provisioning.js';

export interface KeycloakIdentityOptions {
  /** Realm issuer, e.g. `http://localhost:8080/realms/adili`; admin and token URLs derive from it. */
  issuerUrl: string;
  /**
   * Confidential client with a service account holding the realm-management user and client
   * roles (`manage-users`, `manage-clients` and their view and query roles).
   */
  clientId: string;
  clientSecret: string;
  /** Audience of API client tokens: the one services verify (`OIDC_AUDIENCE`). */
  audience?: string;
  /** Per-request timeout. */
  timeoutMs?: number;
  /** Replaceable for tests. */
  fetch?: typeof fetch;
}

interface UserRepresentation {
  id: string;
  username?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  enabled?: boolean;
  emailVerified?: boolean;
  attributes?: Record<string, string[]>;
  [field: string]: unknown;
}

interface ClientRepresentation {
  id: string;
  clientId: string;
  enabled?: boolean;
  [field: string]: unknown;
}

interface RoleRepresentation {
  id: string;
  name: string;
}

interface RequestOptions {
  query?: Record<string, string>;
  body?: unknown;
  /** Map a 404 to IdentityUserNotFound for this user id. */
  userId?: string;
  /** Overrides the adapter's per-request timeout. */
  timeoutMs?: number;
}

/**
 * Keycloak sends the execute-actions email over SMTP before it answers, with its own SMTP
 * connect and read timeouts of 10 seconds each. Waiting less could abandon an email that is
 * still delivered, reporting a failure for an invitation the officer receives.
 */
export const ACTIVATION_EMAIL_TIMEOUT_MS = 25_000;

/**
 * Account attributes the activation email is rendered from (apps/keycloak-theme
 * `src/email`). Declared admin-only in the realm's user profile, so users cannot change them.
 */
export const COMMISSION_NAME_ATTRIBUTE = 'commissionName';
export const INVITED_ROLE_ATTRIBUTE = 'invitedRole';

/** An applicant account's identity status (spec 10), admin-only in the realm's user profile. */
export const IDENTITY_STATUS_ATTRIBUTE = 'identityStatus';

/** Refresh the service-account token this long before Keycloak says it expires. */
const TOKEN_EXPIRY_MARGIN_MS = 30_000;

/**
 * Client scope every API client token carries besides its own: `sub` (the service account)
 * and the other basic claims TokenVerifier relies on.
 */
const BASIC_CLIENT_SCOPE = 'basic';

/**
 * Keycloak Admin REST adapter. Authenticates with client credentials as the `directory`
 * service client; the realm import grants its service account `manage-users`,
 * `view-users`, `query-users`, `manage-clients`, `view-clients`, `query-clients` and
 * `view-realm`.
 */
/** Accounts read per page when listing a Commission's staff. */
const STAFF_PAGE = 100;

export class KeycloakIdentityProvisioning extends IdentityProvisioning {
  private readonly adminUrl: string;
  /** The realm's composite default role, which every account holds (`default-roles-<realm>`). */
  private readonly defaultRole: string;
  private readonly tokenUrl: string;
  private readonly timeoutMs: number;
  private readonly audience: string;
  private readonly fetch: typeof fetch;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(private readonly options: KeycloakIdentityOptions) {
    super();
    const issuer = /^(?<base>.+)\/realms\/(?<realm>[^/]+)\/?$/.exec(options.issuerUrl)?.groups;
    if (!issuer?.base || !issuer.realm) {
      throw new Error(`Not a Keycloak realm issuer URL: ${options.issuerUrl}`);
    }
    this.adminUrl = `${issuer.base}/admin/realms/${issuer.realm}`;
    this.defaultRole = `default-roles-${issuer.realm}`;
    this.tokenUrl = `${issuer.base}/realms/${issuer.realm}/protocol/openid-connect/token`;
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.audience = options.audience ?? 'adili-api';
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  async findByEmail(email: string): Promise<IdentityUser | null> {
    const wanted = keycloakEmail(email);
    const response = await this.request('GET', '/users', {
      query: { email: wanted, exact: 'true', briefRepresentation: 'false' },
    });
    const users = (await response.json()) as UserRepresentation[];
    const user = users.find((candidate) => candidate.email?.toLowerCase() === wanted);
    return user ? this.identityUser(user) : null;
  }

  async findById(userId: string): Promise<IdentityUser | null> {
    try {
      return await this.identityUser(await this.user(userId));
    } catch (error) {
      if (error instanceof IdentityUserNotFound) return null;
      throw error;
    }
  }

  async listStaffWithRole(tenant: string, role: string): Promise<StaffContact[]> {
    // The role's holders across the realm (view-realm), then those at the Commission. Staff
    // roles are granted directly, never through groups or composites, so the role's own user
    // list holds them all; declarants never hold one, so the read stays as small as the staff.
    const staff: StaffContact[] = [];
    for (let first = 0; ; first += STAFF_PAGE) {
      const response = await this.request('GET', `/roles/${encodeURIComponent(role)}/users`, {
        query: { briefRepresentation: 'false', first: String(first), max: String(STAFF_PAGE) },
      });
      const page = (await response.json()) as UserRepresentation[];
      for (const user of page) {
        const email = user.email;
        const reachable =
          user.enabled !== false &&
          user.emailVerified === true &&
          email !== undefined &&
          user.attributes?.tenant?.[0] === tenant;
        const name = [user.firstName, user.lastName].filter(Boolean).join(' ');
        if (reachable) staff.push({ subject: user.id, email, name: name || email });
      }
      if (page.length < STAFF_PAGE) break;
    }
    return staff;
  }

  async createStaffUser(input: CreateStaffUserInput): Promise<string> {
    const email = keycloakEmail(input.email);
    return this.createUser(
      {
        username: email,
        email,
        ...splitName(input.name),
        enabled: true,
        emailVerified: false,
        attributes: { tenant: [input.tenant], phone: [input.phone] },
        requiredActions: input.requiredActions,
      },
      input.role,
    );
  }

  async createLawEnforcementUser(input: CreateLawEnforcementUserInput): Promise<string> {
    const email = keycloakEmail(input.email);
    return this.createUser(
      {
        username: email,
        email,
        ...splitName(input.name),
        enabled: true,
        emailVerified: false,
        attributes: {
          tenant: [LAW_ENFORCEMENT_TENANT],
          agency: [input.agency],
          person_id: [input.personId],
          phone: [input.phone],
        },
        requiredActions: STAFF_REQUIRED_ACTIONS,
      },
      LAW_ENFORCEMENT,
    );
  }

  async createDeclarantUser(input: CreateDeclarantUserInput): Promise<string> {
    const representation = {
      username: input.ofr,
      email: keycloakEmail(input.email),
      ...splitName(input.name),
      enabled: true,
      emailVerified: true,
      attributes: {
        tenant: [input.tenant],
        tenants: [input.tenant],
        ofr: [input.ofr],
        person_id: [input.personId],
        phone: [input.phone],
      },
      requiredActions: DECLARANT_REQUIRED_ACTIONS,
    };
    try {
      return await this.createUser(representation, DECLARANT);
    } catch (error) {
      if (!(error instanceof UsernameTaken)) throw error;
      const leftover = await this.userByUsername(input.ofr);
      if (leftover?.attributes?.ofr?.[0] !== input.ofr) throw error;
      await this.deleteUser(leftover.id);
      return this.createUser(representation, DECLARANT);
    }
  }

  async createApplicantUser(input: CreateApplicantUserInput): Promise<string> {
    const email = keycloakEmail(input.email);
    return this.createUser(
      {
        username: email,
        email,
        firstName: input.firstName,
        lastName: input.lastName,
        enabled: true,
        // The set-password link proves the email (Keycloak marks it verified when it is used).
        emailVerified: false,
        attributes: {
          person_id: [input.personId],
          phone: [input.phone],
          [IDENTITY_STATUS_ATTRIBUTE]: [input.identityStatus],
        },
        requiredActions: APPLICANT_REQUIRED_ACTIONS,
      },
      APPLICANT,
    );
  }

  async setIdentityStatus(
    userId: string,
    status: ApplicantIdentityStatus,
  ): Promise<Restore | null> {
    const user = await this.user(userId);
    const previous = user.attributes?.[IDENTITY_STATUS_ATTRIBUTE];
    if (previous?.length === 1 && previous[0] === status) return null;
    await this.putUser(userId, withAttribute(user, IDENTITY_STATUS_ATTRIBUTE, [status]));
    return async () => {
      await this.putUser(
        userId,
        withAttribute(await this.user(userId), IDENTITY_STATUS_ATTRIBUTE, previous),
      );
    };
  }

  async addTenantToUser(userId: string, tenant: string): Promise<Restore | null> {
    const user = await this.user(userId);
    const previous = { tenant: user.attributes?.tenant, tenants: user.attributes?.tenants };
    const tenants = previous.tenants ?? previous.tenant ?? [];
    if (tenants.includes(tenant)) return null;
    const setsTenant = !previous.tenant?.length;
    await this.putUser(userId, {
      ...user,
      attributes: {
        ...user.attributes,
        tenant: previous.tenant?.length ? previous.tenant : [tenant],
        tenants: [...tenants, tenant],
      },
    });
    // Undoes this change only, on the account as it is then: a tenant another confirm added
    // meanwhile stays.
    return async () => {
      const current = await this.user(userId);
      const {
        tenant: currentTenant,
        tenants: currentTenants,
        ...others
      } = current.attributes ?? {};
      const keptTenant =
        setsTenant && currentTenant?.length === 1 && currentTenant[0] === tenant
          ? undefined
          : currentTenant;
      await this.putUser(userId, {
        ...current,
        attributes: {
          ...others,
          ...(keptTenant === undefined ? {} : { tenant: keptTenant }),
          tenants: (currentTenants ?? []).filter((held) => held !== tenant),
        },
      });
    };
  }

  async grantRole(userId: string, role: string): Promise<void> {
    await this.grantRealmRole(userId, role);
  }

  async revokeRole(userId: string, role: string): Promise<void> {
    const held = await this.realmRoles(userId, 'held');
    const representation = held.find((candidate) => candidate.name === role);
    if (representation) {
      await this.request('DELETE', `/users/${userId}/role-mappings/realm`, {
        body: [representation],
        userId,
      });
    }
  }

  async setEnabled(userId: string, enabled: boolean): Promise<void> {
    const user = await this.user(userId);
    if (user.enabled !== enabled) await this.putUser(userId, { ...user, enabled });
  }

  async updateProfile(userId: string, profile: StaffProfile): Promise<Restore | null> {
    const user = await this.user(userId);
    const previous = profileOf(user);
    const wanted = { ...splitName(profile.name), phone: profile.phone };
    if (
      previous.firstName === wanted.firstName &&
      previous.lastName === wanted.lastName &&
      previous.phone === wanted.phone
    ) {
      return null;
    }
    await this.putUser(userId, withProfile(user, wanted));
    return async () => {
      await this.putUser(userId, withProfile(await this.user(userId), previous));
    };
  }

  async deleteUser(userId: string): Promise<void> {
    try {
      await this.request('DELETE', `/users/${userId}`, { userId });
    } catch (error) {
      if (!(error instanceof IdentityUserNotFound)) throw error;
    }
  }

  async sendActivationEmail(userId: string, options: ActivationEmailOptions): Promise<void> {
    // The Adili email theme renders these (admin-only) attributes into the email.
    const user = await this.user(userId);
    const invitation = {
      [COMMISSION_NAME_ATTRIBUTE]: [options.commissionName],
      [INVITED_ROLE_ATTRIBUTE]: [options.role],
    };
    const recorded = Object.entries(invitation).every(
      ([name, value]) => user.attributes?.[name]?.[0] === value[0],
    );
    if (!recorded) {
      await this.putUser(userId, { ...user, attributes: { ...user.attributes, ...invitation } });
    }
    await this.sendExecuteActionsEmail(userId, options);
  }

  async sendExecuteActionsEmail(
    userId: string,
    options: ExecuteActionsEmailOptions,
  ): Promise<void> {
    await this.request('PUT', `/users/${userId}/execute-actions-email`, {
      query: {
        lifespan: String(options.lifespanSeconds),
        redirect_uri: options.redirectUri,
        client_id: options.clientId,
      },
      body: options.actions,
      userId,
      timeoutMs: ACTIVATION_EMAIL_TIMEOUT_MS,
    });
  }

  async createApiClient(input: CreateApiClientInput): Promise<ApiClientSecret> {
    const response = await this.request('POST', '/clients', {
      body: {
        clientId: input.clientId,
        name: `API client of ${input.tenant}`,
        enabled: true,
        protocol: 'openid-connect',
        publicClient: false,
        clientAuthenticatorType: 'client-secret',
        serviceAccountsEnabled: true,
        standardFlowEnabled: false,
        implicitFlowEnabled: false,
        directAccessGrantsEnabled: false,
        frontchannelLogout: false,
        defaultClientScopes: [BASIC_CLIENT_SCOPE, ...input.scopes],
        optionalClientScopes: [],
        protocolMappers: [
          {
            name: 'tenant',
            protocol: 'openid-connect',
            protocolMapper: 'oidc-hardcoded-claim-mapper',
            config: {
              'claim.name': 'tenant',
              'claim.value': input.tenant,
              'jsonType.label': 'String',
              'access.token.claim': 'true',
              'id.token.claim': 'false',
              'userinfo.token.claim': 'false',
              'introspection.token.claim': 'true',
            },
          },
          {
            name: `${this.audience} audience`,
            protocol: 'openid-connect',
            protocolMapper: 'oidc-audience-mapper',
            config: {
              'included.custom.audience': this.audience,
              'access.token.claim': 'true',
              'id.token.claim': 'false',
              'introspection.token.claim': 'true',
            },
          },
        ],
      },
    }).catch((error: unknown) => {
      throw error instanceof KeycloakHttpError && error.status === 409
        ? new ApiClientExists(input.clientId)
        : error;
    });
    const id = response.headers.get('location')?.split('/').pop();
    if (!id) {
      throw new IdentityUnavailable('Keycloak created the client without returning its location');
    }
    try {
      return { clientId: input.clientId, secret: await this.clientSecret(id) };
    } catch (error) {
      // Nobody could use a client whose secret was never seen; the caller creates it again.
      await this.request('DELETE', `/clients/${id}`).catch(() => undefined);
      throw error;
    }
  }

  async rotateApiClientSecret(clientId: string): Promise<ApiClientSecret> {
    const client = await this.client(clientId);
    if (!client) throw new ApiClientNotFound(clientId);
    const response = await this.request('POST', `/clients/${client.id}/client-secret`);
    return { clientId, secret: secretOf(await response.json()) };
  }

  async disableApiClient(clientId: string): Promise<void> {
    const client = await this.client(clientId);
    if (client && client.enabled !== false) {
      await this.request('PUT', `/clients/${client.id}`, { body: { ...client, enabled: false } });
    }
  }

  /**
   * Creates the account and grants it `role`; returns its id. A 409 becomes UsernameTaken when an
   * account has the username (unless the username is the email, as for staff), else EmailTaken.
   * No half-provisioned account is left behind when the role grant fails.
   */
  private async createUser(
    representation: Omit<UserRepresentation, 'id'>,
    role: string,
  ): Promise<string> {
    const email = String(representation.email);
    const username = String(representation.username);
    let response: Response;
    try {
      response = await this.request('POST', '/users', { body: representation });
    } catch (error) {
      if (!(error instanceof KeycloakHttpError && error.status === 409)) throw error;
      if (username !== email && (await this.userByUsername(username))) {
        throw new UsernameTaken(username);
      }
      throw new EmailTaken(email);
    }
    const userId = response.headers.get('location')?.split('/').pop();
    if (!userId) {
      throw new IdentityUnavailable('Keycloak created the user without returning its location');
    }
    try {
      await this.grantRealmRole(userId, role);
    } catch (error) {
      // The caller retries the whole creation.
      await this.deleteUser(userId).catch(() => undefined);
      throw error;
    }
    return userId;
  }

  /** The account whose username is exactly `username` (case-insensitive, as Keycloak's), or null. */
  private async userByUsername(username: string): Promise<UserRepresentation | null> {
    const wanted = username.toLowerCase();
    const response = await this.request('GET', '/users', {
      query: { username: wanted, exact: 'true', briefRepresentation: 'false' },
    });
    const users = (await response.json()) as UserRepresentation[];
    return users.find((candidate) => candidate.username?.toLowerCase() === wanted) ?? null;
  }

  /** The client with this client id (not Keycloak's internal id), or null. */
  private async client(clientId: string): Promise<ClientRepresentation | null> {
    const response = await this.request('GET', '/clients', { query: { clientId } });
    const clients = (await response.json()) as ClientRepresentation[];
    return clients.find((candidate) => candidate.clientId === clientId) ?? null;
  }

  private async clientSecret(id: string): Promise<string> {
    const response = await this.request('GET', `/clients/${id}/client-secret`);
    return secretOf(await response.json());
  }

  private async grantRealmRole(userId: string, role: string): Promise<void> {
    // The roles the account can still be given carry the representation the mapping needs.
    const available = await this.realmRoles(userId, 'available');
    const representation = available.find((candidate) => candidate.name === role);
    if (representation) {
      await this.request('POST', `/users/${userId}/role-mappings/realm`, {
        body: [representation],
        userId,
      });
      return;
    }
    const held = await this.realmRoles(userId, 'held');
    if (!held.some((candidate) => candidate.name === role)) {
      throw new Error(`Realm role ${role} does not exist`);
    }
  }

  /** The account as provisioning sees it: one extra call for its directly granted roles. */
  private async identityUser(user: UserRepresentation): Promise<IdentityUser> {
    const roles = await this.realmRoles(user.id, 'held');
    return {
      userId: user.id,
      tenant: user.attributes?.tenant?.[0] ?? null,
      enabled: user.enabled !== false,
      roles: roles.map((role) => role.name).filter((name) => name !== this.defaultRole),
    };
  }

  private async user(userId: string): Promise<UserRepresentation> {
    const response = await this.request('GET', `/users/${userId}`, { userId });
    return (await response.json()) as UserRepresentation;
  }

  /** Sends the full representation back: partial updates can drop profile attributes. */
  private async putUser(userId: string, user: UserRepresentation): Promise<void> {
    await this.request('PUT', `/users/${userId}`, { body: user, userId });
  }

  /** Realm roles mapped directly to the user, or those that could still be mapped. */
  private async realmRoles(
    userId: string,
    which: 'held' | 'available',
  ): Promise<RoleRepresentation[]> {
    const path = `/users/${userId}/role-mappings/realm${which === 'available' ? '/available' : ''}`;
    const response = await this.request('GET', path, { userId });
    return (await response.json()) as RoleRepresentation[];
  }

  /**
   * Calls the admin API. Network failures, timeouts, 5xx and authentication failures become
   * IdentityUnavailable; a 404 on a user resource becomes IdentityUserNotFound; any other
   * non-2xx becomes KeycloakHttpError.
   */
  private async request(
    method: string,
    path: string,
    options: RequestOptions = {},
    retried = false,
  ): Promise<Response> {
    const url = new URL(`${this.adminUrl}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      url.searchParams.set(key, value);
    }
    const token = await this.accessToken();
    const response = await this.send(
      url,
      {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/json',
          ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      },
      options.timeoutMs,
    );
    if (response.ok) {
      return response;
    }
    if (response.status === 401 && !retried) {
      // The cached token was revoked or the realm keys rotated; fetch a new one once.
      this.token = null;
      return this.request(method, path, options, true);
    }
    const detail = await errorDetail(response);
    if (response.status >= 500 || response.status === 401 || response.status === 403) {
      throw new IdentityUnavailable(
        `Keycloak ${method} ${path} answered ${response.status}${detail}`,
      );
    }
    if (response.status === 404 && options.userId) {
      throw new IdentityUserNotFound(options.userId);
    }
    throw new KeycloakHttpError(method, path, response.status, detail);
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now()) {
      return this.token.value;
    }
    const response = await this.send(new URL(this.tokenUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
      }),
    });
    if (!response.ok) {
      throw new IdentityUnavailable(
        `Keycloak refused client credentials for ${this.options.clientId}: ${response.status}${await errorDetail(response)}`,
      );
    }
    const body = (await response.json()) as { access_token: string; expires_in: number };
    this.token = {
      value: body.access_token,
      expiresAt: Date.now() + body.expires_in * 1000 - TOKEN_EXPIRY_MARGIN_MS,
    };
    return body.access_token;
  }

  private async send(url: URL, init: RequestInit, timeoutMs = this.timeoutMs): Promise<Response> {
    try {
      return await this.fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      throw new IdentityUnavailable(`Keycloak is unreachable at ${url.origin}`, { cause: error });
    }
  }
}

/** A non-2xx admin API answer that is neither an outage nor a missing user. */
export class KeycloakHttpError extends Error {
  override readonly name = 'KeycloakHttpError';

  constructor(
    method: string,
    path: string,
    readonly status: number,
    detail: string,
  ) {
    super(`Keycloak ${method} ${path} answered ${status}${detail}`);
  }
}

interface Profile {
  firstName: string | undefined;
  lastName: string | undefined;
  phone: string | undefined;
}

/** An email as Keycloak keeps it (trimmed, lower-cased), to store and to look up alike. */
function keycloakEmail(email: string): string {
  return email.trim().toLowerCase();
}

function profileOf(user: UserRepresentation): Profile {
  return { firstName: user.firstName, lastName: user.lastName, phone: user.attributes?.phone?.[0] };
}

/** The full representation with `profile` in place; an undefined field is cleared. */
function withProfile(user: UserRepresentation, profile: Profile): UserRepresentation {
  const attributes = { ...user.attributes };
  if (profile.phone === undefined) delete attributes.phone;
  else attributes.phone = [profile.phone];
  return {
    ...user,
    firstName: profile.firstName ?? '',
    lastName: profile.lastName ?? '',
    attributes,
  };
}

/** The full representation with the attribute `name` set to `value`, or removed if undefined. */
function withAttribute(
  user: UserRepresentation,
  name: string,
  value: string[] | undefined,
): UserRepresentation {
  const others = Object.entries(user.attributes ?? {}).filter(([held]) => held !== name);
  return {
    ...user,
    attributes: Object.fromEntries(value === undefined ? others : [...others, [name, value]]),
  };
}

function secretOf(credential: unknown): string {
  const { value } = credential as { value?: unknown };
  if (typeof value !== 'string' || !value) {
    throw new IdentityUnavailable('Keycloak returned a client credential without a secret');
  }
  return value;
}

/** First word is the given name, the rest the family name ("Otieno Odhiambo"). */
export function splitName(name: string): { firstName: string; lastName: string } {
  const [firstName = '', ...rest] = name.trim().split(/\s+/);
  return { firstName, lastName: rest.join(' ') };
}

async function errorDetail(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  return text ? `: ${text.slice(0, 500)}` : '';
}
