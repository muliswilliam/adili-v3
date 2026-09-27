import { describe, expect, it } from 'vitest';

import { IdentityUnavailable } from '../../src/identity/identity-provisioning.js';
import { KeycloakIdentityProvisioning } from '../../src/identity/keycloak-identity-provisioning.js';
import {
  ACTIVATION,
  identityProvisioningContract,
  type InspectedUser,
  reportingOfficer,
  uniqueEmail,
} from './identity-provisioning.contract.js';

/**
 * S17 against a real Keycloak with the committed realm import and the Adili theme (the
 * `adili/keycloak` image, as in `pnpm infra:up`), and delivery of the activation email to
 * Mailpit, rendered by the theme's email templates. Uses the `directory` service client.
 */
const ISSUER_URL = requireEnv('TEST_KEYCLOAK_ISSUER_URL');
const MAILPIT_URL = requireEnv('TEST_MAILPIT_URL');
const CLIENT_ID = requireEnv('KEYCLOAK_CLIENT_ID');
const CLIENT_SECRET = requireEnv('KEYCLOAK_CLIENT_SECRET');

const adapter = new KeycloakIdentityProvisioning({
  issuerUrl: ISSUER_URL,
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
});

identityProvisioningContract('KeycloakIdentityProvisioning', () => ({
  adapter,
  inspect: async (userId): Promise<InspectedUser> => {
    const user = await admin<{
      username: string;
      email: string;
      firstName?: string;
      lastName?: string;
      enabled: boolean;
      requiredActions: string[];
      attributes?: Record<string, string[]>;
    }>('GET', `/users/${userId}`);
    const roles = await admin<{ name: string }[]>('GET', `/users/${userId}/role-mappings/realm`);
    return {
      username: user.username,
      email: user.email,
      name: [user.firstName, user.lastName].filter(Boolean).join(' '),
      tenant: user.attributes?.tenant?.[0] ?? null,
      phone: user.attributes?.phone?.[0] ?? null,
      commissionName: user.attributes?.commissionName?.[0] ?? null,
      invitedRole: user.attributes?.invitedRole?.[0] ?? null,
      realmRoles: roles.map((role) => role.name),
      requiredActions: user.requiredActions,
      enabled: user.enabled,
    };
  },
  expectActivationDelivered: async (email, _userId, options = ACTIVATION) => {
    const message = await activationMessage(email);
    expect(message.subject).toBe('Activate your Adili Online account');
    // Rendered by apps/keycloak-theme src/email from the account's invitation attributes.
    // HTML without its tags (the Commission and the lifespan are in bold), and the text variant.
    for (const body of [message.text, message.html.replace(/<[^>]+>/g, '')]) {
      expect(body).toContain(options.commissionName);
      expect(body).toContain('reporting officer');
      expect(body).toContain('This link expires in 72 hours.');
      expect(body).toContain('ask EACC to send you a new invitation');
    }
    // The link carries Keycloak's action token; its claims hold the lifespan and redirect.
    const claims = actionTokenClaims(message.text);
    expect(claims.exp - claims.iat).toBe(options.lifespanSeconds);
    expect(claims.reduri).toBe(options.redirectUri);
    expect(claims.azp).toBe(options.clientId);
    expect(claims.rqac).toEqual([...options.actions]);
    await deleteMessages([message.id]);
  },
  cleanup: async (userIds) => {
    await Promise.all(userIds.map((userId) => admin('DELETE', `/users/${userId}`)));
  },
}));

describe('KeycloakIdentityProvisioning against an unreachable Keycloak', () => {
  it('reports IdentityUnavailable', async () => {
    const unreachable = new KeycloakIdentityProvisioning({
      // Port 9 (discard) is closed on any sane machine; the connection is refused at once.
      issuerUrl: 'http://127.0.0.1:9/realms/adili',
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
    });

    await expect(
      unreachable.createStaffUser(reportingOfficer(uniqueEmail('down'))),
    ).rejects.toBeInstanceOf(IdentityUnavailable);
  });

  it('reports wrong client credentials as IdentityUnavailable', async () => {
    const misconfigured = new KeycloakIdentityProvisioning({
      issuerUrl: ISSUER_URL,
      clientId: CLIENT_ID,
      clientSecret: 'not-the-secret',
    });

    await expect(misconfigured.findByEmail(uniqueEmail('x'))).rejects.toBeInstanceOf(
      IdentityUnavailable,
    );
  });
});

// Independent admin access for inspection and cleanup, with the same service account.
let adminToken: string | undefined;

async function admin<T = unknown>(method: string, path: string): Promise<T> {
  adminToken ??= await clientCredentialsToken();
  const base = ISSUER_URL.replace('/realms/', '/admin/realms/');
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${adminToken}` },
  });
  if (!response.ok) {
    throw new Error(`${method} ${path} answered ${response.status}: ${await response.text()}`);
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}

async function clientCredentialsToken(): Promise<string> {
  const response = await fetch(`${ISSUER_URL}/protocol/openid-connect/token`, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });
  const body = (await response.json()) as { access_token: string };
  return body.access_token;
}

interface MailpitMessage {
  id: string;
  subject: string;
  text: string;
  html: string;
}

/** Waits for exactly one message to `email` and returns it. */
async function activationMessage(email: string): Promise<MailpitMessage> {
  const query = new URLSearchParams({ query: `to:"${email}"` });
  for (let attempt = 0; attempt < 50; attempt++) {
    const search = (await (
      await fetch(`${MAILPIT_URL}/api/v1/search?${query.toString()}`)
    ).json()) as {
      messages: { ID: string; Subject: string }[];
    };
    const [summary, ...others] = search.messages;
    if (summary) {
      expect(others).toHaveLength(0);
      const message = (await (
        await fetch(`${MAILPIT_URL}/api/v1/message/${summary.ID}`)
      ).json()) as {
        Text: string;
        HTML: string;
      };
      return { id: summary.ID, subject: summary.Subject, text: message.Text, html: message.HTML };
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`No email to ${email} reached Mailpit`);
}

async function deleteMessages(ids: string[]): Promise<void> {
  await fetch(`${MAILPIT_URL}/api/v1/messages`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ IDs: ids }),
  });
}

interface ActionTokenClaims {
  iat: number;
  exp: number;
  azp: string;
  reduri: string;
  rqac: string[];
}

function actionTokenClaims(text: string): ActionTokenClaims {
  const token = /[?&]key=([\w-]+\.([\w-]+)\.[\w-]+)/.exec(text)?.[2];
  if (!token) {
    throw new Error(`No action token link in email:\n${text}`);
  }
  return JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) as ActionTokenClaims;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required (see vitest.integration.config.ts)`);
  }
  return value;
}
