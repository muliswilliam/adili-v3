import { sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { outbox, rosterApiCredentials } from '../../src/db/schema.js';
import {
  IdentityUnavailable,
  ApiClientNotFound,
} from '../../src/identity/identity-provisioning.js';
import { componentSchema, contractErrors, okResponse } from '../support/contract.js';
import { type Caller, type DirectoryApi, startDirectoryApi } from '../support/directory-api.js';
import {
  givenTsc,
  PLATFORM_ADMIN,
  type Problem,
  withOutboxRefusing,
} from '../support/reporting-officers.js';

/** Spec #27 scenario S18: the lifecycle of a Commission's HR-system credential over HTTP. */
const PATH = '/v1/commissions/tsc/roster/api-credential';
const CONTRACT_PATH = '/v1/commissions/{slug}/roster/api-credential';
const OFFICER: Caller = {
  sub: 'officer-1',
  tenant: 'tsc',
  roles: ['reporting-officer'],
  name: 'Fatuma Wanjiru',
};
/** The officer as credential events name them. */
const ACTOR = { kind: 'user', id: 'officer-1' };
const TOKEN_ENDPOINT = 'http://localhost:8080/realms/adili/protocol/openid-connect/token';

interface Credential {
  clientId: string;
  createdAt: string;
  createdBy: { id: string; name: string | null };
  rotatedAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

interface CredentialWithSecret extends Credential {
  secret: string;
  tokenEndpoint: string;
  scope: string;
}

let api: DirectoryApi;

beforeAll(async () => {
  api = await startDirectoryApi();
  return () => api.close();
});

beforeEach(async () => {
  await api.reset();
  await givenTsc(api);
});

const get = (caller: Caller = OFFICER, path = PATH) => api.get(path, caller);
const create = (caller: Caller = OFFICER, path = PATH) =>
  api.post(path, undefined, caller, { idempotencyKey: null });
const rotate = (caller: Caller = OFFICER, path = PATH) =>
  api.post(`${path}/rotate`, undefined, caller, { idempotencyKey: null });
const revoke = (caller: Caller = OFFICER, path = PATH) => api.delete(path, caller);

async function created(): Promise<CredentialWithSecret> {
  const response = await create();
  expect(response.statusCode).toBe(201);
  return response.json<CredentialWithSecret>();
}

const credentialEvents = async () =>
  (
    await api.db
      .select({ type: outbox.eventType, envelope: outbox.envelope })
      .from(outbox)
      .orderBy(outbox.id)
  ).filter((event) => event.type === 'roster.api-credential.changed.v1');

const expectProblem = (
  response: Awaited<ReturnType<typeof get>>,
  status: number,
  type = 'about:blank',
) => {
  expect(response.statusCode).toBe(status);
  expect(response.headers['content-type']).toContain('application/problem+json');
  const problem = response.json<Problem>();
  expect(contractErrors(componentSchema('ProblemDetails'), problem)).toEqual([]);
  expect(problem.type).toBe(type);
};

describe('S18 credential lifecycle', () => {
  it('has no credential until one is created', async () => {
    const response = await get();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toBeNull();
    expect(contractErrors(okResponse(CONTRACT_PATH, 'get'), null)).toEqual([]);
  });

  it('creates a credential: client id and secret once, with the token endpoint and scope', async () => {
    const response = await create();

    expect(response.statusCode).toBe(201);
    const body = response.json<CredentialWithSecret>();
    expect(contractErrors(okResponse(CONTRACT_PATH, 'post', 201), body)).toEqual([]);
    expect(body).toEqual({
      clientId: expect.stringMatching(/^roster-tsc-[0-9a-f]{8}$/) as unknown,
      secret: expect.any(String) as unknown,
      tokenEndpoint: TOKEN_ENDPOINT,
      scope: 'roster:write',
      createdAt: expect.any(String) as unknown,
      createdBy: { id: 'officer-1', name: 'Fatuma Wanjiru' },
      rotatedAt: null,
      revokedAt: null,
      lastUsedAt: null,
    });
    // The identity provider holds the client, with the scope and the tenant claim.
    expect(api.identity.apiClient(body.clientId)).toMatchObject({
      tenant: 'tsc',
      scopes: ['roster:write'],
      audience: 'adili-api',
      enabled: true,
      secret: body.secret,
    });
  });

  it('never stores the secret: reads return metadata only', async () => {
    const { secret, ...issued } = await created();

    const response = await get();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      clientId: issued.clientId,
      createdAt: issued.createdAt,
      createdBy: issued.createdBy,
      rotatedAt: null,
      revokedAt: null,
      lastUsedAt: null,
    });
    expect(contractErrors(okResponse(CONTRACT_PATH, 'get'), response.json())).toEqual([]);
    const rows = await api.db.select().from(rosterApiCredentials);
    expect(JSON.stringify(rows)).not.toContain(secret);
  });

  it('records the created event', async () => {
    const { clientId } = await created();

    const events = await credentialEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.envelope).toMatchObject({
      source: 'adili/directory',
      subject: clientId,
      tenant: 'tsc',
      data: { action: 'created', clientId, actor: ACTOR },
    });
  });

  it('refuses a second credential with 409 and leaves the first working', async () => {
    const first = await created();

    const response = await create();

    expectProblem(response, 409, 'api-credential-exists');
    expect(api.identity.calls('createApiClient')).toHaveLength(1);
    expect(api.identity.apiClient(first.clientId)?.enabled).toBe(true);
    expect(await credentialEvents()).toHaveLength(1);
  });

  it('rotates: a new secret for the same client, rotatedAt set, and the rotated event', async () => {
    const first = await created();

    const response = await rotate();

    expect(response.statusCode).toBe(200);
    const body = response.json<CredentialWithSecret>();
    expect(contractErrors(okResponse(`${CONTRACT_PATH}/rotate`, 'post'), body)).toEqual([]);
    expect(body).toMatchObject({
      clientId: first.clientId,
      createdAt: first.createdAt,
      tokenEndpoint: TOKEN_ENDPOINT,
      scope: 'roster:write',
      revokedAt: null,
    });
    expect(body.secret).not.toBe(first.secret);
    expect(body.rotatedAt).toEqual(expect.any(String));
    expect(api.identity.apiClient(first.clientId)?.secret).toBe(body.secret);
    expect((await credentialEvents()).map((event) => event.envelope.data)).toEqual([
      { action: 'created', clientId: first.clientId, actor: ACTOR },
      { action: 'rotated', clientId: first.clientId, actor: ACTOR },
    ]);
    expect((await get()).json<Credential>().rotatedAt).toBe(body.rotatedAt);
  });

  it('stamps rotatedAt when the identity provider has rotated the secret, not before', async () => {
    await created();
    const identity = api.identity;
    const rotateSecret = identity.rotateApiClientSecret.bind(identity);
    let rotatedBy = Number.POSITIVE_INFINITY;
    // A slow identity provider: tokens of the old secret can be minted until it answers.
    identity.rotateApiClientSecret = async (clientId) => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      const secret = await rotateSecret(clientId);
      // By the database's clock, which stamps rotatedAt; in whole milliseconds, as the API has it.
      const { rows } = await api.db.execute<{ ms: string }>(
        sql`select floor(extract(epoch from clock_timestamp()) * 1000) as ms`,
      );
      rotatedBy = Number(rows[0]?.ms);
      return secret;
    };
    try {
      const body = (await rotate()).json<CredentialWithSecret>();

      expect(new Date(body.rotatedAt ?? 0).getTime()).toBeGreaterThanOrEqual(rotatedBy);
    } finally {
      identity.rotateApiClientSecret = rotateSecret;
    }
  });

  it('revokes: 204, the client is disabled, revokedAt set, and the revoked event', async () => {
    const { clientId } = await created();

    const response = await revoke();

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
    expect(api.identity.apiClient(clientId)?.enabled).toBe(false);
    const metadata = (await get()).json<Credential>();
    expect(metadata).toMatchObject({ clientId, revokedAt: expect.any(String) as unknown });
    expect(contractErrors(okResponse(CONTRACT_PATH, 'get'), metadata)).toEqual([]);
    expect((await credentialEvents()).map((event) => event.envelope.data)).toEqual([
      { action: 'created', clientId, actor: ACTOR },
      { action: 'revoked', clientId, actor: ACTOR },
    ]);
  });

  it('allows a new credential after revoking, with a new client', async () => {
    const first = await created();
    expect((await revoke()).statusCode).toBe(204);

    const response = await create();

    expect(response.statusCode).toBe(201);
    const second = response.json<CredentialWithSecret>();
    expect(second.clientId).not.toBe(first.clientId);
    expect(second.revokedAt).toBeNull();
    expect(api.identity.apiClient(first.clientId)?.enabled).toBe(false);
    expect(api.identity.apiClient(second.clientId)?.enabled).toBe(true);
    expect((await get()).json<Credential>()).toMatchObject({
      clientId: second.clientId,
      revokedAt: null,
      rotatedAt: null,
    });
  });

  it('cannot rotate or revoke when there is no credential, or it was revoked (404)', async () => {
    expectProblem(await rotate(), 404);
    expectProblem(await revoke(), 404);

    await created();
    await revoke();

    expectProblem(await rotate(), 404);
    expectProblem(await revoke(), 404);
    expect(api.identity.calls('rotateApiClientSecret')).toHaveLength(0);
    expect(api.identity.calls('disableApiClient')).toHaveLength(1);
  });
});

describe('access', () => {
  it("answers 404 for another Commission's credential", async () => {
    const other: Caller = { ...OFFICER, tenant: 'psc' };

    expectProblem(await get(other), 404);
    expectProblem(await create(other), 404);
    expectProblem(await rotate(other), 404);
    expectProblem(await revoke(other), 404);
    expect(api.identity.calls()).toEqual([]);
  });

  it('answers 404 for a Commission that does not exist', async () => {
    const path = '/v1/commissions/kdf/roster/api-credential';

    expectProblem(await create({ ...OFFICER, tenant: 'kdf' }, path), 404);
    expect(api.identity.calls()).toEqual([]);
  });

  it.each<[string, Caller]>([
    ['commission-admin', { tenant: 'tsc', roles: ['commission-admin'] }],
    ['platform-admin', PLATFORM_ADMIN],
    ['eacc-supervisor', { tenant: 'eacc', roles: ['eacc-supervisor'] }],
  ])('refuses %s with 403', async (_role, caller) => {
    expectProblem(await get(caller), 403);
    expectProblem(await create(caller), 403);
    expectProblem(await rotate(caller), 403);
    expectProblem(await revoke(caller), 403);
  });
});

describe('identity provider failures', () => {
  it('creates nothing when the identity provider is unavailable (502), and a retry works', async () => {
    api.identity.failNext('createApiClient', new IdentityUnavailable('Keycloak is down'));

    expectProblem(await create(), 502, 'identity-unavailable');
    expect((await get()).json()).toBeNull();
    expect(await credentialEvents()).toEqual([]);

    expect((await create()).statusCode).toBe(201);
  });

  it('disables the new client again when the credential cannot be recorded', async () => {
    const response = await withOutboxRefusing(api, () => create());

    expect(response.statusCode).toBe(500);
    const [call] = api.identity.calls('createApiClient');
    expect(api.identity.apiClient(call?.input.clientId ?? '')?.enabled).toBe(false);
    expect((await get()).json()).toBeNull();
    expect((await create()).statusCode).toBe(201);
  });

  it('serialises concurrent creates: one credential, one 409', async () => {
    const responses = await Promise.all([create(), create()]);

    expect(responses.map((response) => response.statusCode).sort()).toEqual([201, 409]);
    expect(api.identity.calls('createApiClient')).toHaveLength(1);
    expect(await credentialEvents()).toHaveLength(1);
  });

  it('keeps the credential active when revoking fails (502)', async () => {
    await created();
    api.identity.failNext('disableApiClient', new IdentityUnavailable('Keycloak is down'));

    expectProblem(await revoke(), 502, 'identity-unavailable');
    expect((await get()).json<Credential>().revokedAt).toBeNull();
  });

  it('answers 409 when the client is gone from the identity provider on rotate', async () => {
    await created();
    api.identity.failNext('rotateApiClientSecret', new ApiClientNotFound('roster-tsc-gone'));

    expectProblem(await rotate(), 409, 'api-credential-client-missing');
    expect((await get()).json<Credential>().rotatedAt).toBeNull();
  });
});
