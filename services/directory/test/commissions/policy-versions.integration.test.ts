import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type {
  TenantPolicyHistory,
  TenantPolicyVersion,
} from '../../src/commissions/policy-representation.js';
import type { Commission } from '../../src/commissions/representation.js';
import { outbox } from '../../src/db/schema.js';
import { contractErrors, okResponse } from '../support/contract.js';
import { type Caller, type DirectoryApi, startDirectoryApi } from '../support/directory-api.js';
import { givenCommissions } from '../support/fixtures.js';
import type { Problem } from '../support/reporting-officers.js';

/**
 * Spec 04 S19 over HTTP: a commission-admin changes the obligations-start date, which creates a
 * new policy version copying the rest and records `directory.policy.changed.v1`; the policy
 * endpoint shows the current version and the history; version 1's start date is the date the
 * Commission was created (Africa/Nairobi).
 */

const POLICY = '/v1/commissions/psc/policy';
const VERSIONS = '/v1/commissions/psc/policy/versions';
const NOW = new Date('2026-10-01T09:00:00Z');

const PSC_ADMIN: Caller = {
  sub: 'admin-psc',
  tenant: 'psc',
  roles: ['commission-admin'],
  name: 'Grace Njeri',
};
const TSC_ADMIN: Caller = { sub: 'admin-tsc', tenant: 'tsc', roles: ['commission-admin'] };
const PSC_REVIEWER: Caller = { sub: 'reviewer-psc', tenant: 'psc', roles: ['reviewer'] };
const PSC_OFFICER: Caller = { sub: 'officer-psc', tenant: 'psc', roles: ['reporting-officer'] };
const PLATFORM_ADMIN: Caller = {
  sub: 'platform-1',
  tenant: 'platform',
  roles: ['platform-admin'],
  name: 'Platform Admin',
};
const EACC_ANALYST: Caller = { sub: 'analyst-1', tenant: 'eacc', roles: ['eacc-analyst'] };
const DECLARATIONS: Caller = {
  sub: 'service-account-declarations',
  azp: 'declarations',
  scope: 'directory:internal',
};

let api: DirectoryApi;

beforeAll(async () => {
  api = await startDirectoryApi();
  return () => api.close();
});

beforeEach(async () => {
  await api.reset();
  await givenCommissions(api.db, [
    { slug: 'psc', name: 'Public Service Commission' },
    { slug: 'tsc', name: 'Teachers Service Commission' },
  ]);
});

const createVersion = (body: unknown, caller: Caller = PSC_ADMIN, idempotencyKey?: string) =>
  api.post(VERSIONS, body, caller, { idempotencyKey });

async function history(caller: Caller = PSC_ADMIN): Promise<TenantPolicyHistory> {
  const response = await api.get(POLICY, caller);
  expect(response.statusCode, response.body).toBe(200);
  const body = response.json<TenantPolicyHistory>();
  expect(contractErrors(okResponse('/v1/commissions/{slug}/policy', 'get'), body)).toEqual([]);
  return body;
}

const policyEvents = async () =>
  (await api.db.select({ type: outbox.eventType, envelope: outbox.envelope }).from(outbox))
    .filter((event) => event.type === 'directory.policy.changed.v1')
    .map((event) => event.envelope);

describe('S19 create a policy version', () => {
  it('creates version 2 with the new start date, effective now, copying the rest', async () => {
    const before = await history();
    api.clock.set(NOW);

    const response = await createVersion({ obligationsStartDate: '2027-01-01' });

    expect(response.statusCode, response.body).toBe(201);
    const created = response.json<TenantPolicyVersion>();
    expect(
      contractErrors(okResponse('/v1/commissions/{slug}/policy/versions', 'post', 201), created),
    ).toEqual([]);
    const { current } = before;
    expect(created).toEqual({
      id: expect.any(String) as string,
      version: 2,
      effectiveFrom: NOW.toISOString(),
      obligationsStartDate: '2027-01-01',
      initialDueAfterAppointmentDays: current.initialDueAfterAppointmentDays,
      biennial: current.biennial,
      finalDueAfterExitDays: current.finalDueAfterExitDays,
      reminderOffsetsDays: current.reminderOffsetsDays,
      clarification: current.clarification,
      formMDue: current.formMDue,
      createdBy: 'admin-psc',
      createdByName: 'Grace Njeri',
      createdAt: expect.any(String) as string,
    } satisfies TenantPolicyVersion);
    const after = await history();
    expect(after.current).toEqual(created);
    expect(after.previous).toEqual([before.current]);
  });

  it('records directory.policy.changed.v1 with the version, for the tenant', async () => {
    const response = await createVersion({ obligationsStartDate: '2027-01-01' });
    const created = response.json<TenantPolicyVersion>();

    const [event, ...others] = await policyEvents();

    expect(others).toEqual([]);
    expect(event).toMatchObject({
      type: 'directory.policy.changed.v1',
      tenant: 'psc',
      subject: created.id,
      data: { policyVersionId: created.id, version: 2 },
    });
  });

  it('numbers later versions on and keeps the earlier ones unchanged', async () => {
    const first = (
      await createVersion({ obligationsStartDate: '2027-01-01' })
    ).json<TenantPolicyVersion>();

    const second = await createVersion({ obligationsStartDate: '2026-07-01' }, PLATFORM_ADMIN);

    expect(second.statusCode, second.body).toBe(201);
    expect(second.json<TenantPolicyVersion>()).toMatchObject({
      version: 3,
      obligationsStartDate: '2026-07-01',
      createdBy: 'platform-1',
    });
    const { current, previous } = await history();
    expect(current.version).toBe(3);
    expect(previous.map((version) => version.version)).toEqual([2, 1]);
    expect(previous[0]).toEqual(first);
  });

  it('shows the new version number on the Commission', async () => {
    await createVersion({ obligationsStartDate: '2027-01-01' });

    const response = await api.get('/v1/commissions/psc', PLATFORM_ADMIN);

    expect(response.json<Commission>().policyVersion).toBe(2);
  });

  it('gives the new version to services pulling the current policy', async () => {
    await createVersion({ obligationsStartDate: '2027-01-01' });

    const response = await api.get('/internal/v1/commissions/psc/policy', DECLARATIONS, {
      'x-acting-tenant': 'psc',
    });

    expect(response.json<TenantPolicyVersion>()).toMatchObject({
      version: 2,
      obligationsStartDate: '2027-01-01',
    });
  });

  it('replays a retry with the same Idempotency-Key instead of creating another version', async () => {
    const key = '0b6f4c1e-7f55-4b35-9b8a-3d2c1e0f9a87';
    const first = await createVersion({ obligationsStartDate: '2027-01-01' }, PSC_ADMIN, key);

    const retry = await createVersion({ obligationsStartDate: '2027-01-01' }, PSC_ADMIN, key);

    expect(retry.statusCode).toBe(201);
    expect(retry.json()).toEqual(first.json());
    expect((await history()).current.version).toBe(2);
  });

  it('gives each of two concurrent changes its own version', async () => {
    const responses = await Promise.all([
      createVersion({ obligationsStartDate: '2027-01-01' }),
      createVersion({ obligationsStartDate: '2027-02-01' }),
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual([201, 201]);
    expect(
      responses.map((response) => response.json<TenantPolicyVersion>().version).sort(),
    ).toEqual([2, 3]);
  });
});

describe('S19 who may change the policy', () => {
  it.each([
    ['a reviewer', PSC_REVIEWER],
    ['a reporting officer', PSC_OFFICER],
    ['an EACC analyst', EACC_ANALYST],
  ])('refuses %s with 403 and creates nothing', async (_who, caller) => {
    const response = await createVersion({ obligationsStartDate: '2027-01-01' }, caller);

    expect(response.statusCode).toBe(403);
    expect((await history()).current.version).toBe(1);
    expect(await policyEvents()).toEqual([]);
  });

  it("answers 404 to another Commission's admin", async () => {
    const response = await createVersion({ obligationsStartDate: '2027-01-01' }, TSC_ADMIN);

    expect(response.statusCode).toBe(404);
    expect((await history()).current.version).toBe(1);
  });

  it('answers 404 for a Commission that does not exist', async () => {
    const response = await api.post(
      '/v1/commissions/kra/policy/versions',
      { obligationsStartDate: '2027-01-01' },
      PLATFORM_ADMIN,
    );

    expect(response.statusCode).toBe(404);
  });

  it.each([
    ['a missing date', {}],
    ['a date that is not one', { obligationsStartDate: '2027-02-30' }],
    ['a date-time', { obligationsStartDate: '2027-01-01T00:00:00Z' }],
    ['another field', { obligationsStartDate: '2027-01-01', reminderOffsetsDays: [1] }],
  ])('answers 400 for %s', async (_case, body) => {
    const response = await createVersion(body);

    expect(response.statusCode, response.body).toBe(400);
    expect(response.json<Problem>().errors?.length).toBeGreaterThan(0);
  });
});

describe('S19 read the policy', () => {
  it("gives any staff of the Commission and national readers the policy, others' 404", async () => {
    expect((await api.get(POLICY, PSC_REVIEWER)).statusCode).toBe(200);
    expect((await api.get(POLICY, EACC_ANALYST)).statusCode).toBe(200);
    expect((await api.get(POLICY, PLATFORM_ADMIN)).statusCode).toBe(200);
    expect((await api.get(POLICY, TSC_ADMIN)).statusCode).toBe(404);
    expect(
      (await api.get(POLICY, { sub: 'declarant-1', tenant: 'psc', roles: ['declarant'] }))
        .statusCode,
    ).toBe(403);
  });

  it('shows version 1 with no earlier versions', async () => {
    const { current, previous } = await history();

    expect(current).toMatchObject({ version: 1, reminderOffsetsDays: [30, 14, 7] });
    expect(previous).toEqual([]);
  });
});

describe('S19 version 1 of a new Commission', () => {
  it('starts obligations on the day the Commission was created, in Nairobi', async () => {
    const created = await api.post(
      '/v1/commissions',
      { slug: 'naeth', name: 'National Ethics Board', type: 'hosted', categories: [] },
      PLATFORM_ADMIN,
    );
    expect(created.statusCode, created.body).toBe(201);
    const createdAt = new Date(created.json<Commission>().createdAt);

    const response = await api.get('/v1/commissions/naeth/policy', PLATFORM_ADMIN);

    const nairobiDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(
      createdAt,
    );
    expect(response.json<TenantPolicyHistory>().current).toMatchObject({
      version: 1,
      obligationsStartDate: nairobiDate,
      createdBy: 'platform-1',
    });
  });
});
