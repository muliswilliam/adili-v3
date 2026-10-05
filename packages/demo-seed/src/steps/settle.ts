import { ok } from '../clients/api.js';
import { waitFor } from '../clients/http.js';
import type { SeedContext } from '../context.js';
import { DEMO_COMMISSIONS } from '../data/commissions.js';
import { PERSONAS } from '../data/personas.js';
import { syntheticOfficers } from '../data/synthetic.js';
import type { SeedStep } from '../step.js';
import { syntheticPlans } from './filings.js';

/** The declarations the filings step files per Commission: one review case each. */
async function expectedCases(context: SeedContext): Promise<Map<string, number>> {
  const expected = new Map<string, number>();
  const add = (slug: string, count: number) =>
    expected.set(slug, (expected.get(slug) ?? 0) + count);
  for (const persona of PERSONAS) add(persona.commission, persona.filings.current ? 2 : 1);
  for (const [slug, officers] of await syntheticOfficers(context)) {
    for (const officer of officers) add(slug, syntheticPlans(officer).length);
  }
  return expected;
}

/**
 * Waits until the services' workflows have caught up with the filings: every declaration has
 * its review case (risk scored, registries checked). A checkpoint taken earlier would freeze
 * work in flight.
 */
export const settle: SeedStep = {
  id: 'settle',
  title: 'Workflows caught up: a review case for every declaration',
  async run(context) {
    const notes: string[] = [];
    for (const [slug, expected] of await expectedCases(context)) {
      const commission = DEMO_COMMISSIONS.find((c) => c.slug === slug);
      if (!commission) continue;
      const api = await context.as(commission.reviewer);
      const total = await waitFor(
        `${slug}: ${String(expected)} review cases`,
        async () => {
          const summary = ok(
            await api.review.GET('/v1/commissions/{slug}/review/queue/summary', {
              params: { path: { slug } },
            }),
            `${slug} queue summary`,
          );
          const cases = Object.values(summary.byStatus as Record<string, number>).reduce(
            (sum, count) => sum + count,
            0,
          );
          return cases >= expected ? cases : undefined;
        },
        { timeoutMs: 45 * 60_000, intervalMs: 5000 },
      );
      notes.push(`${slug}: ${String(total)} review cases`);
    }
    return { changed: 0, notes };
  },
};
