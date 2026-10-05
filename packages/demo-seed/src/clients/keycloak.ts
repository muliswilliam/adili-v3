import type { SeedConfig } from '../config.js';
import { jsonBody, requestJson } from './http.js';

/** The Keycloak user fields the seed reads and writes (admin REST representation). */
export interface KeycloakUser {
  id: string;
  username: string;
  attributes?: Record<string, string[]>;
  requiredActions?: string[];
}

/**
 * The Keycloak admin API, for what the realm owns and no service exposes: a demo account's
 * `demo_key` (the role switcher and the seed sign it in by it) and its known password.
 */
export class KeycloakAdmin {
  private token: { value: string; expiresAt: number } | undefined;

  constructor(private readonly config: SeedConfig) {}

  private get base(): string {
    return `${this.config.KEYCLOAK_URL}/admin/realms/${this.config.KEYCLOAK_REALM}`;
  }

  async userByUsername(username: string): Promise<KeycloakUser | undefined> {
    const { body } = await requestJson<KeycloakUser[]>(
      `${this.base}/users?exact=true&briefRepresentation=false&username=${encodeURIComponent(username)}`,
      { headers: await this.headers(), what: `find Keycloak user ${username}` },
    );
    return body.find((user) => user.username === username.toLowerCase());
  }

  async userByEmail(email: string): Promise<KeycloakUser | undefined> {
    const { body } = await requestJson<(KeycloakUser & { email?: string })[]>(
      `${this.base}/users?exact=true&briefRepresentation=false&email=${encodeURIComponent(email)}`,
      { headers: await this.headers(), what: `find Keycloak user ${email}` },
    );
    return body.find((user) => user.email?.toLowerCase() === email.toLowerCase());
  }

  async userByAttribute(name: string, value: string): Promise<KeycloakUser | undefined> {
    const { body } = await requestJson<KeycloakUser[]>(
      `${this.base}/users?exact=true&briefRepresentation=false&q=${encodeURIComponent(`${name}:${value}`)}`,
      { headers: await this.headers(), what: `find Keycloak user ${name}=${value}` },
    );
    return body.find((user) => user.attributes?.[name]?.includes(value));
  }

  /**
   * Makes `user` a demo account: `demo_key` set, the demo password, no pending required action
   * (onboarding leaves UPDATE_PASSWORD for the set-password email). Returns whether it changed.
   */
  async ensureDemoAccount(user: KeycloakUser, demoKey: string): Promise<boolean> {
    const hasKey = user.attributes?.demo_key?.[0] === demoKey;
    const pending = (user.requiredActions ?? []).length > 0;
    if (hasKey && !pending) return false;
    const headers = { ...(await this.headers()), 'content-type': 'application/json' };
    // The admin API replaces the attributes it is given, so send them all back.
    const { body: full } = await requestJson<Record<string, unknown>>(
      `${this.base}/users/${user.id}`,
      {
        headers,
        what: `read Keycloak user ${user.username}`,
      },
    );
    await requestJson(`${this.base}/users/${user.id}`, {
      method: 'PUT',
      ...jsonBody({
        ...full,
        attributes: { ...user.attributes, demo_key: [demoKey] },
        requiredActions: [],
      }),
      headers,
      what: `make ${user.username} a demo account`,
    });
    await requestJson(`${this.base}/users/${user.id}/reset-password`, {
      method: 'PUT',
      ...jsonBody({ type: 'password', value: this.config.DEMO_PASSWORD, temporary: false }),
      headers,
      what: `set ${user.username}'s demo password`,
    });
    return true;
  }

  /**
   * A Commission staff demo account the realm file does not hold (e.g. a reviewer for a
   * Commission the seed adds): created with the role, tenant, `demo_key` and demo password if
   * missing. Returns whether it changed anything.
   */
  async ensureStaffAccount(staff: {
    username: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    tenant: string;
    demoKey: string;
  }): Promise<boolean> {
    let user = await this.userByUsername(staff.username);
    let changed = false;
    if (!user) {
      await requestJson(`${this.base}/users`, {
        method: 'POST',
        ...jsonBody({
          username: staff.username,
          email: staff.email,
          emailVerified: true,
          firstName: staff.firstName,
          lastName: staff.lastName,
          enabled: true,
          attributes: { tenant: [staff.tenant], demo_key: [staff.demoKey] },
        }),
        headers: { ...(await this.headers()), 'content-type': 'application/json' },
        what: `create ${staff.username}`,
      });
      user = await this.userByUsername(staff.username);
      if (!user) throw new Error(`${staff.username} is missing after create`);
      const { body: role } = await requestJson<{ id: string; name: string }>(
        `${this.base}/roles/${encodeURIComponent(staff.role)}`,
        { headers: await this.headers(), what: `read role ${staff.role}` },
      );
      await requestJson(`${this.base}/users/${user.id}/role-mappings/realm`, {
        method: 'POST',
        ...jsonBody([role]),
        headers: { ...(await this.headers()), 'content-type': 'application/json' },
        what: `grant ${staff.role} to ${staff.username}`,
      });
      changed = true;
    }
    return (await this.ensureDemoAccount(user, staff.demoKey)) || changed;
  }

  private async headers(): Promise<Record<string, string>> {
    if (!this.token || this.token.expiresAt < Date.now() + 10_000) {
      const { body } = await requestJson<{ access_token: string; expires_in: number }>(
        `${this.config.KEYCLOAK_URL}/realms/master/protocol/openid-connect/token`,
        {
          method: 'POST',
          body: new URLSearchParams({
            grant_type: 'password',
            client_id: 'admin-cli',
            username: this.config.KEYCLOAK_ADMIN_USER,
            password: this.config.KEYCLOAK_ADMIN_PASSWORD,
          }),
          what: 'Keycloak admin token',
        },
      );
      this.token = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    }
    return { authorization: `Bearer ${this.token.value}` };
  }
}
