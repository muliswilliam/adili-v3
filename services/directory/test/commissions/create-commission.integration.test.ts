import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { outbox } from '../../src/db/schema.js';
import { componentSchema, contractErrors, okResponse } from '../support/contract.js';
import { type Caller, type DirectoryApi, startDirectoryApi } from '../support/directory-api.js';

/** Spec 01 scenarios S1-S7: creating a Commission over HTTP against a real Postgres. */
const PLATFORM_ADMIN: Caller = { sub: 'admin-1', tenant: 'platform', roles: ['platform-admin'] };
const EACC_SUPERVISOR: Caller = { tenant: 'eacc', roles: ['eacc-supervisor'] };
const NO_ROLES: Caller = { tenant: 'platform', roles: [] };

const TSC = {
  slug: 'tsc',
  name: 'Teachers Service Commission',
  type: 'hosted',
  categories: ['act-s32-10', 'regs-r5-b'],
};

interface Problem {
  type: string;
  status: number;
  errors?: { path: string; message: string }[];
}

let api: DirectoryApi;

beforeAll(async () => {
  api = await startDirectoryApi();
  return () => api.close();
});

beforeEach(async () => {
  await api.reset();
});

const create = (body: unknown, caller = PLATFORM_ADMIN, idempotencyKey?: string | null) =>
  api.post('/v1/commissions', body, caller, { idempotencyKey });

const outboxEvents = () =>
  api.db
    .select({ type: outbox.eventType, envelope: outbox.envelope })
    .from(outbox)
    .orderBy(outbox.id);

const errorPaths = (body: Problem) => (body.errors ?? []).map((error) => error.path).sort();

describe('S1 create', () => {
  it('creates a hosted Commission with policy version 1 and no roster', async () => {
    const response = await create(TSC);

    expect(response.statusCode).toBe(201);
    const body = response.json<Record<string, unknown>>();
    expect(contractErrors(okResponse('/v1/commissions', 'post', 201), body)).toEqual([]);
    expect(body).toMatchObject({
      slug: 'tsc',
      issuerCode: 'TSC',
      name: 'Teachers Service Commission',
      type: 'hosted',
      status: 'active',
      policyVersion: 1,
      reportingOfficer: null,
      roster: { status: 'none' },
      categories: [
        { code: 'act-s32-10', citation: 'Act s.32(10)' },
        { code: 'regs-r5-b', citation: 'Regs r.5(b)' },
      ],
    });

    const read = await api.get('/v1/commissions/tsc', PLATFORM_ADMIN);
    expect(read.statusCode).toBe(200);
    expect(contractErrors(componentSchema('Commission'), read.json())).toEqual([]);
    expect(read.json()).toEqual(body);
  });

  it('records commission.created.v1 with the tenant key and no personal data', async () => {
    const response = await create(TSC);
    const { id } = response.json<{ id: string }>();

    const events = await outboxEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('commission.created.v1');
    expect(events[0]?.envelope).toMatchObject({
      type: 'commission.created.v1',
      source: 'adili/directory',
      subject: id,
      tenant: 'tsc',
      data: { commissionId: id, slug: 'tsc', type: 'hosted' },
    });
    expect(Object.keys(events[0]?.envelope.data ?? {}).sort()).toEqual([
      'commissionId',
      'slug',
      'type',
    ]);
  });

  it('accepts a federated Commission with no categories and trims the name', async () => {
    const response = await create({
      slug: 'kdf',
      name: '  Defence Council ',
      type: 'federated',
      categories: [],
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ name: 'Defence Council', categories: [] });
  });
});

describe('S2/S3/S6 idempotency', () => {
  it('replays the same key and body without a second Commission or event', async () => {
    const key = randomUUID();
    const first = await create(TSC, PLATFORM_ADMIN, key);
    const replay = await create(TSC, PLATFORM_ADMIN, key);

    expect(replay.statusCode).toBe(201);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.json()).toEqual(first.json());
    const page = await api.get('/v1/commissions', PLATFORM_ADMIN);
    expect(page.json<{ total: number }>().total).toBe(1);
    expect(await outboxEvents()).toHaveLength(1);
  });

  it('refuses the same key with a different body (422)', async () => {
    const key = randomUUID();
    await create(TSC, PLATFORM_ADMIN, key);
    const reused = await create({ ...TSC, name: 'Teachers Commission' }, PLATFORM_ADMIN, key);

    expect(reused.statusCode).toBe(422);
    expect(reused.json<Problem>().type).toBe('idempotency-key-reused');
  });

  it('refuses a create without an Idempotency-Key (400)', async () => {
    const response = await create(TSC, PLATFORM_ADMIN, null);

    expect(response.statusCode).toBe(400);
    expect(response.json<Problem>().type).toBe('idempotency-key-missing');
    expect((await api.get('/v1/commissions/tsc', PLATFORM_ADMIN)).statusCode).toBe(404);
  });
});

describe('S4 conflicts', () => {
  beforeEach(async () => {
    expect((await create(TSC)).statusCode).toBe(201);
  });

  it('refuses a slug that exists, naming slug', async () => {
    const response = await create({ ...TSC, name: 'Tana Sugar Company' });

    expect(response.statusCode).toBe(409);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(contractErrors(componentSchema('ProblemDetails'), response.json())).toEqual([]);
    expect(errorPaths(response.json<Problem>())).toEqual(['slug']);
  });

  it('refuses a name that exists in any letter case, naming name', async () => {
    const response = await create({ ...TSC, slug: 'tsc2', name: 'teachers service COMMISSION' });

    expect(response.statusCode).toBe(409);
    expect(errorPaths(response.json<Problem>())).toEqual(['name']);
  });

  it('names both fields when both exist', async () => {
    const response = await create(TSC);

    expect(response.statusCode).toBe(409);
    expect(errorPaths(response.json<Problem>())).toEqual(['name', 'slug']);
  });

  it('keeps one Commission and one event', async () => {
    await create({ ...TSC, name: 'Tana Sugar Company' });

    expect((await api.get('/v1/commissions', PLATFORM_ADMIN)).json<{ total: number }>().total).toBe(
      1,
    );
    expect(await outboxEvents()).toHaveLength(1);
  });
});

describe('S5 validation', () => {
  it.each([
    ['Platform', 'upper case'],
    ['platform', 'reserved'],
    ['new', 'reserved for the console create route'],
    ['x', 'too short'],
    ['too-long-key-abcdefghijk', 'too long and a hyphen'],
    ['1tsc', 'starts with a digit'],
  ])('rejects slug %s (%s)', async (slug) => {
    const response = await create({ ...TSC, slug });

    expect(response.statusCode).toBe(400);
    expect(errorPaths(response.json<Problem>())).toEqual(['slug']);
  });

  it('lists every invalid path in one response', async () => {
    const response = await create({
      slug: 'Platform',
      name: 'TS',
      type: 'remote',
      categories: ['act-s32-10', 'act-s32-99'],
    });

    expect(response.statusCode).toBe(400);
    expect(contractErrors(componentSchema('ProblemDetails'), response.json())).toEqual([]);
    expect(errorPaths(response.json<Problem>())).toEqual(['categories.1', 'name', 'slug', 'type']);
  });

  it('rejects missing fields and repeated categories', async () => {
    const missing = await create({});
    expect(errorPaths(missing.json<Problem>())).toEqual(['categories', 'name', 'slug', 'type']);

    const repeated = await create({ ...TSC, categories: ['act-s32-10', 'act-s32-10'] });
    expect(repeated.statusCode).toBe(400);
    expect(errorPaths(repeated.json<Problem>())).toEqual(['categories']);
  });

  it('creates nothing', async () => {
    await create({ ...TSC, slug: 'x' });

    expect((await api.get('/v1/commissions', PLATFORM_ADMIN)).json<{ total: number }>().total).toBe(
      0,
    );
    expect(await outboxEvents()).toHaveLength(0);
  });
});

describe('S7 authorisation', () => {
  it.each([
    ['eacc-supervisor', EACC_SUPERVISOR],
    ['a token without roles', NO_ROLES],
    ['a reviewer', { tenant: 'psc', roles: ['reviewer'] }],
  ])('refuses %s (403)', async (_who, caller) => {
    const response = await create(TSC, caller);

    expect(response.statusCode).toBe(403);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect((await api.get('/v1/commissions/tsc', PLATFORM_ADMIN)).statusCode).toBe(404);
  });
});

describe('atomicity', () => {
  it('keeps nothing when a later step fails, and the same key can then be retried', async () => {
    // Make the last step of the unit of work (recording the event) fail.
    await api.db.execute(sql`
      create function refuse_outbox() returns trigger language plpgsql as $$
      begin raise exception 'outbox unavailable'; end $$`);
    await api.db.execute(sql`
      create trigger refuse_outbox before insert on outbox
      for each row execute function refuse_outbox()`);
    const key = randomUUID();
    let failed;
    try {
      failed = await create(TSC, PLATFORM_ADMIN, key);
    } finally {
      await api.db.execute(sql`drop trigger refuse_outbox on outbox`);
      await api.db.execute(sql`drop function refuse_outbox()`);
    }

    expect(failed.statusCode).toBe(500);
    const leftovers = await api.db.execute<{
      commissions: number;
      categories: number;
      policies: number;
      events: number;
    }>(sql`
      select
        (select count(*) from commissions)::int as commissions,
        (select count(*) from commission_categories)::int as categories,
        (select count(*) from tenant_policy_versions)::int as policies,
        (select count(*) from outbox)::int as events`);
    expect(leftovers.rows[0]).toEqual({ commissions: 0, categories: 0, policies: 0, events: 0 });

    const retry = await create(TSC, PLATFORM_ADMIN, key);
    expect(retry.statusCode).toBe(201);
    expect(retry.headers['idempotent-replayed']).toBeUndefined();
    expect(await outboxEvents()).toHaveLength(1);
  });
});
