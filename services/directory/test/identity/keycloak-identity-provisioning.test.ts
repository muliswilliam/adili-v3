import { describe, expect, it } from 'vitest';

import {
  ApiClientExists,
  ApiClientNotFound,
  EmailTaken,
  IdentityUnavailable,
  IdentityUserNotFound,
} from '../../src/identity/identity-provisioning.js';
import {
  KeycloakIdentityProvisioning,
  splitName,
} from '../../src/identity/keycloak-identity-provisioning.js';
import { ACTIVATION, reportingOfficer } from './identity-provisioning.contract.js';

/**
 * Error mapping and request shape against a scripted fetch. Behaviour against a real
 * Keycloak is covered by keycloak-identity-provisioning.integration.test.ts.
 */
type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>;

interface Recorded {
  method: string;
  url: URL;
  body: unknown;
}

function keycloak(routes: Record<string, Handler>) {
  const requests: Recorded[] = [];
  const fetchStub = async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const method = init.method ?? 'GET';
    const body =
      typeof init.body === 'string'
        ? (JSON.parse(init.body) as unknown)
        : init.body instanceof URLSearchParams
          ? init.body.toString()
          : undefined;
    requests.push({ method, url, body });
    const handler = routes[`${method} ${url.pathname}`];
    if (!handler) {
      return new Response(`no route for ${method} ${url.pathname}`, { status: 599 });
    }
    return handler(url, init);
  };
  const adapter = new KeycloakIdentityProvisioning({
    issuerUrl: 'http://keycloak.test/realms/adili',
    clientId: 'directory',
    clientSecret: 'secret',
    fetch: fetchStub,
  });
  return { adapter, requests };
}

const TOKEN = 'POST /realms/adili/protocol/openid-connect/token';
const ADMIN = '/admin/realms/adili';
const tokenOk: Handler = () => Response.json({ access_token: 'token', expires_in: 300 });
const available: Handler = () => Response.json([{ id: 'role-id', name: 'reporting-officer' }]);
/** An account that already records the invitation of ACTIVATION. */
const INVITED = {
  id: 'user-1',
  username: 'a@tsc.go.ke',
  enabled: true,
  attributes: {
    tenant: ['tsc'],
    commissionName: ['Teachers Service Commission'],
    invitedRole: ['reporting-officer'],
  },
};

describe('KeycloakIdentityProvisioning', () => {
  it('creates the user with the Keycloak representation, then maps the realm role', async () => {
    const { adapter, requests } = keycloak({
      [TOKEN]: tokenOk,
      [`POST ${ADMIN}/users`]: () =>
        new Response(null, {
          status: 201,
          headers: { location: `http://keycloak.test${ADMIN}/users/user-1` },
        }),
      [`GET ${ADMIN}/users/user-1/role-mappings/realm/available`]: available,
      [`POST ${ADMIN}/users/user-1/role-mappings/realm`]: () => new Response(null, { status: 204 }),
    });

    const userId = await adapter.createStaffUser(reportingOfficer('Officer@TSC.go.ke'));

    expect(userId).toBe('user-1');
    expect(requests[0]?.body).toBe(
      'grant_type=client_credentials&client_id=directory&client_secret=secret',
    );
    expect(requests[1]?.body).toEqual({
      username: 'officer@tsc.go.ke',
      email: 'officer@tsc.go.ke',
      firstName: 'Otieno',
      lastName: 'Odhiambo Ouma',
      enabled: true,
      emailVerified: false,
      attributes: { tenant: ['tsc'], phone: ['+254712345678'] },
      requiredActions: ['VERIFY_EMAIL', 'UPDATE_PASSWORD', 'CONFIGURE_TOTP'],
    });
    expect(requests.at(-1)?.body).toEqual([{ id: 'role-id', name: 'reporting-officer' }]);
  });

  it('maps 409 on creation to EmailTaken', async () => {
    const { adapter } = keycloak({
      [TOKEN]: tokenOk,
      [`POST ${ADMIN}/users`]: () =>
        Response.json({ errorMessage: 'User exists with same email' }, { status: 409 }),
    });

    await expect(adapter.createStaffUser(reportingOfficer('a@tsc.go.ke'))).rejects.toEqual(
      new EmailTaken('a@tsc.go.ke'),
    );
  });

  it('deletes a created user when the role mapping fails', async () => {
    const { adapter, requests } = keycloak({
      [TOKEN]: tokenOk,
      [`POST ${ADMIN}/users`]: () =>
        new Response(null, { status: 201, headers: { location: `${ADMIN}/users/user-1` } }),
      [`GET ${ADMIN}/users/user-1/role-mappings/realm/available`]: available,
      [`POST ${ADMIN}/users/user-1/role-mappings/realm`]: () => new Response(null, { status: 503 }),
      [`DELETE ${ADMIN}/users/user-1`]: () => new Response(null, { status: 204 }),
    });

    await expect(adapter.createStaffUser(reportingOfficer('a@tsc.go.ke'))).rejects.toBeInstanceOf(
      IdentityUnavailable,
    );
    expect(requests.at(-1)).toMatchObject({ method: 'DELETE' });
  });

  it.each([
    ['5xx', () => new Response('boom', { status: 500 })],
    ['403 (service account lacks roles)', () => new Response(null, { status: 403 })],
    [
      'network failure',
      () => {
        throw new TypeError('fetch failed');
      },
    ],
  ])('maps %s to IdentityUnavailable', async (_label, handler: Handler) => {
    const { adapter } = keycloak({ [TOKEN]: tokenOk, [`GET ${ADMIN}/users`]: handler });

    await expect(adapter.findByEmail('a@tsc.go.ke')).rejects.toBeInstanceOf(IdentityUnavailable);
  });

  it('maps refused client credentials to IdentityUnavailable', async () => {
    const { adapter } = keycloak({
      [TOKEN]: () => Response.json({ error: 'unauthorized_client' }, { status: 401 }),
    });

    await expect(adapter.findByEmail('a@tsc.go.ke')).rejects.toBeInstanceOf(IdentityUnavailable);
  });

  it('maps a timeout to IdentityUnavailable', async () => {
    const adapter = new KeycloakIdentityProvisioning({
      issuerUrl: 'http://keycloak.test/realms/adili',
      clientId: 'directory',
      clientSecret: 'secret',
      timeoutMs: 10,
      fetch: ((_input: unknown, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(init.signal?.reason as Error);
          });
        })) as typeof fetch,
    });

    await expect(adapter.findByEmail('a@tsc.go.ke')).rejects.toBeInstanceOf(IdentityUnavailable);
  });

  it('reuses the service-account token and renews it once on 401', async () => {
    let tokens = 0;
    let searches = 0;
    const { adapter } = keycloak({
      [TOKEN]: () => Response.json({ access_token: `token-${++tokens}`, expires_in: 300 }),
      [`GET ${ADMIN}/users`]: (_url, init) => {
        searches++;
        const authorization = new Headers(init.headers).get('authorization');
        return searches === 2 && authorization === 'Bearer token-1'
          ? new Response(null, { status: 401 })
          : Response.json([]);
      },
    });

    await adapter.findByEmail('a@tsc.go.ke');
    await adapter.findByEmail('a@tsc.go.ke');

    expect(tokens).toBe(2);
    expect(searches).toBe(3);
  });

  it('maps 404 on a user resource to IdentityUserNotFound', async () => {
    const { adapter } = keycloak({
      [TOKEN]: tokenOk,
      [`GET ${ADMIN}/users/missing`]: () =>
        Response.json({ error: 'User not found' }, { status: 404 }),
    });

    await expect(adapter.sendActivationEmail('missing', ACTIVATION)).rejects.toEqual(
      new IdentityUserNotFound('missing'),
    );
  });

  it.each([
    [true, false, ['GET user-1', 'PUT user-1']],
    [false, false, ['GET user-1']],
    [false, true, ['GET user-1', 'PUT user-1']],
  ])(
    'sets enabled (from %s to %s) with the full representation, only when it changes',
    async (enabled, wanted, expected) => {
      const user = {
        id: 'user-1',
        username: 'a@tsc.go.ke',
        enabled,
        attributes: { tenant: ['tsc'], phone: ['+254712345678'] },
      };
      const { adapter, requests } = keycloak({
        [TOKEN]: tokenOk,
        [`GET ${ADMIN}/users/user-1`]: () => Response.json(user),
        [`PUT ${ADMIN}/users/user-1`]: () => new Response(null, { status: 204 }),
      });

      await adapter.setEnabled('user-1', wanted);

      const calls = requests
        .filter((request) => request.url.pathname.startsWith(ADMIN))
        .map(
          (request) => `${request.method} ${request.url.pathname.replace(`${ADMIN}/users/`, '')}`,
        );
      expect(calls).toEqual(expected);
      if (expected.length === 2) {
        // The full representation goes back, so attributes such as the tenant survive.
        expect(requests.at(-1)?.body).toEqual({ ...user, enabled: wanted });
      }
    },
  );

  it('finds a user with its directly granted roles, leaving out the realm default role', async () => {
    const { adapter } = keycloak({
      [TOKEN]: tokenOk,
      [`GET ${ADMIN}/users`]: () =>
        Response.json([
          { id: 'user-1', email: 'a@tsc.go.ke', enabled: false, attributes: { tenant: ['tsc'] } },
        ]),
      [`GET ${ADMIN}/users/user-1/role-mappings/realm`]: () =>
        Response.json([
          { id: 'r1', name: 'default-roles-adili' },
          { id: 'r2', name: 'reviewer' },
          { id: 'r3', name: 'reporting-officer' },
        ]),
    });

    await expect(adapter.findByEmail('A@tsc.go.ke')).resolves.toEqual({
      userId: 'user-1',
      tenant: 'tsc',
      enabled: false,
      roles: ['reviewer', 'reporting-officer'],
    });
  });

  it('finds no user by an unknown id', async () => {
    const { adapter } = keycloak({
      [TOKEN]: tokenOk,
      [`GET ${ADMIN}/users/missing`]: () => new Response(null, { status: 404 }),
    });

    await expect(adapter.findById('missing')).resolves.toBeNull();
  });

  it('treats deleting a user that does not exist as done', async () => {
    const { adapter } = keycloak({
      [TOKEN]: tokenOk,
      [`DELETE ${ADMIN}/users/missing`]: () => new Response(null, { status: 404 }),
    });

    await expect(adapter.deleteUser('missing')).resolves.toBeUndefined();
  });

  it('waits longer than other calls for the activation email, which Keycloak sends over SMTP first', async () => {
    const adapter = new KeycloakIdentityProvisioning({
      issuerUrl: 'http://keycloak.test/realms/adili',
      clientId: 'directory',
      clientSecret: 'secret',
      timeoutMs: 20,
      // Every admin call but reading the invited user takes 100 ms, unless its timeout aborts
      // it first.
      fetch: (input: string | URL | Request, init: RequestInit = {}) => {
        const url = new URL(input instanceof Request ? input.url : input);
        if (url.pathname.endsWith('/token')) return Promise.resolve(tokenOk(url, init));
        if (url.pathname === `${ADMIN}/users/user-1`)
          return Promise.resolve(Response.json(INVITED));
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            resolve(new Response(null, { status: 204 }));
          }, 100);
          init.signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(init.signal?.reason as Error);
          });
        });
      },
    });

    await expect(adapter.sendActivationEmail('user-1', ACTIVATION)).resolves.toBeUndefined();
    await expect(adapter.findByEmail('a@tsc.go.ke')).rejects.toBeInstanceOf(IdentityUnavailable);
  });

  it('sends execute-actions-email with lifespan, redirect and client', async () => {
    const { adapter, requests } = keycloak({
      [TOKEN]: tokenOk,
      [`GET ${ADMIN}/users/user-1`]: () => Response.json(INVITED),
      [`PUT ${ADMIN}/users/user-1/execute-actions-email`]: () =>
        new Response(null, { status: 204 }),
    });

    await adapter.sendActivationEmail('user-1', ACTIVATION);

    const request = requests.at(-1);
    expect(Object.fromEntries(request?.url.searchParams ?? [])).toEqual({
      lifespan: '259200',
      redirect_uri: 'http://localhost:3020/auth/login',
      client_id: 'console',
    });
    expect(request?.body).toEqual(['VERIFY_EMAIL', 'UPDATE_PASSWORD', 'CONFIGURE_TOTP']);
  });

  it.each([
    ['no invitation yet', {}],
    ['another Commission', { commissionName: ['Public Service Commission'] }],
    ['another role', { invitedRole: ['reviewer'] }],
  ])(
    'records the Commission and role on the account (%s) before the email, keeping its other attributes',
    async (_case, earlier) => {
      const user = {
        ...INVITED,
        attributes: { tenant: ['tsc'], phone: ['+254712345678'], ...earlier },
      };
      const { adapter, requests } = keycloak({
        [TOKEN]: tokenOk,
        [`GET ${ADMIN}/users/user-1`]: () => Response.json(user),
        [`PUT ${ADMIN}/users/user-1`]: () => new Response(null, { status: 204 }),
        [`PUT ${ADMIN}/users/user-1/execute-actions-email`]: () =>
          new Response(null, { status: 204 }),
      });

      await adapter.sendActivationEmail('user-1', ACTIVATION);

      const calls = requests
        .filter((request) => request.url.pathname.startsWith(ADMIN))
        .map(
          (request) => `${request.method} ${request.url.pathname.replace(`${ADMIN}/users/`, '')}`,
        );
      expect(calls).toEqual(['GET user-1', 'PUT user-1', 'PUT user-1/execute-actions-email']);
      expect(
        requests.find(
          (request) => request.url.pathname === `${ADMIN}/users/user-1` && request.method === 'PUT',
        )?.body,
      ).toEqual({
        ...user,
        attributes: {
          tenant: ['tsc'],
          phone: ['+254712345678'],
          commissionName: ['Teachers Service Commission'],
          invitedRole: ['reporting-officer'],
        },
      });
    },
  );

  it("lists a Commission's staff with a role from the role's holders, a page at a time", async () => {
    const holder = (n: number, tenant: string) => ({
      id: `user-${String(n)}`,
      email: `s${String(n)}@${tenant}.go.ke`,
      enabled: true,
      emailVerified: true,
      attributes: { tenant: [tenant] },
    });
    const { adapter, requests } = keycloak({
      [TOKEN]: tokenOk,
      [`GET ${ADMIN}/roles/supervisor/users`]: (url) =>
        Response.json(
          url.searchParams.get('first') === '0'
            ? Array.from({ length: 100 }, (_, n) => holder(n, n === 7 ? 'psc' : 'tsc'))
            : [holder(100, 'psc')],
        ),
    });

    await expect(adapter.listStaffWithRole('psc', 'supervisor')).resolves.toEqual([
      { subject: 'user-7', email: 's7@psc.go.ke' },
      { subject: 'user-100', email: 's100@psc.go.ke' },
    ]);
    // Two reads for 101 holders, none per account.
    const reads = requests.filter((request) => request.url.pathname.startsWith(ADMIN));
    expect(reads.map(({ method, url }) => `${method} ${url.pathname}${url.search}`)).toEqual([
      `GET ${ADMIN}/roles/supervisor/users?briefRepresentation=false&first=0&max=100`,
      `GET ${ADMIN}/roles/supervisor/users?briefRepresentation=false&first=100&max=100`,
    ]);
  });

  it('rejects an issuer URL that is not a Keycloak realm', () => {
    expect(
      () =>
        new KeycloakIdentityProvisioning({
          issuerUrl: 'http://keycloak.test/',
          clientId: 'directory',
          clientSecret: 'secret',
        }),
    ).toThrow(/realm issuer/);
  });

  describe('API clients', () => {
    const INPUT = { tenant: 'psc', clientId: 'roster-psc-1', scopes: ['roster:write'] };
    const CLIENT = { id: 'internal-1', clientId: 'roster-psc-1', enabled: true, secret: '**' };
    const created: Handler = () =>
      new Response(null, {
        status: 201,
        headers: { location: `http://keycloak.test${ADMIN}/clients/internal-1` },
      });

    it('creates a confidential service-account client with its scopes, tenant claim and audience', async () => {
      const { adapter, requests } = keycloak({
        [TOKEN]: tokenOk,
        [`POST ${ADMIN}/clients`]: created,
        [`GET ${ADMIN}/clients/internal-1/client-secret`]: () =>
          Response.json({ type: 'secret', value: 'the-secret' }),
      });

      await expect(adapter.createApiClient(INPUT)).resolves.toEqual({
        clientId: 'roster-psc-1',
        secret: 'the-secret',
      });
      expect(requests[1]?.body).toMatchObject({
        clientId: 'roster-psc-1',
        enabled: true,
        publicClient: false,
        serviceAccountsEnabled: true,
        standardFlowEnabled: false,
        implicitFlowEnabled: false,
        directAccessGrantsEnabled: false,
        defaultClientScopes: ['basic', 'roster:write'],
        optionalClientScopes: [],
        protocolMappers: [
          {
            protocolMapper: 'oidc-hardcoded-claim-mapper',
            config: expect.objectContaining({
              'claim.name': 'tenant',
              'claim.value': 'psc',
              'access.token.claim': 'true',
            }) as unknown,
          },
          {
            protocolMapper: 'oidc-audience-mapper',
            config: expect.objectContaining({
              'included.custom.audience': 'adili-api',
              'access.token.claim': 'true',
            }) as unknown,
          },
        ],
      });
    });

    it('maps 409 on creation to ApiClientExists', async () => {
      const { adapter } = keycloak({
        [TOKEN]: tokenOk,
        [`POST ${ADMIN}/clients`]: () =>
          Response.json({ errorMessage: 'Client roster-psc-1 already exists' }, { status: 409 }),
      });

      await expect(adapter.createApiClient(INPUT)).rejects.toEqual(
        new ApiClientExists('roster-psc-1'),
      );
    });

    it('deletes a created client whose secret could not be read', async () => {
      const { adapter, requests } = keycloak({
        [TOKEN]: tokenOk,
        [`POST ${ADMIN}/clients`]: created,
        [`GET ${ADMIN}/clients/internal-1/client-secret`]: () =>
          new Response(null, { status: 503 }),
        [`DELETE ${ADMIN}/clients/internal-1`]: () => new Response(null, { status: 204 }),
      });

      await expect(adapter.createApiClient(INPUT)).rejects.toBeInstanceOf(IdentityUnavailable);
      expect(requests.at(-1)).toMatchObject({ method: 'DELETE' });
    });

    it('rotates the secret of the client found by client id', async () => {
      const { adapter, requests } = keycloak({
        [TOKEN]: tokenOk,
        [`GET ${ADMIN}/clients`]: () => Response.json([CLIENT]),
        [`POST ${ADMIN}/clients/internal-1/client-secret`]: () =>
          Response.json({ type: 'secret', value: 'new-secret' }),
      });

      await expect(adapter.rotateApiClientSecret('roster-psc-1')).resolves.toEqual({
        clientId: 'roster-psc-1',
        secret: 'new-secret',
      });
      expect(requests[1]?.url.searchParams.get('clientId')).toBe('roster-psc-1');
    });

    it('reports rotating an unknown client as ApiClientNotFound', async () => {
      const { adapter } = keycloak({
        [TOKEN]: tokenOk,
        [`GET ${ADMIN}/clients`]: () => Response.json([]),
      });

      await expect(adapter.rotateApiClientSecret('roster-psc-1')).rejects.toEqual(
        new ApiClientNotFound('roster-psc-1'),
      );
    });

    it('disables the client with its full representation, and only once', async () => {
      let representation = CLIENT;
      const { adapter, requests } = keycloak({
        [TOKEN]: tokenOk,
        [`GET ${ADMIN}/clients`]: () => Response.json([representation]),
        [`PUT ${ADMIN}/clients/internal-1`]: () => {
          representation = { ...CLIENT, enabled: false };
          return new Response(null, { status: 204 });
        },
      });

      await adapter.disableApiClient('roster-psc-1');
      await adapter.disableApiClient('roster-psc-1');

      const puts = requests.filter((request) => request.method === 'PUT');
      expect(puts.map((request) => request.body)).toEqual([{ ...CLIENT, enabled: false }]);
    });
  });
});

describe('splitName', () => {
  it.each([
    ['Otieno Odhiambo', { firstName: 'Otieno', lastName: 'Odhiambo' }],
    ['  Mary  Wanjiku   Kamau ', { firstName: 'Mary', lastName: 'Wanjiku Kamau' }],
    ['Zawadi', { firstName: 'Zawadi', lastName: '' }],
  ])('%s', (name, expected) => {
    expect(splitName(name)).toEqual(expected);
  });
});
