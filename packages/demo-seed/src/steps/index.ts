import type { SeedStep } from '../step.js';
import { access } from './access.js';
import { verify } from './verify.js';
import { commissions } from './commissions.js';
import { cycles, policies } from './cycles.js';
import { filings } from './filings.js';
import { onboarding } from './onboarding.js';
import { rosters } from './rosters.js';
import { settle } from './settle.js';
import { syntheticPeople } from './synthetic.js';

/**
 * Every step of `pnpm demo:seed`, in the order they run. A step may rely on what the steps before
 * it made; add a later ticket's steps (#618 review, #619 Form M and EACC, #620 access) after the
 * ones they build on.
 */
export const STEPS: readonly SeedStep[] = [
  commissions,
  policies,
  cycles,
  syntheticPeople,
  rosters,
  onboarding,
  filings,
  settle,
  access,
  verify,
];
