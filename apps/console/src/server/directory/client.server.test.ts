import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { MOCK_COMMISSIONS } from '../../mocks/directory/fixtures';
import { directoryHandlers, problem } from '../../mocks/directory/handlers';
import { fetchPrincipal } from '../directory.server';
import { directoryClient } from './client.server';
import { callDirectory } from './result';

const DIRECTORY = 'http://directory.test';

vi.stubEnv('APP_URL', 'http://console.test');
vi.stubEnv('OIDC_ISSUER_URL', 'http://keycloak.test/realms/adili');
vi.stubEnv('OIDC_CLIENT_ID', 'console');
vi.stubEnv('OIDC_CLIENT_SECRET', 'secret');
vi.stubEnv('VALKEY_URL', 'redis://valkey.test:6379');
vi.stubEnv('DIRECTORY_API_URL', DIRECTORY);

// The real client and the real global fetch, answered by the same handlers `pnpm dev` uses.
const server = setupServer(...directoryHandlers(DIRECTORY));
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

const client = directoryClient('token-1');

describe('directory client against the fake directory', () => {
  it('sends the caller token and lists Commissions by name', async () => {
    let authorization: string | null = null;
    server.events.on('request:start', ({ request }) => {
      authorization = request.headers.get('authorization');
    });
    const result = await callDirectory(() => client.GET('/v1/commissions'));
    server.events.removeAllListeners();

    expect(authorization).toBe('Bearer token-1');
    expect(result.ok && result.data.items.map((item) => item.slug)).toEqual(
      MOCK_COMMISSIONS.map((item) => item.slug),
    );
    const names = MOCK_COMMISSIONS.map((item) => item.name);
    expect(names).toEqual(names.toSorted((a, b) => a.localeCompare(b)));
  });

  it('filters by search and by reporting officer `none`', async () => {
    const { data } = await client.GET('/v1/commissions', {
      params: { query: { search: 'service', reportingOfficer: 'none' } },
    });
    expect(data?.items.map((item) => item.slug)).toEqual(['cpsb042', 'cpsb001', 'nis']);
  });

  it('pages with cursors and no repeats', async () => {
    const first = await client.GET('/v1/commissions', { params: { query: { limit: 10 } } });
    const cursor = first.data?.nextCursor ?? undefined;
    expect(cursor).toBeDefined();

    const second = await client.GET('/v1/commissions', {
      params: { query: { limit: 10, cursor } },
    });
    expect(second.data?.nextCursor).toBeNull();
    const slugs = [...(first.data?.items ?? []), ...(second.data?.items ?? [])].map((c) => c.slug);
    expect(new Set(slugs).size).toBe(MOCK_COMMISSIONS.length);
  });

  it('has no roster on any Commission in slice 01', () => {
    expect(MOCK_COMMISSIONS.every((item) => item.roster.status === 'none')).toBe(true);
  });

  it('gets one Commission and maps an unknown slug to not-found with its problem', async () => {
    const found = await callDirectory(() =>
      client.GET('/v1/commissions/{slug}', { params: { path: { slug: 'psc' } } }),
    );
    expect(found.ok && found.data.issuerCode).toBe('PSC');

    const missing = await callDirectory(() =>
      client.GET('/v1/commissions/{slug}', { params: { path: { slug: 'nope' } } }),
    );
    expect(missing).toMatchObject({
      ok: false,
      failure: { kind: 'not-found', problem: { status: 404, detail: 'No such Commission.' } },
    });
  });

  it('answers a bad query with validation problem details', async () => {
    const result = await callDirectory(() =>
      client.GET('/v1/commissions', { params: { query: { limit: 500 } } }),
    );
    expect(result).toMatchObject({
      ok: false,
      failure: { kind: 'invalid', problem: { status: 400, errors: [{ path: 'limit' }] } },
    });
  });

  it('keeps the problem detail of a server error', async () => {
    server.use(
      http.get(`${DIRECTORY}/v1/commissions`, () =>
        problem(503, 'Service Unavailable', 'The directory is being upgraded.'),
      ),
    );
    const result = await callDirectory(() => client.GET('/v1/commissions'));
    expect(result).toMatchObject({
      ok: false,
      failure: { kind: 'unavailable', problem: { detail: 'The directory is being upgraded.' } },
    });
  });

  it('lists all 19 officer categories', async () => {
    const { data } = await client.GET('/v1/reference/officer-categories');
    expect(data).toHaveLength(19);
  });
});

describe('fetchPrincipal', () => {
  it('asks the same directory, with the same client settings', async () => {
    server.use(
      http.get(`${DIRECTORY}/v1/me`, ({ request }) =>
        HttpResponse.json({
          subject: 'u1',
          tenant: null,
          roles: [
            request.headers.get('authorization') === 'Bearer token-2' ? 'platform-admin' : '',
          ],
          clientId: 'console',
        }),
      ),
    );
    const result = await fetchPrincipal('token-2');
    expect(result).toEqual({
      ok: true,
      principal: { subject: 'u1', tenant: null, roles: ['platform-admin'], clientId: 'console' },
    });
  });

  it('reports a failing directory', async () => {
    server.use(http.get(`${DIRECTORY}/v1/me`, () => HttpResponse.error()));
    expect(await fetchPrincipal('token-2')).toEqual({
      ok: false,
      reason: 'Directory service is unreachable',
    });
  });
});
