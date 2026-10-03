import { z } from 'zod';

import type { ClosureFilter, DeclarationType } from '../server/closures';

/** The bulk closure screen's filters in the URL: a cycle (the current year by default) and type. */
export interface ClosureSearch {
  cycle: number;
  type?: DeclarationType;
}

export const CLOSURE_TYPES = [
  'initial',
  'biennial',
  'final',
] as const satisfies readonly DeclarationType[];

/** Parses `?cycle=&type=`, dropping what does not parse; `now` picks the default cycle. */
export function closureSearchSchema(now: () => number) {
  return z.object({
    cycle: z.coerce
      .number()
      .int()
      .min(2000)
      .max(2100)
      .catch(() => new Date(now()).getUTCFullYear())
      .default(() => new Date(now()).getUTCFullYear()),
    type: z.enum(CLOSURE_TYPES).optional().catch(undefined),
  });
}

/** The review service's filter for the search. The band is always low; entities come later. */
export function closureFilter(search: ClosureSearch): ClosureFilter {
  return search.type === undefined
    ? { cycleYear: search.cycle }
    : { cycleYear: search.cycle, type: search.type };
}
