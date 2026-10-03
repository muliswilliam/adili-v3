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

/**
 * The demo's approval for reading documents into the form (spec 05b): `extract-document` sends
 * a document as `highly-confidential`, since nothing minimises an image, and the demo tenant's
 * documents are synthetic. Its reviewer tasks still send `synthetic`, so this opens nothing else.
 */
export const DEMO_DOCUMENT_GATE_CHANGE: GateChange = {
  rules: [{ dataClass: 'highly-confidential', providerClass: 'external', allowed: true }],
  approvalRef: 'Demo set-up: synthetic documents read into the form only (spec 05b)',
};

const SEEDED_BY = { subject: 'system:demo-seed', name: 'Demo seed' };

/**
 * Records the demo tenants' rules (external on synthetic data, or `change`) through the gate, so
 * they are audited and announced like a platform admin's change. Idempotent: a tenant with a rule for the pair already
 * (seeded, or changed since by a platform admin) is left as it is, so it is safe to run on every
 * `pnpm db:seed`. Returns the tenants it changed.
 */
export async function seedDemoGatePolicies(
  gate: GatePolicies,
  tenants: readonly string[] = DEMO_TENANTS,
  change: GateChange = DEMO_GATE_CHANGE,
): Promise<string[]> {
  const changed: string[] = [];
  for (const tenant of tenants) {
    const rules = await gate.rules(tenant);
    const missing = change.rules.filter(
      (cell) =>
        !rules.some(
          (rule) => rule.dataClass === cell.dataClass && rule.providerClass === cell.providerClass,
        ),
    );
    if (missing.length === 0) continue;
    await gate.set(tenant, { ...change, rules: missing }, SEEDED_BY);
    changed.push(tenant);
  }
  return changed;
}
