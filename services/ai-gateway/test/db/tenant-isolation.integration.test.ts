import { randomUUID } from 'node:crypto';

import { withTenant } from '@adili/data-access';
import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  auditRecords,
  budgets,
  feedback,
  gatePolicies,
  jobs,
  routes,
} from '../../src/db/schema.js';
import type { GatewayTransaction } from '../../src/db/context.js';
import { createTestApp, type TestApp } from '../support/test-app.js';

/** Row-level security of the gateway's tenant tables (ADR-006, review M2). */
describe('ai-gateway tables under row-level security', () => {
  let t: TestApp;
  const jobId = randomUUID();

  beforeAll(async () => {
    t = await createTestApp();
    await t.db.insert(jobs).values({
      id: jobId,
      tenant: 'psc',
      task: 'summarize-declaration',
      promptVersion: 1,
      dataClass: 'synthetic',
      subjectRef: `review-case:${randomUUID()}`,
      caller: 'review',
      idempotencyKey: randomUUID(),
      requestHash: 'h',
      inputHash: 'h',
      status: 'succeeded',
      provider: 'replay',
      model: 'm',
      output: { overview: 'psc only' },
      outputHash: 'h',
      finishedAt: new Date(),
    });
    await t.db.insert(gatePolicies).values({
      tenant: 'psc',
      dataClass: 'synthetic',
      providerClass: 'external',
      allowed: true,
      approvalRef: 'EACC/AI/1',
      changedBy: 'admin',
    });
    await t.db.insert(budgets).values({
      tenant: 'psc',
      monthlyTokens: 10,
      perMinute: 1,
      changedBy: 'admin',
    });
    await t.db.insert(feedback).values({
      id: uuidv7(),
      jobId,
      tenant: 'psc',
      reviewerSubject: 'reviewer-a',
      rating: 'helpful',
    });
    await t.db.insert(auditRecords).values({
      id: uuidv7(),
      action: 'ai.budget.changed',
      tenant: 'psc',
      actor: 'admin',
    });
    await t.db.insert(routes).values([
      {
        id: uuidv7(),
        tenant: 'psc',
        task: 'explain-flags',
        provider: 'p',
        model: 'm',
        changedBy: 'a',
      },
      {
        id: uuidv7(),
        tenant: null,
        task: 'explain-flags',
        provider: 'p',
        model: 'm',
        changedBy: 'a',
      },
    ]);
    return () => t.close();
  });

  const asTsc = <T>(work: (tx: GatewayTransaction) => Promise<T>) =>
    withTenant(t.serviceDb, { tenant: 'tsc', subject: 'test' }, work);

  it("another Commission's transactions see none of the rows", async () => {
    await asTsc(async (tx) => {
      for (const table of [jobs, gatePolicies, budgets, feedback, auditRecords]) {
        expect(await tx.select().from(table)).toEqual([]);
      }
      // Default routes (no tenant) are every tenant's; psc's own route is not.
      expect((await tx.select().from(routes)).map((row) => row.tenant)).toEqual([null]);
    });
  });

  it("another Commission's transactions cannot write the rows", async () => {
    await asTsc(async (tx) => {
      const updated = await tx.update(jobs).set({ output: null }).returning();
      expect(updated).toEqual([]);
    });
    await expect(
      asTsc((tx) =>
        tx
          .insert(budgets)
          .values({ tenant: 'psc', monthlyTokens: 0, perMinute: 1, changedBy: 'x' }),
      ),
    ).rejects.toThrow();
    await expect(
      asTsc((tx) =>
        tx.insert(routes).values({
          id: uuidv7(),
          tenant: null,
          task: 'summarize-declaration',
          provider: 'p',
          model: 'm',
          changedBy: 'x',
        }),
      ),
    ).rejects.toThrow();
  });

  it('sees nothing at all without a tenant context', async () => {
    const rows = await t.serviceDb.execute(sql`select count(*)::int as n from jobs`);
    expect(rows.rows).toEqual([{ n: 0 }]);
  });

  it('lets the tenant itself see and write its rows', async () => {
    await withTenant(t.serviceDb, { tenant: 'psc', subject: 'test' }, async (tx) => {
      expect(await tx.select({ id: jobs.id }).from(jobs)).toEqual([{ id: jobId }]);
      expect(await tx.select().from(feedback)).toHaveLength(1);
    });
  });
});
