import type { GateChange, GatePolicies } from './gate-policies.js';

/**
 * The demo tenants: their declarations are generated (review's `AI_SYNTHETIC_DATA_TENANTS`), so
 * the hosted demo lets the external provider see their synthetic data. Every other tenant keeps
 * the default, external blocked, until a platform admin approves a rule.
 */
export const DEMO_TENANTS = ['psc'] as const;

/** The demo's standing approval, recorded like any platform admin's decision. */
export const DEMO_GATE_CHANGE: GateChange = {
  rules: [{ dataClass: 'synthetic', providerClass: 'external', allowed: true, tasks: null }],
  approvalRef: 'Demo set-up: synthetic declarations only (spec 07c)',
};

/**
 * The demo's approval for reading documents into the form (spec 05b): `extract-document` sends
 * a document as `highly-confidential`, since nothing minimises an image, and the demo tenant's
 * documents are synthetic. The rule names that task: any other task sending the class to an
 * external provider stays blocked (ADR-007, amended 2026-10-03).
 */
export const DEMO_DOCUMENT_GATE_CHANGE: GateChange = {
  rules: [
    {
      dataClass: 'highly-confidential',
      providerClass: 'external',
      allowed: true,
      tasks: ['extract-document'],
    },
  ],
  approvalRef: 'Demo set-up: synthetic documents read into the form only (spec 05b)',
};

const SEEDED_BY = { subject: 'system:demo-seed', name: 'Demo seed' };

function sameTasks(a: readonly string[] | null, b: readonly string[] | null): boolean {
  if (a === null || b === null) return a === b;
  return a.length === b.length && a.every((task) => b.includes(task));
}

/**
 * Records the demo tenants' rules (external on synthetic data, or `change`) through the gate, so
 * they are audited and announced like a platform admin's change. Idempotent: a tenant whose rule
 * for the pair is the seed's own, as the seed has it now, or a platform admin's decision is left
 * as it is, so it is safe to run on every `pnpm db:seed`; a rule the seed recorded earlier with
 * other tasks is recorded again. Returns the tenants it changed.
 */
export async function seedDemoGatePolicies(
  gate: GatePolicies,
  tenants: readonly string[] = DEMO_TENANTS,
  change: GateChange = DEMO_GATE_CHANGE,
): Promise<string[]> {
  const changed: string[] = [];
  for (const tenant of tenants) {
    const rules = await gate.rules(tenant);
    const missing = change.rules.filter((cell) => {
      const rule = rules.find(
        (each) => each.dataClass === cell.dataClass && each.providerClass === cell.providerClass,
      );
      if (!rule) return true;
      // An earlier seed's rule with other tasks (before rules named tasks) is brought up to date.
      return rule.changedBy === SEEDED_BY.subject && !sameTasks(rule.tasks, cell.tasks ?? null);
    });
    if (missing.length === 0) continue;
    await gate.set(tenant, { ...change, rules: missing }, SEEDED_BY);
    changed.push(tenant);
  }
  return changed;
}
