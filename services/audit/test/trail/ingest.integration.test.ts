import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { auditChainHeads, auditEvents } from '../../src/db/schema.js';
import { chainDayOf, eventHash, GENESIS_HASH } from '../../src/trail/chain.js';
import { type AuditApi, startAuditApi } from '../support/audit-api.js';
import { caseRead, freshTenant, submitted } from '../support/events.js';

let api: AuditApi;

beforeAll(async () => {
  api = await startAuditApi();
});

afterAll(async () => {
  await api.close();
});

async function chainOf(tenant: string) {
  return api.db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.tenant, tenant))
    .orderBy(asc(auditEvents.seq));
}

describe('ingest', () => {
  it('appends each event to its tenant chain of the day, each linked to the one before', async () => {
    const tenant = freshTenant();
    const events = [caseRead(tenant), submitted(tenant), caseRead(tenant)];
    for (const event of events) await api.deliver(event);

    const rows = await chainOf(tenant);
    expect(rows.map((row) => row.seq)).toEqual([1, 2, 3]);
    expect(rows.map((row) => row.eventId)).toEqual(events.map((event) => event.id));
    expect(rows.map((row) => row.kind)).toEqual(['read', 'write', 'read']);
    const day = chainDayOf(new Date());
    let prev = GENESIS_HASH;
    for (const row of rows) {
      expect(row.chainDay).toBe(day);
      expect(row.prevHash).toBe(prev);
      expect(row.hash).toBe(eventHash(prev, { tenant, chainDay: day, seq: row.seq }, row.envelope));
      prev = row.hash;
    }
    const [head] = await api.db
      .select()
      .from(auditChainHeads)
      .where(and(eq(auditChainHeads.tenant, tenant), eq(auditChainHeads.chainDay, day)));
    expect(head).toMatchObject({ seq: 3, headHash: prev });
  });

  it('appends a redelivered event once', async () => {
    const tenant = freshTenant();
    const event = submitted(tenant);
    await api.deliver(event);
    await api.deliver(event);
    expect(await chainOf(tenant)).toHaveLength(1);
  });

  it('keeps one chain per tenant, appending in parallel', async () => {
    const [a, b] = [freshTenant(), freshTenant()];
    await Promise.all(
      Array.from({ length: 10 }, (_, at) => api.deliver(at % 2 === 0 ? caseRead(a) : caseRead(b))),
    );
    expect((await chainOf(a)).map((row) => row.seq)).toEqual([1, 2, 3, 4, 5]);
    expect((await chainOf(b)).map((row) => row.seq)).toEqual([1, 2, 3, 4, 5]);
  });

  it('refuses an envelope that does not parse', async () => {
    await expect(api.deliver({ type: 'nonsense' })).rejects.toThrow();
  });
});

/** A query Postgres refused with `message`, as drizzle wraps it (`cause`). */
function refused(message: RegExp): Record<string, unknown> {
  return {
    cause: expect.objectContaining({
      message: expect.stringMatching(message) as unknown,
    }) as unknown,
  };
}

describe('append-only', () => {
  it('refuses to change or remove an event, or move a head back', async () => {
    const tenant = freshTenant();
    await api.deliver(submitted(tenant));
    await api.deliver(submitted(tenant));
    await expect(
      api.db.update(auditEvents).set({ action: 'nothing' }).where(eq(auditEvents.tenant, tenant)),
    ).rejects.toMatchObject(refused(/append-only/));
    await expect(
      api.db.delete(auditEvents).where(eq(auditEvents.tenant, tenant)),
    ).rejects.toMatchObject(refused(/append-only/));
    await expect(api.db.execute('truncate audit_events')).rejects.toMatchObject(
      refused(/append-only/),
    );
    await expect(
      api.db.update(auditChainHeads).set({ seq: 1 }).where(eq(auditChainHeads.tenant, tenant)),
    ).rejects.toMatchObject(refused(/forward/));
    await expect(
      api.db.delete(auditChainHeads).where(eq(auditChainHeads.tenant, tenant)),
    ).rejects.toMatchObject(refused(/forward/));
  });
});
