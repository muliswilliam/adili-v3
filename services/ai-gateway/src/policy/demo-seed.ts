import type { GateChange, GatePolicies } from './gate-policies.js';

/**
 * The demo tenants: their declarations are generated (review's `AI_SYNTHETIC_DATA_TENANTS`), so
 * the hosted demo lets the external provider see their synthetic data. Every other tenant keeps
 * the default, external blocked, until a platform admin approves a rule.
 */
export const DEMO_TENANTS = ['psc'] as const;

/** The demo's standing approval, recorded like any platform admin's decision. */
export const DEMO_GATE_CHANGE: GateChange = {
  rules: [{ dataClass: 'synthetic', providerClass: 'external', allowed: true }],
  approvalRef: 'Demo set-up: synthetic declarations only (spec 07c)',
};

const SEEDED_BY = { subject: 'system:demo-seed', name: 'Demo seed' };

/**
 * Records the demo tenants' external-on-synthetic rule through the gate, so it is audited and
 * announced like a platform admin's change. Idempotent: a tenant with a rule for the pair already
 * (seeded, or changed since by a platform admin) is left as it is, so it is safe to run on every
 * `pnpm db:seed`. Returns the tenants it changed.
 */
export async function seedDemoGatePolicies(
  gate: GatePolicies,
  tenants: readonly string[] = DEMO_TENANTS,
): Promise<string[]> {
  const changed: string[] = [];
  for (const tenant of tenants) {
    const rules = await gate.rules(tenant);
    const missing = DEMO_GATE_CHANGE.rules.filter(
      (cell) =>
        !rules.some(
          (rule) => rule.dataClass === cell.dataClass && rule.providerClass === cell.providerClass,
        ),
    );
    if (missing.length === 0) continue;
    await gate.set(tenant, { ...DEMO_GATE_CHANGE, rules: missing }, SEEDED_BY);
    changed.push(tenant);
  }
  return changed;
}
