import type { Assert, Priority, Same } from '@adili/ui';
import { z } from 'zod';

import type { paths } from '../server/review/api.gen';
import type { CaseStatus } from '../server/review/types';

/** The review service's queue query (review.yaml `listReviewQueue`). */
export type ReviewQueueQuery = NonNullable<
  paths['/v1/commissions/{slug}/review/queue']['get']['parameters']['query']
>;

/** The statuses the queue filters by (spec 07a FE-2), in the order the toolbar lists them. */
export const QUEUE_FILTER_STATUSES = [
  'unassigned',
  'assigned',
  'awaiting-clarification',
  'clarified',
  'ready-for-determination',
] as const satisfies readonly CaseStatus[];

export const QUEUE_BANDS = ['high', 'medium', 'low'] as const;

export const QUEUE_TYPES = ['initial', 'biennial', 'final'] as const;

/** Fails to compile when the lists drift from the contract. */
export type QueueFiltersMatchContract = [
  Assert<Same<(typeof QUEUE_BANDS)[number], NonNullable<ReviewQueueQuery['band']>>>,
  Assert<Same<(typeof QUEUE_BANDS)[number], Priority>>,
  Assert<Same<(typeof QUEUE_TYPES)[number], NonNullable<ReviewQueueQuery['type']>>>,
];

/** Page size of the queue: the review service's default. */
export const QUEUE_PAGE_SIZE = 50;

/** A value a hand-typed URL turned into a number or boolean, back as the text that was typed. */
const asText = (value: unknown) =>
  typeof value === 'number' || typeof value === 'boolean' ? String(value) : value;

/** A switch that only narrows: on is `true` (or `1` from a hand-typed URL); off is left out. */
const onlySwitch = z
  .preprocess(
    (value) => value === true || value === 'true' || value === 1 || value === '1',
    z.boolean(),
  )
  .transform((on) => (on ? (true as const) : undefined))
  .optional()
  .catch(undefined);

/**
 * Filters of the review queue, kept in the URL so a view can be shared, reloaded and reached with
 * Back (S19: `/review?band=high&late=true`). Unknown values are dropped rather than failing the
 * page; switches that are off are left out. `assignee` is `mine`, `unassigned` or an officer's
 * subject (a supervisor's choice); anyone is the default and is left out. Pages come from "Load
 * more" and are not part of the URL.
 */
export const queueSearchSchema = z.object({
  // A file number of digits alone arrives as a number from a hand-typed URL.
  search: z.preprocess(asText, z.string().trim().min(1).max(100).optional()).catch(undefined),
  status: z.enum(QUEUE_FILTER_STATUSES).optional().catch(undefined),
  band: z.enum(QUEUE_BANDS).optional().catch(undefined),
  type: z.enum(QUEUE_TYPES).optional().catch(undefined),
  cycle: z.coerce.number().int().min(2000).max(2999).optional().catch(undefined),
  // `any` is the default, so it is left out like any switch that is off.
  assignee: z
    .preprocess(
      asText,
      z
        .string()
        .trim()
        .min(1)
        .max(200)
        .refine((value) => value !== 'any')
        .optional(),
    )
    .catch(undefined),
  late: onlySwitch,
  openClarification: onlySwitch,
  registryUnavailable: onlySwitch,
});

export type QueueSearch = z.infer<typeof queueSearchSchema>;

const FILTER_KEYS = [
  'search',
  'status',
  'band',
  'type',
  'cycle',
  'assignee',
  'late',
  'openClarification',
  'registryUnavailable',
] as const satisfies readonly (keyof QueueSearch)[];

export type QueueFilterKey = (typeof FILTER_KEYS)[number];

/** Fails to compile when a filter is added to the schema but not to `FILTER_KEYS`. */
export type FilterKeysComplete = Assert<Same<QueueFilterKey, keyof QueueSearch>>;

export function hasQueueFilters(search: QueueSearch): boolean {
  return FILTER_KEYS.some((key) => search[key] !== undefined);
}

/** Leaves out filters that are off, so the URL holds only what is set, in a stable order. */
function compact(search: QueueSearch): QueueSearch {
  const out: Record<string, unknown> = {};
  for (const key of FILTER_KEYS) if (search[key] !== undefined) out[key] = search[key];
  return out;
}

/** The filters with one changed; `undefined` switches it off. */
export function withFilter<K extends QueueFilterKey>(
  search: QueueSearch,
  key: K,
  value: QueueSearch[K],
): QueueSearch {
  return compact({ ...search, [key]: value });
}

/** A switch (late, open clarification, registry unavailable) flipped. */
export function toggleSwitch(
  search: QueueSearch,
  key: 'late' | 'openClarification' | 'registryUnavailable',
): QueueSearch {
  return withFilter(search, key, search[key] ? undefined : true);
}

/** The summary tiles, each a shortcut to one filter (spec 07a FE-2). */
export const QUEUE_TILES = [
  'unassigned',
  'mine',
  'awaiting-clarification',
  'ready-for-determination',
] as const;

export type QueueTile = (typeof QUEUE_TILES)[number];

const TILE_FILTERS: Record<QueueTile, QueueSearch> = {
  unassigned: { status: 'unassigned' },
  mine: { assignee: 'mine' },
  'awaiting-clarification': { status: 'awaiting-clarification' },
  'ready-for-determination': { status: 'ready-for-determination' },
};

/** The tile's filter is what the list shows (other filters aside from the search are off). */
export function tilePressed(search: QueueSearch, tile: QueueTile): boolean {
  const wanted: QueueSearch = TILE_FILTERS[tile];
  return FILTER_KEYS.every((key) => key === 'search' || search[key] === wanted[key]);
}

/**
 * A tile pressed: the list shows its cases alone (keeping the search), or, when it already did,
 * everything again.
 */
export function toggleTile(search: QueueSearch, tile: QueueTile): QueueSearch {
  const text = search.search === undefined ? {} : { search: search.search };
  return tilePressed(search, tile) ? text : compact({ ...TILE_FILTERS[tile], ...text });
}

/**
 * The review service's query for a set of filters and the page after `cursor`. Filters that are
 * off are left out; anyone (no `assignee`) is the service's default.
 */
export function queueQuery(
  filters: QueueSearch,
  page: { cursor?: string | null; limit?: number } = {},
): ReviewQueueQuery {
  const query: ReviewQueueQuery = {};
  const search = filters.search?.trim();
  if (search) query.search = search;
  if (filters.status) query.status = filters.status;
  if (filters.band) query.band = filters.band;
  if (filters.type) query.type = filters.type;
  if (filters.cycle !== undefined) query.cycle = filters.cycle;
  if (filters.assignee) query.assignee = filters.assignee;
  if (filters.late) query.late = 'true';
  if (filters.openClarification) query.openClarification = 'true';
  if (filters.registryUnavailable) query.registryUnavailable = 'true';
  if (page.cursor) query.cursor = page.cursor;
  if (page.limit !== undefined) query.limit = page.limit;
  return query;
}

/**
 * The cycles to choose from: the current year and the two before it, newest first, then a cycle
 * already in the URL if it is another one (so the select can show it). review.yaml lists no
 * cycles, and a Commission's cases are for recent statement years.
 */
export function cycleOptions(now: number, selected: number | undefined): number[] {
  const year = new Date(now).getUTCFullYear();
  const years = [year, year - 1, year - 2];
  if (selected !== undefined && !years.includes(selected)) years.push(selected);
  return years.sort((a, b) => b - a);
}
