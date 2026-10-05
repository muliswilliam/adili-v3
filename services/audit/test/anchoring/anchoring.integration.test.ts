import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { anchorObjectKey } from '../../src/anchoring/anchoring.js';
import { AUDIT_ANCHORING_WORKFLOW, type AnchoringResult } from '../../src/anchoring/contract.js';
import { config } from '../../src/config.js';
import { auditAnchors } from '../../src/db/schema.js';
import { chainDayOf } from '../../src/trail/chain.js';
import { type AuditApi, startAuditApi } from '../support/audit-api.js';
import { caseRead, freshTenant, submitted } from '../support/events.js';

let api: AuditApi;
const now = new Date();
const today = chainDayOf(now);
const yesterdayAt = new Date(now.getTime() - 86_400_000);
const yesterday = chainDayOf(yesterdayAt);

beforeAll(async () => {
  api = await startAuditApi();
});

afterAll(async () => {
  await api.close();
});

/** A chain of `tenant` recorded yesterday, of `events` events. */
async function yesterdaysChain(tenant: string, events = 3): Promise<void> {
  for (let at = 0; at < events; at += 1) {
    await api.trail.append(at % 2 === 0 ? submitted(tenant) : caseRead(tenant), yesterdayAt);
  }
}

async function anchorOf(tenant: string, chainDay: string) {
  const [anchor] = await api.db
    .select()
    .from(auditAnchors)
    .where(and(eq(auditAnchors.tenant, tenant), eq(auditAnchors.chainDay, chainDay)));
  return anchor;
}

describe('anchoring', () => {
  it('signs, archives and records the Merkle root of an ended day', async () => {
    const tenant = freshTenant();
    await yesterdaysChain(tenant);
    expect(await api.anchoring.anchor({ tenant, chainDay: yesterday })).toEqual({
      status: 'anchored',
    });

    const anchor = await anchorOf(tenant, yesterday);
    expect(anchor).toMatchObject({ eventCount: 3, keyName: 'audit-anchor', keyVersion: 1 });
    const archived = JSON.parse(
      api.archive.objects.get(anchorObjectKey({ tenant, chainDay: yesterday })) ?? '{}',
    ) as { statement: Record<string, unknown>; signature: Record<string, unknown> };
    expect(archived.statement).toMatchObject({
      v: 1,
      tenant,
      chainDay: yesterday,
      eventCount: 3,
      merkleRoot: anchor?.merkleRoot,
      headHash: anchor?.headHash,
    });
    expect(archived.signature).toMatchObject({ algorithm: 'ed25519', value: anchor?.signature });
    expect(await api.anchoring.verify({ tenant, chainDay: yesterday })).toMatchObject({
      status: 'intact',
      anchor: { status: 'matches' },
    });
  });

  it('anchors a chain once', async () => {
    const tenant = freshTenant();
    await yesterdaysChain(tenant);
    await api.anchoring.anchor({ tenant, chainDay: yesterday });
    expect(await api.anchoring.anchor({ tenant, chainDay: yesterday })).toEqual({
      status: 'already-anchored',
    });
  });

  it('never anchors a day still open', async () => {
    const tenant = freshTenant();
    await api.deliver(submitted(tenant));
    await expect(api.anchoring.anchor({ tenant, chainDay: today })).rejects.toThrow(/open/);
    expect(await api.anchoring.unanchoredChains()).not.toContainEqual({ tenant, chainDay: today });
  });

  it('never anchors a tampered chain', async () => {
    const tenant = freshTenant();
    await yesterdaysChain(tenant);
    await api.tamper(`update audit_events set hash = 'x' where tenant = '${tenant}' and seq = 2`);
    const outcome = await api.anchoring.anchor({ tenant, chainDay: yesterday });
    expect(outcome.status).toBe('tampered');
    expect(await anchorOf(tenant, yesterday)).toBeUndefined();
  });

  it('finds the events changed after their anchor, and a forged anchor', async () => {
    const tenant = freshTenant();
    await yesterdaysChain(tenant);
    await api.anchoring.anchor({ tenant, chainDay: yesterday });

    // Rewriting the anchor to match a shortened chain breaks its signature.
    await api.tamper(`update audit_anchors set event_count = 2 where tenant = '${tenant}'`);
    const forged = await api.anchoring.verify({ tenant, chainDay: yesterday });
    expect(forged.status).toBe('tampered');
    expect(forged.anchor.status).toBe('mismatch');
  });

  it('runs daily: anchors the ended days, then verifies the week again', async () => {
    const tenant = freshTenant();
    await yesterdaysChain(tenant, 2);
    const result = await api.temporal.workflow.execute<() => Promise<AnchoringResult>>(
      AUDIT_ANCHORING_WORKFLOW,
      { taskQueue: config.TEMPORAL_TASK_QUEUE, workflowId: `audit-anchoring-test-${tenant}` },
    );
    expect(result.anchored).toBeGreaterThanOrEqual(1);
    expect(result.tampered).not.toContainEqual({ tenant, chainDay: yesterday });
    expect(await anchorOf(tenant, yesterday)).toMatchObject({ eventCount: 2 });
  });
});
