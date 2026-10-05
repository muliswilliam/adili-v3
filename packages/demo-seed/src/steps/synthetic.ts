import { syntheticGeneration } from '../data/synthetic.js';
import type { SeedStep } from '../step.js';

/**
 * The synthetic officers' records in the simulated government systems (IPRS, KRA, HR, NTSA,
 * ArdhiSasa, BRS), so they onboard, and their registry checks find what they hold. The mocks have
 * no API a real system would offer for this; the demo endpoint is the simulator's own.
 */
export const syntheticPeople: SeedStep = {
  id: 'synthetic-people',
  title: 'Synthetic officers in the simulated registries',
  async run(context) {
    const { created, officers } = await syntheticGeneration(context);
    const counts = [...officers].map(([slug, list]) => `${slug} ${String(list.length)}`);
    return { changed: created, notes: [counts.join(', ')] };
  },
};
