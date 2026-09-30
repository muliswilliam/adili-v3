import type { Assert, Same } from '@adili/ui';
import { z } from 'zod';

import type {
  CommissionObligationsSummary,
  ListObligationsQuery,
  ObligationType,
} from '../../server/declarations/client';

export const OBLIGATION_TYPES = ['initial', 'biennial', 'final'] as const;

/** The statuses the list filters by; filed obligations arrive with spec 06. */
export const OBLIGATION_FILTER_STATUSES = ['upcoming', 'due', 'overdue'] as const;

export type ObligationFilterStatus = (typeof OBLIGATION_FILTER_STATUSES)[number];

/**
 * Fails to compile when the lists drift from the contract: every obligation type is offered,
 * and every filter status is one the list operation accepts.
 */
export type FiltersMatchContract = [
  Assert<Same<(typeof OBLIGATION_TYPES)[number], ObligationType>>,
  Assert<Same<(typeof OBLIGATION_TYPES)[number], NonNullable<ListObligationsQuery['type']>>>,
  Assert<ObligationFilterStatus extends NonNullable<ListObligationsQuery['status']> ? true : false>,
];

/** Page size of the obligations list: the declarations service's default. */
export const OBLIGATIONS_PAGE_SIZE = 50;

/** A cycle key as the declarations service writes it, e.g. `biennial:2027`. */
const CYCLE_KEY = /^[a-z]+:[0-9-]{4,10}$/;

/** A value a hand-typed URL turned into a number or boolean, back as the text that was typed. */
const asText = (value: unknown) =>
  typeof value === 'number' || typeof value === 'boolean' ? String(value) : value;

/**
 * Filters of the obligations list, kept in the URL so a view can be shared, reloaded and reached
 * with Back (S23). Unknown values are dropped rather than failing the page. `onboarded` has three
 * states: absent (any), true or false. Pages come from "Load more" and are not part of the URL.
 */
export const obligationsSearchSchema = z.object({
  // A file number of digits alone arrives as a number from a hand-typed URL.
  search: z.preprocess(asText, z.string().trim().min(1).max(100).optional()).catch(undefined),
  type: z.enum(OBLIGATION_TYPES).optional().catch(undefined),
  status: z.enum(OBLIGATION_FILTER_STATUSES).optional().catch(undefined),
  onboarded: z
    .preprocess(
      (value) => (value === 'true' ? true : value === 'false' ? false : value),
      z.boolean().optional(),
    )
    .catch(undefined),
  cycle: z.string().regex(CYCLE_KEY).optional().catch(undefined),
});

export type ObligationsSearch = z.infer<typeof obligationsSearchSchema>;

export function hasObligationFilters(search: ObligationsSearch): boolean {
  return (
    search.search !== undefined ||
    search.type !== undefined ||
    search.status !== undefined ||
    search.onboarded !== undefined ||
    search.cycle !== undefined
  );
}

/** Leaves out filters that are off, so the URL holds only what is set. */
function compact(search: ObligationsSearch): ObligationsSearch {
  const { search: text, type, status, onboarded, cycle } = search;
  return {
    ...(text === undefined ? {} : { search: text }),
    ...(type === undefined ? {} : { type }),
    ...(status === undefined ? {} : { status }),
    ...(onboarded === undefined ? {} : { onboarded }),
    ...(cycle === undefined ? {} : { cycle }),
  };
}

/** The filters with one changed; `undefined` switches it off. */
export function withFilter<K extends keyof ObligationsSearch>(
  search: ObligationsSearch,
  key: K,
  value: ObligationsSearch[K],
): ObligationsSearch {
  return compact({ ...search, [key]: value });
}

/** A status tile pressed: filters the list by its status, or stops filtering when it already did. */
export function toggleStatus(
  search: ObligationsSearch,
  status: ObligationFilterStatus,
): ObligationsSearch {
  return withFilter(search, 'status', search.status === status ? undefined : status);
}

/**
 * "Show in list" on the not-onboarded callout: declarants who have not onboarded, whatever their
 * status (the callout counts due and overdue together). The other filters stay.
 */
export function showNotOnboarded(search: ObligationsSearch): ObligationsSearch {
  return compact({ ...search, onboarded: false, status: undefined });
}

/**
 * The declarations service's query for a set of filters and the page after `cursor`. Filters
 * that are off are left out.
 */
export function obligationsQuery(
  filters: ObligationsSearch,
  page: { cursor?: string | null; limit?: number } = {},
): ListObligationsQuery {
  const query: ListObligationsQuery = {};
  const search = filters.search?.trim();
  if (search) query.search = search;
  if (filters.type) query.type = filters.type;
  if (filters.status) query.status = filters.status;
  if (filters.onboarded !== undefined) query.onboarded = filters.onboarded ? 'true' : 'false';
  if (filters.cycle) query.cycle = filters.cycle;
  if (page.cursor) query.cursor = page.cursor;
  if (page.limit !== undefined) query.limit = page.limit;
  return query;
}

/** One entry of the cycle select. */
export interface CycleOption {
  key: string;
  /** The key as words, e.g. "Biennial 2027". */
  label: string;
  /** False while the cycle has not opened: it has no biennial obligations yet. */
  opened: boolean;
}

/** `biennial:2027` → "Biennial 2027"; keys of other shapes read as themselves. */
export function cycleLabel(key: string): string {
  const [kind, year] = key.split(':');
  if (kind === 'biennial' && year && /^\d{4}$/.test(year)) return `Biennial ${year}`;
  return key;
}

/**
 * The cycles to choose from: those opened, oldest first, and the current cycle while it has not
 * opened yet (shown, not selectable), then a cycle already in the URL if it is another one (so the
 * select can show it).
 */
export function cycleOptions(
  summary: CommissionObligationsSummary | null,
  selected: string | undefined,
): CycleOption[] {
  const options: CycleOption[] = [];
  if (summary) {
    for (const cycle of summary.cycles) {
      if (cycle.opened || cycle.key === summary.cycle.key) {
        options.push({ key: cycle.key, label: cycleLabel(cycle.key), opened: cycle.opened });
      }
    }
    if (!options.some((option) => option.key === summary.cycle.key)) {
      const { key, opened } = summary.cycle;
      options.push({ key, label: cycleLabel(key), opened });
    }
  }
  if (selected && !options.some((option) => option.key === selected)) {
    options.push({ key: selected, label: cycleLabel(selected), opened: true });
  }
  return options;
}

/** Declarants with a due or overdue obligation who have not onboarded. */
export function notOnboardedCount(summary: CommissionObligationsSummary): number {
  return summary.notOnboarded.due + summary.notOnboarded.overdue;
}
