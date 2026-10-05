import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SeedContext } from '../context.js';
import { REPO_ROOT } from '../repo.js';
import { demoSignIn } from './realm.js';

interface RealmUser {
  username: string;
  firstName?: string;
  lastName?: string;
  attributes?: Record<string, string[]>;
}

const realmFile = JSON.parse(
  readFileSync(join(REPO_ROOT, 'infra/compose/keycloak/adili-realm.json'), 'utf8'),
) as {
  users: RealmUser[];
  authenticationFlows: {
    alias: string;
    authenticationExecutions: { authenticator?: string; requirement: string }[];
  }[];
};
const demoRequirement =
  realmFile.authenticationFlows
    .find((flow) => flow.alias === 'adili browser')
    ?.authenticationExecutions.find((execution) => execution.authenticator === 'adili-demo')
    ?.requirement ?? 'ALTERNATIVE';

/**
 * A Keycloak admin API holding a realm imported before the role switcher's claim existed: the
 * demo authenticator, the admin-only attribute and every demo user's key are there (the shared
 * stack had them from an earlier run), the portal and console demo_key claim mappers are not.
 */
function staleRealm() {
  const mappers: Record<string, { name: string }[]> = {
    portal: [{ name: 'tenant' }, { name: 'person_id' }],
    console: [{ name: 'tenant' }, { name: 'person_id' }],
  };
  const users = realmFile.users.map((user, index) => ({ ...user, id: `user-${String(index)}` }));
  const body = async (request: IncomingMessage) => {
    let text = '';
    for await (const chunk of request) text += String(chunk);
    return text ? (JSON.parse(text) as unknown) : undefined;
  };
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://keycloak');
      const send = (status: number, payload?: unknown) => {
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(payload === undefined ? '' : JSON.stringify(payload));
      };
      const admin = '/admin/realms/adili';
      const path = url.pathname;
      if (path === '/realms/master/protocol/openid-connect/token') {
        send(200, { access_token: 'admin-token' });
      } else if (path === `${admin}/users/profile`) {
        send(200, {
          attributes: [
            { name: 'username' },
            { name: 'demo_key', permissions: { view: ['admin'], edit: ['admin'] } },
          ],
        });
      } else if (path === `${admin}/clients`) {
        send(200, [{ id: url.searchParams.get('clientId') }]);
      } else if (/^\/admin\/realms\/adili\/clients\/[^/]+\/protocol-mappers\/models$/.test(path)) {
        const client = path.split('/')[5] ?? '';
        if (request.method === 'POST') {
          mappers[client]?.push((await body(request)) as { name: string });
          send(201);
        } else {
          send(200, mappers[client]);
        }
      } else if (path === `${admin}/authentication/flows/adili%20browser/executions`) {
        send(200, [
          {
            id: 'demo',
            providerId: 'adili-demo',
            level: 0,
            requirement: demoRequirement,
            authenticationConfig: 'adili-demo',
          },
          { id: 'cookie', providerId: 'auth-cookie', level: 0, requirement: 'ALTERNATIVE' },
        ]);
      } else if (path === `${admin}/users`) {
        send(
          200,
          users.filter((user) => user.username === url.searchParams.get('username')),
        );
      } else {
        send(404, { error: `${request.method ?? ''} ${path}` });
      }
    })();
  });
  return { server, mappers };
}

describe('the demo-sign-in step', () => {
  let realm: ReturnType<typeof staleRealm>;
  let url: string;

  beforeEach(async () => {
    realm = staleRealm();
    await new Promise<void>((resolve) => realm.server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${String((realm.server.address() as AddressInfo).port)}`;
  });

  afterEach(async () => {
    await new Promise((resolve) => realm.server.close(resolve));
  });

  const context = () =>
    ({
      config: {
        KEYCLOAK_URL: url,
        KEYCLOAK_ADMIN_USER: 'admin',
        KEYCLOAK_ADMIN_PASSWORD: 'admin_dev',
      },
    }) as unknown as SeedContext;

  it('gives a realm that predates it the demo_key claim the role switcher reads, once', async () => {
    expect(await demoSignIn.run(context())).toEqual({ changed: 1 });
    for (const client of ['portal', 'console']) {
      expect(realm.mappers[client]?.map((mapper) => mapper.name)).toContain('demo_key');
    }

    expect(await demoSignIn.run(context())).toEqual({ changed: 0 });
  });
});
