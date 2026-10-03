import { outbox } from '@adili/events';
import { eq, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import { auditRecords } from '../../src/db/schema.js';
import {
  DEMO_DOCUMENT_GATE_CHANGE,
  DEMO_GATE_CHANGE,
  seedDemoGatePolicies,
} from '../../src/policy/demo-seed.js';
import { GatePolicies } from '../../src/policy/gate-policies.js';
import { createTestApp, type TestApp } from '../support/test-app.js';

/**
 * The demo seed (spec 07c S2, S16): the demo tenant's external-on-synthetic rule is recorded
 * through the gate, with an approval reference, an audit record and an event, once.
 */
describe('demo gate seed', () => {
  let t: TestApp;
  let gate: GatePolicies;

  beforeAll(async () => {
    t = await createTestApp();
    gate = t.app.get(GatePolicies);
    return () => t.close();
  });

  const changesOf = (tenant: string) =>
    t.db.select().from(auditRecords).where(eq(auditRecords.tenant, tenant));

  it('allows external providers on the demo tenant’s synthetic data, audited and announced', async () => {
    expect(await gate.admits('psc', 'synthetic', 'external', 'summarize-declaration')).toBe(false);

    expect(await seedDemoGatePolicies(gate)).toEqual(['psc']);

    expect(await gate.rules('psc')).toEqual([
      {
        dataClass: 'synthetic',
        providerClass: 'external',
        allowed: true,
        tasks: null,
        approvalRef: DEMO_GATE_CHANGE.approvalRef,
        changedBy: 'system:demo-seed',
        changedByName: 'Demo seed',
        changedAt: expect.any(String) as string,
      },
    ]);
    expect(await gate.admits('psc', 'restricted', 'external', 'summarize-declaration')).toBe(false);
    const [change] = await changesOf('psc');
    expect(change).toMatchObject({
      action: 'ai.gate-policy.changed',
      actor: 'system:demo-seed',
      approvalRef: DEMO_GATE_CHANGE.approvalRef,
      change: {
        before: { dataClass: 'synthetic', providerClass: 'external', allowed: false },
        after: { dataClass: 'synthetic', providerClass: 'external', allowed: true },
      },
    });
    const events = await t.db
      .select()
      .from(outbox)
      .where(sql`${outbox.envelope}->>'subject' = ${change?.id}`);
    expect(events.map((row) => row.envelope.type)).toEqual(['ai.policy.changed.v1']);
  });

  it('changes nothing when run again', async () => {
    await seedDemoGatePolicies(gate);
    const before = await changesOf('psc');

    expect(await seedDemoGatePolicies(gate)).toEqual([]);

    expect(await changesOf('psc')).toHaveLength(before.length);
  });

  it('leaves a platform admin’s later decision as it is', async () => {
    await gate.set(
      'closeddemo',
      {
        rules: [{ dataClass: 'synthetic', providerClass: 'external', allowed: false }],
        approvalRef: 'Commission resolution 3/2026',
      },
      { subject: 'platform-admin-1', name: null },
    );

    expect(await seedDemoGatePolicies(gate, ['closeddemo'])).toEqual([]);

    expect(await gate.admits('closeddemo', 'synthetic', 'external', 'summarize-declaration')).toBe(
      false,
    );
  });

  it('lets the demo tenant read its synthetic documents into the form (spec 05b)', async () => {
    expect(await seedDemoGatePolicies(gate, ['docdemo'], DEMO_DOCUMENT_GATE_CHANGE)).toEqual([
      'docdemo',
    ]);

    expect(
      await gate.admits('docdemo', 'highly-confidential', 'external', 'extract-document'),
    ).toBe(true);
    // The approval is the document task's alone: every other task keeps the default, blocked.
    for (const task of [
      'summarize-declaration',
      'explain-flags',
      'draft-clarification',
      'narrate-compliance-report',
      'answer-declarant-question',
    ] as const) {
      expect(await gate.admits('docdemo', 'highly-confidential', 'external', task)).toBe(false);
    }
    expect(await gate.admits('docdemo', 'restricted', 'external', 'extract-document')).toBe(false);
    expect(await gate.rules('docdemo')).toMatchObject([
      {
        dataClass: 'highly-confidential',
        providerClass: 'external',
        tasks: ['extract-document'],
        approvalRef: DEMO_DOCUMENT_GATE_CHANGE.approvalRef,
      },
    ]);
    expect(await seedDemoGatePolicies(gate, ['docdemo'], DEMO_DOCUMENT_GATE_CHANGE)).toEqual([]);
  });
});
