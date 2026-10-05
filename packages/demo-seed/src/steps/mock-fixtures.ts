import { serviceScript } from '../repo.js';
import { type SeedStep, unchanged } from '../step.js';

/**
 * The mocks' named people (IPRS, KRA, HR) from `mocks/demo/fixtures`: the personas and every
 * officer of a roster fixture. `pnpm db:seed` loads them on a new stack; running the mocks' own
 * seed again here (it creates or refreshes, never duplicates) gives a stack seeded before a
 * fixture was added its people too, e.g. the hosted demo after a deploy.
 */
export const mockFixtures: SeedStep = {
  id: 'mock-fixtures',
  title: "The mocks' named people from the fixtures",
  async run() {
    await serviceScript('@adili/mocks', 'db:seed', []);
    return unchanged('created or refreshed');
  },
};
