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

/** The cycle years review.yaml accepts for the closures endpoints. */
export const CYCLE_YEARS = { min: 2000, max: 2100 } as const;

/** Parses `?cycle=&type=`, dropping what does not parse; `now` picks the default cycle. */
export function closureSearchSchema(now: () => number) {
  return z.object({
    cycle: z.coerce
      .number()
      .int()
      .min(CYCLE_YEARS.min)
      .max(CYCLE_YEARS.max)
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

/** One string per filter, to tell whether two requests ask for the same closures. */
export function closureFilterKey(filter: {
  cycleYear: number;
  type?: string | null;
  reportingEntityId?: string | null;
}): string {
  return `${String(filter.cycleYear)}|${filter.type ?? ''}|${filter.reportingEntityId ?? ''}`;
}
