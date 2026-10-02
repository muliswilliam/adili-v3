import { randomUUID } from 'node:crypto';

import { outbox } from '@adili/events';
import { COMMISSION_ADMIN, PLATFORM_ADMIN, SUPERVISOR } from '@adili/roles';
import { asc, eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { auditRecords, gatePolicies, jobs, routes } from '../../src/db/schema.js';
import { currentMonth } from '../../src/policy/budgets.js';
import { contractErrors } from '../support/contract.js';
import { actingFor, summarizeInput, summarizeOutput, usage } from '../support/inputs.js';
import { ScriptedProvider } from '../support/scripted-provider.js';
import { createTestApp, type TestApp } from '../support/test-app.js';

const MODEL = 'claude-opus-5-5';

interface RouteRow {
  task: string;
  tenant: string | null;
}

interface Job {
  id: string;
  status: string;
}

/**
 * The platform admin's policy, routing, budget and usage API, and the tenant AI status services
 * read (spec 07c S5, S14, S16), against real Postgres with an external default provider and a
 * self-hosted second one.
 */
describe('admin API', { timeout: 90_000 }, () => {
  const external = new ScriptedProvider(
    () => Promise.resolve({ status: 'completed', model: MODEL, output: summarizeOutput, usage }),
    'external',
  );
  const selfHosted = new ScriptedProvider(
    () => Promise.reject(new Error('not called')),
    'self-hosted',
    'local',
  );
  let t: TestApp;
  let admin: { authorization: string };
  let service: { authorization: string };

  beforeAll(async () => {
    t = await createTestApp({ provider: external, extraProviders: [selfHosted] });
    admin = {
      authorization: `Bearer ${await t.userToken({
        subject: 'platform-admin-1',
        roles: [PLATFORM_ADMIN],
        name: 'Amina Odhiambo',
      })}`,
    };
    service = { authorization: `Bearer ${await t.token()}` };
    return () => t.close();
  });

  afterEach(async () => {
    await t.db.delete(routes);
  });

  const request = (
    method: 'GET' | 'PUT' | 'DELETE',
    url: string,
    headers: Record<string, string>,
    payload?: object,
  ) => t.app.inject({ method, url, headers, ...(payload ? { payload } : {}) });

  /** Runs a task as review and waits for its end. */
  const run = async (tenant: string, dataClass: string, language = 'en') => {
    const response = await t.app.inject({
      method: 'POST',
      url: '/internal/v1/tasks/summarize-declaration',
      headers: { ...service, ...actingFor(tenant), 'idempotency-key': randomUUID() },
      payload: {
        dataClass,
        subjectRef: `review-case:${randomUUID()}`,
        promptVersion: null,
        waitSeconds: 10,
        input: { ...summarizeInput, language },
      },
    });
    let job = response.json<Job>();
    const deadline = Date.now() + 60_000;
    while (['queued', 'running'].includes(job.status)) {
      if (Date.now() > deadline) throw new Error(`job ${job.id} still ${job.status}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
      job = (
        await request('GET', `/internal/v1/jobs/${job.id}`, { ...service, ...actingFor(tenant) })
      ).json<Job>();
    }
    return job;
  };

  describe('access (S14)', () => {
    const route = { provider: 'local', model: 'llama-4', params: {}, approvalRef: 'EACC/AI/7' };
    const adminPaths: ['GET' | 'PUT' | 'DELETE', string, object?][] = [
      ['GET', '/v1/ai/policies'],
      [
        'PUT',
        '/v1/ai/policies/kcomm',
        {
          rules: [{ dataClass: 'restricted', providerClass: 'external', allowed: true }],
          approvalRef: 'EACC/AI/1',
        },
      ],
      ['GET', '/v1/ai/routing'],
      ['PUT', '/v1/ai/routing/explain-flags', route],
      ['DELETE', '/v1/ai/routing/explain-flags?approvalRef=EACC%2FAI%2F7'],
      ['PUT', '/v1/ai/tenants/kcomm/routing/explain-flags', route],
      ['DELETE', '/v1/ai/tenants/kcomm/routing/explain-flags?approvalRef=EACC%2FAI%2F7'],
      ['GET', '/v1/ai/usage'],
      ['GET', '/v1/ai/tenants/kcomm/usage'],
      ['PUT', '/v1/ai/tenants/kcomm/usage', { monthlyTokens: 1, perMinute: 1 }],
    ];

    it('refuses everyone but a platform admin on every /v1/ai path, and changes nothing', async () => {
      const commissionAdmin = {
        authorization: `Bearer ${await t.userToken({
          subject: 'commission-admin-1',
          roles: [COMMISSION_ADMIN, SUPERVISOR],
        })}`,
      };
      for (const [method, url, payload] of adminPaths) {
        for (const caller of [commissionAdmin, service]) {
          const response = await request(method, url, caller, payload);
          expect(response.statusCode, `${method} ${url}`).toBe(403);
        }
      }
      expect(await t.db.select().from(gatePolicies)).toEqual([]);
      expect(await t.db.select().from(routes)).toEqual([]);
    });

    it('serves the tenant status to services with the ai:internal scope, for the tenant they act for', async () => {
      const status = (path: string, headers: Record<string, string>) =>
        request('GET', `/internal/v1/tenants/${path}/status`, headers);
      expect((await status('kcomm', { ...admin, ...actingFor('kcomm') })).statusCode).toBe(403);
      expect((await status('kcomm', { ...service, ...actingFor('kcomm') })).statusCode).toBe(200);
      expect((await status('kcomm', service)).statusCode).toBe(400);
      expect((await status('kcomm', { ...service, ...actingFor('demo') })).statusCode).toBe(404);
      expect((await status('Not-A-Slug', { ...service, ...actingFor('kcomm') })).statusCode).toBe(
        400,
      );
    });
  });

  describe('gate policy (S16)', () => {
    it('applies several rules on one approval, audits each with the reference, and lists them', async () => {
      const before = await request('GET', '/v1/ai/policies', admin);
      expect(before.statusCode).toBe(200);
      expect(contractErrors('GatePolicyList', before.json())).toEqual([]);
      expect(before.json()).toMatchObject({
        defaults: [
          { dataClass: 'synthetic', providerClass: 'external', allowed: false },
          { dataClass: 'synthetic', providerClass: 'self-hosted', allowed: true },
          { dataClass: 'restricted', providerClass: 'external', allowed: false },
          { dataClass: 'restricted', providerClass: 'self-hosted', allowed: true },
          { dataClass: 'highly-confidential', providerClass: 'external', allowed: false },
          { dataClass: 'highly-confidential', providerClass: 'self-hosted', allowed: true },
        ],
      });

      const response = await request('PUT', '/v1/ai/policies/psc', admin, {
        rules: [
          { dataClass: 'restricted', providerClass: 'external', allowed: true },
          { dataClass: 'synthetic', providerClass: 'external', allowed: false },
        ],
        approvalRef: 'EACC/AI/2026/014',
      });

      expect(response.statusCode).toBe(200);
      const policy = response.json<{ tenant: string; rules: unknown[] }>();
      expect(contractErrors('TenantPolicy', policy)).toEqual([]);
      expect(policy).toEqual({
        tenant: 'psc',
        rules: [
          {
            dataClass: 'synthetic',
            providerClass: 'external',
            allowed: false,
            approvalRef: 'EACC/AI/2026/014',
            changedBy: 'platform-admin-1',
            changedByName: 'Amina Odhiambo',
            changedAt: expect.any(String) as string,
          },
          {
            dataClass: 'restricted',
            providerClass: 'external',
            allowed: true,
            approvalRef: 'EACC/AI/2026/014',
            changedBy: 'platform-admin-1',
            changedByName: 'Amina Odhiambo',
            changedAt: expect.any(String) as string,
          },
        ],
      });
      const changes = await t.db
        .select()
        .from(auditRecords)
        .where(eq(auditRecords.tenant, 'psc'))
        .orderBy(asc(auditRecords.id));
      expect(changes).toMatchObject([
        {
          action: 'ai.gate-policy.changed',
          actor: 'platform-admin-1',
          approvalRef: 'EACC/AI/2026/014',
          change: {
            before: { dataClass: 'restricted', allowed: false, explicit: false },
            after: { dataClass: 'restricted', allowed: true, explicit: true },
          },
        },
        {
          action: 'ai.gate-policy.changed',
          approvalRef: 'EACC/AI/2026/014',
          change: { after: { dataClass: 'synthetic', allowed: false } },
        },
      ]);
      const events = await t.db
        .select()
        .from(outbox)
        .where(sql`${outbox.envelope}->>'type' = 'ai.policy.changed.v1'`);
      expect(
        events.filter((row) => row.envelope.tenant === 'psc').map((row) => row.envelope.data),
      ).toMatchObject([{ approvalRef: 'EACC/AI/2026/014' }, { approvalRef: 'EACC/AI/2026/014' }]);

      const listed = await request('GET', '/v1/ai/policies', admin);
      expect(listed.json<{ tenants: unknown[] }>().tenants).toContainEqual(policy);

      // The gate follows the change at the next job.
      expect((await run('psc', 'restricted')).status).toBe('succeeded');
      expect((await run('psc', 'synthetic')).status).toBe('blocked');
    });

    it('audits concurrent first rules for a pair in the order they apply (review Q12)', async () => {
      for (let round = 0; round < 5; round++) {
        const tenant = `race${String(round)}`;
        const responses = await Promise.all(
          [true, false].map((allowed) =>
            request('PUT', `/v1/ai/policies/${tenant}`, admin, {
              rules: [{ dataClass: 'restricted', providerClass: 'external', allowed }],
              approvalRef: `EACC/AI/race/${String(allowed)}`,
            }),
          ),
        );
        for (const response of responses) expect(response.statusCode).toBe(200);
        const changes = await t.db
          .select()
          .from(auditRecords)
          .where(eq(auditRecords.tenant, tenant))
          .orderBy(asc(auditRecords.id));
        interface Change {
          before: { explicit: boolean; allowed: boolean };
          after: { allowed: boolean };
        }
        const [first, second] = changes.map((row) => row.change as Change);
        // Only the first change found no rule; the second saw the first's decision.
        expect(first?.before.explicit).toBe(false);
        expect(second?.before).toMatchObject({ explicit: true, allowed: first?.after.allowed });
      }
    });

    it('stores none of the rules when the change is invalid', async () => {
      const invalid = [
        {
          rules: [
            { dataClass: 'restricted', providerClass: 'external', allowed: true },
            { dataClass: 'restricted', providerClass: 'external', allowed: false },
          ],
          approvalRef: 'EACC/AI/2026/015',
        },
        {
          rules: [{ dataClass: 'restricted', providerClass: 'external', allowed: true }],
          approvalRef: '  ',
        },
        { rules: [], approvalRef: 'EACC/AI/2026/015' },
        {
          rules: [{ dataClass: 'secret', providerClass: 'external', allowed: true }],
          approvalRef: 'EACC/AI/2026/015',
        },
      ];
      for (const payload of invalid) {
        const response = await request('PUT', '/v1/ai/policies/nocomm', admin, payload);
        expect(response.statusCode).toBe(400);
        expect(contractErrors('ProblemDetails', response.json())).toEqual([]);
      }
      expect(
        await t.db.select().from(gatePolicies).where(eq(gatePolicies.tenant, 'nocomm')),
      ).toEqual([]);
    });
  });

  describe('budgets and usage (S5)', () => {
    it('sets a budget, audited, and reports usage that matches the jobs', async () => {
      const set = await request('PUT', '/v1/ai/tenants/kcomm/usage', admin, {
        monthlyTokens: 2000,
        perMinute: 30,
      });
      expect(set.statusCode).toBe(200);
      expect(contractErrors('TenantUsage', set.json())).toEqual([]);
      await t.seedDemoGate('kcomm');

      await run('kcomm', 'synthetic', 'en');
      await run('kcomm', 'synthetic', 'sw');
      await run('kcomm', 'highly-confidential');

      const response = await request('GET', '/v1/ai/tenants/kcomm/usage', admin);
      expect(response.statusCode).toBe(200);
      expect(contractErrors('TenantUsage', response.json())).toEqual([]);
      const [totals] = await t.db
        .select({
          tokens: sql<number>`sum(${jobs.tokensIn} + ${jobs.tokensOut})::int`,
          cost: sql<number>`sum(${jobs.costMicros})::int`,
        })
        .from(jobs)
        .where(eq(jobs.tenant, 'kcomm'));
      expect(response.json()).toEqual({
        tenant: 'kcomm',
        month: currentMonth(),
        monthlyTokens: 2000,
        perMinute: 30,
        tokensUsed: totals?.tokens,
        costMicros: totals?.cost,
        jobs: 3,
        blocked: 1,
        failed: 0,
      });
      expect(totals).toEqual({ tokens: 3000, cost: 2 * 10_800 });
      const [change] = await t.db
        .select()
        .from(auditRecords)
        .where(eq(auditRecords.action, 'ai.budget.changed'));
      expect(change).toMatchObject({
        tenant: 'kcomm',
        actor: 'platform-admin-1',
        change: { after: { monthlyTokens: 2000, perMinute: 30 } },
      });

      const list = await request('GET', '/v1/ai/usage', admin);
      expect(list.statusCode).toBe(200);
      expect(contractErrors('UsageList', list.json())).toEqual([]);
      const body = list.json<{ month: string; defaults: object; tenants: { tenant: string }[] }>();
      expect(body.month).toBe(currentMonth());
      expect(body.defaults).toEqual({
        monthlyTokens: expect.any(Number) as number,
        perMinute: expect.any(Number) as number,
      });
      expect(body.tenants.find((each) => each.tenant === 'kcomm')).toEqual(response.json());
      expect(body.tenants.map((each) => each.tenant)).toEqual(
        [...body.tenants.map((each) => each.tenant)].sort(),
      );
    });

    it('refuses the reserved platform context as a tenant (review N8)', async () => {
      for (const [method, url, payload] of [
        ['GET', '/v1/ai/tenants/platform/usage'],
        ['PUT', '/v1/ai/tenants/platform/usage', { monthlyTokens: 1, perMinute: 1 }],
        [
          'PUT',
          '/v1/ai/policies/platform',
          {
            rules: [{ dataClass: 'restricted', providerClass: 'external', allowed: true }],
            approvalRef: 'EACC/AI/1',
          },
        ],
      ] as const) {
        const response = await request(method, url, admin, payload);
        expect(response.statusCode, `${method} ${url}`).toBe(400);
      }
    });

    it('audits concurrent first budgets of a tenant in the order they apply (review Q12)', async () => {
      for (let round = 0; round < 5; round++) {
        const tenant = `brace${String(round)}`;
        await Promise.all(
          [100, 200].map((monthlyTokens) =>
            request('PUT', `/v1/ai/tenants/${tenant}/usage`, admin, {
              monthlyTokens,
              perMinute: 5,
            }),
          ),
        );
        const changes = await t.db
          .select()
          .from(auditRecords)
          .where(eq(auditRecords.tenant, tenant))
          .orderBy(asc(auditRecords.id));
        interface Change {
          before: { default?: boolean; monthlyTokens: number };
          after: { monthlyTokens: number };
        }
        const [first, second] = changes.map((row) => row.change as Change);
        expect(first?.before.default).toBe(true);
        expect(second?.before).toEqual({ monthlyTokens: first?.after.monthlyTokens, perMinute: 5 });
      }
    });

    it('refuses an invalid budget', async () => {
      for (const payload of [
        { monthlyTokens: -1, perMinute: 10 },
        { monthlyTokens: 1000, perMinute: 0 },
        { monthlyTokens: 1.5, perMinute: 10 },
        { monthlyTokens: 1000 },
      ]) {
        const response = await request('PUT', '/v1/ai/tenants/bcomm/usage', admin, payload);
        expect(response.statusCode).toBe(400);
      }
    });
  });

  describe('routing', () => {
    it('returns the effective table, with the configured route for tasks without a row', async () => {
      await t.db.insert(routes).values({
        id: uuidv7(),
        tenant: 'kcomm',
        task: 'explain-flags',
        provider: 'local',
        model: 'llama-4',
        params: { maxOutputTokens: 2048, timeoutMs: 30_000 },
        changedBy: 'platform-admin-1',
      });
      await t.db.insert(routes).values({
        id: uuidv7(),
        tenant: 'tsc',
        task: 'explain-flags',
        provider: 'elsewhere',
        model: 'm',
        changedBy: 'platform-admin-1',
      });

      const response = await request('GET', '/v1/ai/routing', admin);

      expect(response.statusCode).toBe(200);
      const table = response.json<object[]>();
      for (const route of table) expect(contractErrors('Route', route)).toEqual([]);
      expect(table).toContainEqual({
        tenant: 'kcomm',
        task: 'explain-flags',
        provider: 'local',
        providerClass: 'self-hosted',
        model: 'llama-4',
        params: { maxOutputTokens: 2048, timeoutMs: 30_000 },
        configured: false,
      });
      expect(table).toContainEqual(
        expect.objectContaining({ tenant: 'tsc', provider: 'elsewhere', providerClass: null }),
      );
      expect(table).toContainEqual({
        tenant: null,
        task: 'summarize-declaration',
        provider: 'scripted',
        providerClass: 'external',
        model: MODEL,
        params: {},
        configured: true,
      });
    });
  });

  describe('routing changes (story 17, review S2)', () => {
    it('routes a task for every tenant and for one, audited, and the next job follows', async () => {
      const set = await request('PUT', '/v1/ai/routing/summarize-declaration', admin, {
        provider: 'local',
        model: 'llama-4',
        params: { maxOutputTokens: 2048 },
        approvalRef: 'EACC/AI/2026/020',
      });
      expect(set.statusCode).toBe(200);
      expect(contractErrors('Route', set.json())).toEqual([]);
      expect(set.json()).toEqual({
        tenant: null,
        task: 'summarize-declaration',
        provider: 'local',
        providerClass: 'self-hosted',
        model: 'llama-4',
        params: { maxOutputTokens: 2048 },
        configured: false,
      });
      const override = await request(
        'PUT',
        '/v1/ai/tenants/rcomm/routing/summarize-declaration',
        admin,
        { provider: 'scripted', model: MODEL, approvalRef: 'EACC/AI/2026/021' },
      );
      expect(override.statusCode).toBe(200);
      expect(override.json()).toMatchObject({ tenant: 'rcomm', providerClass: 'external' });
      // A repeat replaces the route.
      expect(
        (
          await request('PUT', '/v1/ai/tenants/rcomm/routing/summarize-declaration', admin, {
            provider: 'scripted',
            model: 'claude-sonnet-5',
            approvalRef: 'EACC/AI/2026/022',
          })
        ).json(),
      ).toMatchObject({ model: 'claude-sonnet-5' });

      const table = (await request('GET', '/v1/ai/routing', admin)).json<object[]>();
      expect(table).toContainEqual(set.json());
      // Saved rows keep their place: by task, the default route first (e2e 29).
      expect(table.map((row) => [(row as RouteRow).task, (row as RouteRow).tenant])).toEqual([
        ['summarize-declaration', null],
        ['summarize-declaration', 'rcomm'],
        ['explain-flags', null],
        ['draft-clarification', null],
      ]);
      expect(table).toContainEqual(
        expect.objectContaining({ tenant: 'rcomm', model: 'claude-sonnet-5' }),
      );
      const changes = await t.db
        .select()
        .from(auditRecords)
        .where(eq(auditRecords.action, 'ai.route.changed'))
        .orderBy(asc(auditRecords.id));
      expect(changes).toMatchObject([
        {
          tenant: 'platform',
          actor: 'platform-admin-1',
          approvalRef: 'EACC/AI/2026/020',
          change: {
            before: { tenant: null, task: 'summarize-declaration', route: null },
            after: { route: { provider: 'local', model: 'llama-4' } },
          },
        },
        { tenant: 'rcomm', change: { before: { route: null } } },
        {
          tenant: 'rcomm',
          change: {
            before: { route: { model: MODEL } },
            after: { route: { model: 'claude-sonnet-5' } },
          },
        },
      ]);
      const events = await t.db
        .select()
        .from(outbox)
        .where(sql`${outbox.envelope}->'data'->>'action' = 'ai.route.changed'`);
      expect(events).toHaveLength(3);

      // The next job of another tenant goes to the default route's self-hosted provider.
      const job = await run('ocomm', 'restricted');
      const [ran] = await t.db
        .select({ provider: jobs.provider, model: jobs.model })
        .from(jobs)
        .where(eq(jobs.id, job.id));
      expect(ran).toEqual({ provider: 'local', model: 'llama-4' });

      expect(
        (
          await request(
            'DELETE',
            '/v1/ai/tenants/rcomm/routing/summarize-declaration?approvalRef=EACC%2FAI%2F2026%2F023',
            admin,
          )
        ).statusCode,
      ).toBe(204);
      expect(
        (
          await request(
            'DELETE',
            '/v1/ai/tenants/rcomm/routing/summarize-declaration?approvalRef=EACC%2FAI%2F2026%2F023',
            admin,
          )
        ).statusCode,
      ).toBe(404);
      expect(
        (await request('DELETE', '/v1/ai/routing/summarize-declaration?approvalRef=x', admin))
          .statusCode,
      ).toBe(204);
      expect(await t.db.select().from(routes)).toEqual([]);
      // Reset: the task is back on the configured provider and model.
      expect((await request('GET', '/v1/ai/routing', admin)).json()).toContainEqual({
        tenant: null,
        task: 'summarize-declaration',
        provider: 'scripted',
        providerClass: 'external',
        model: MODEL,
        params: {},
        configured: true,
      });
    });

    it('refuses a provider this gateway cannot reach, and an invalid route', async () => {
      for (const [url, payload] of [
        ['/v1/ai/routing/explain-flags', { provider: 'elsewhere', model: 'm', approvalRef: 'A/1' }],
        ['/v1/ai/routing/explain-flags', { provider: 'local', model: 'm' }],
        ['/v1/ai/routing/explain-flags', { provider: 'local', model: '', approvalRef: 'A/1' }],
        [
          '/v1/ai/routing/explain-flags',
          { provider: 'local', model: 'm', params: { effort: 'max' }, approvalRef: 'A/1' },
        ],
        ['/v1/ai/routing/unknown-task', { provider: 'local', model: 'm', approvalRef: 'A/1' }],
        [
          '/v1/ai/tenants/platform/routing/explain-flags',
          { provider: 'local', model: 'm', approvalRef: 'A/1' },
        ],
      ] as const) {
        const response = await request('PUT', url, admin, payload);
        expect(response.statusCode, JSON.stringify(payload)).toBe(400);
        expect(contractErrors('ProblemDetails', response.json())).toEqual([]);
      }
      expect((await request('DELETE', '/v1/ai/routing/explain-flags', admin)).statusCode).toBe(400);
      expect(await t.db.select().from(routes)).toEqual([]);
    });
  });

  describe('tenant AI status', () => {
    const status = async (tenant: string) => {
      const response = await request('GET', `/internal/v1/tenants/${tenant}/status`, {
        ...service,
        ...actingFor(tenant),
      });
      expect(contractErrors('TenantAiStatus', response.json())).toEqual([]);
      return response.json<unknown>();
    };
    const setGate = (tenant: string, rules: object[]) =>
      request('PUT', `/v1/ai/policies/${tenant}`, admin, { rules, approvalRef: 'EACC/AI/9' });

    it('is not enabled on an external route until the tenant has a rule', async () => {
      expect(await status('fresh')).toEqual({
        tenant: 'fresh',
        enabled: false,
        providerClass: 'external',
        provider: 'scripted',
        dataClasses: [],
      });

      await t.seedDemoGate('fresh');
      expect(await status('fresh')).toEqual({
        tenant: 'fresh',
        enabled: true,
        providerClass: 'external',
        provider: 'scripted',
        dataClasses: ['synthetic'],
      });
    });

    it('follows the tenant rules', async () => {
      await setGate('opened', [
        { dataClass: 'highly-confidential', providerClass: 'external', allowed: true },
      ]);
      expect(await status('opened')).toMatchObject({
        enabled: true,
        dataClasses: ['highly-confidential'],
      });

      // A rule blocking what an earlier rule allowed.
      await t.seedDemoGate('shut');
      await setGate('shut', [
        { dataClass: 'synthetic', providerClass: 'external', allowed: false },
      ]);
      expect(await status('shut')).toEqual({
        tenant: 'shut',
        enabled: false,
        providerClass: 'external',
        provider: 'scripted',
        dataClasses: [],
      });
    });

    it('names the routed provider class; mixed routes read as external', async () => {
      const routeAll = (tenant: string, tasks: string[]) =>
        t.db.insert(routes).values(
          tasks.map((task) => ({
            id: uuidv7(),
            tenant,
            task: task as 'explain-flags',
            provider: 'local',
            model: 'llama-4',
            changedBy: 'platform-admin-1',
          })),
        );
      await routeAll('onprem', ['summarize-declaration', 'explain-flags', 'draft-clarification']);
      expect(await status('onprem')).toEqual({
        tenant: 'onprem',
        enabled: true,
        providerClass: 'self-hosted',
        provider: 'local',
        dataClasses: ['synthetic', 'restricted', 'highly-confidential'],
      });

      await routeAll('mixed', ['explain-flags']);
      await t.seedDemoGate('mixed');
      expect(await status('mixed')).toMatchObject({
        providerClass: 'external',
        provider: 'scripted',
        dataClasses: ['synthetic'],
      });
    });

    it('is not enabled when no route names a reachable provider', async () => {
      await t.db.insert(routes).values(
        (['summarize-declaration', 'explain-flags', 'draft-clarification'] as const).map(
          (task) => ({
            id: uuidv7(),
            tenant: null,
            task,
            provider: 'elsewhere',
            model: 'm',
            changedBy: 'platform-admin-1',
          }),
        ),
      );
      expect(await status('kcomm')).toEqual({
        tenant: 'kcomm',
        enabled: false,
        providerClass: null,
        provider: null,
        dataClasses: [],
      });
    });
  });
});
