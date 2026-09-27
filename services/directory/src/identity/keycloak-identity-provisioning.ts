import {
  type ActivationEmailOptions,
  type CreateStaffUserInput,
  EmailTaken,
  IdentityProvisioning,
  IdentityUnavailable,
  type IdentityUser,
  IdentityUserNotFound,
} from './identity-provisioning.js';

export interface KeycloakIdentityOptions {
  /** Realm issuer, e.g. `http://localhost:8080/realms/adili`; admin and token URLs derive from it. */
  issuerUrl: string;
  /** Confidential client with a service account holding realm-management user roles. */
  clientId: string;
  clientSecret: string;
  /** Per-request timeout. */
  timeoutMs?: number;
  /** Replaceable for tests. */
  fetch?: typeof fetch;
}

interface UserRepresentation {
  id: string;
  username?: string;
  email?: string;
  enabled?: boolean;
  attributes?: Record<string, string[]>;
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

/** Refresh the service-account token this long before Keycloak says it expires. */
const TOKEN_EXPIRY_MARGIN_MS = 30_000;

/**
 * Keycloak Admin REST adapter. Authenticates with client credentials as the `directory`
 * service client; the realm import grants its service account `manage-users`,
 * `view-users` and `query-users`.
 */
export class KeycloakIdentityProvisioning extends IdentityProvisioning {
  private readonly adminUrl: string;
  /** The realm's composite default role, which every account holds (`default-roles-<realm>`). */
  private readonly defaultRole: string;
  private readonly tokenUrl: string;
  private readonly timeoutMs: number;
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
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  async findByEmail(email: string): Promise<IdentityUser | null> {
    const wanted = email.trim().toLowerCase();
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

  async createStaffUser(input: CreateStaffUserInput): Promise<string> {
    const email = input.email.trim().toLowerCase();
    const { firstName, lastName } = splitName(input.name);
    const response = await this.request('POST', '/users', {
      body: {
        username: email,
        email,
        firstName,
        lastName,
        enabled: true,
        emailVerified: false,
        attributes: { tenant: [input.tenant], phone: [input.phone] },
        requiredActions: input.requiredActions,
      },
    }).catch((error: unknown) => {
      throw error instanceof KeycloakHttpError && error.status === 409
        ? new EmailTaken(email)
        : error;
    });
    const userId = response.headers.get('location')?.split('/').pop();
    if (!userId) {
      throw new IdentityUnavailable('Keycloak created the user without returning its location');
    }
    try {
      await this.grantRealmRole(userId, input.role);
    } catch (error) {
      // Leave no half-provisioned account behind; the caller retries the whole creation.
      await this.deleteUser(userId).catch(() => undefined);
      throw error;
    }
    return userId;
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

  private async grantRealmRole(userId: string, role: string): Promise<void> {
    // Roles are looked up per user: reading `/roles` would need `view-realm` as well.
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

/** First word is the given name, the rest the family name ("Otieno Odhiambo"). */
export function splitName(name: string): { firstName: string; lastName: string } {
  const [firstName = '', ...rest] = name.trim().split(/\s+/);
  return { firstName, lastName: rest.join(' ') };
}

async function errorDetail(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  return text ? `: ${text.slice(0, 500)}` : '';
}
