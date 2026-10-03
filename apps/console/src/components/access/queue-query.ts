import { z } from 'zod';

import type { QueueStatus } from '../../server/access/types';

/**
 * The access requests queue's filters (spec 10 FE-5), kept in the URL so a view can be shared,
 * reloaded and reached with Back. One filter at a time, as the prototype's chips; the search
 * combines with it. Unknown values are dropped rather than failing the page.
 */
export const QUEUE_FILTERS = ['all', 'action', 'window', 'late', 'decided', 'closed'] as const;

export type QueueFilter = (typeof QUEUE_FILTERS)[number];

/**
 * The queue's tabs: every request, Form K requests, or law enforcement requests (Regs r.23), the
 * prototype's request types. All is the default and stays out of the URL.
 */
export const QUEUE_TABS = ['all', 'form-k', 'lea'] as const;

export type QueueTab = (typeof QUEUE_TABS)[number];

/** The filters a tab offers: law enforcement requests have no window for representations. */
export function filtersFor(tab: QueueTab): readonly QueueFilter[] {
  return tab === 'lea' ? QUEUE_FILTERS.filter((filter) => filter !== 'window') : QUEUE_FILTERS;
}

/** Requests per page of the queue. */
export const QUEUE_PAGE_SIZE = 20;

export const queueSearchSchema = z.object({
  kind: z.enum(QUEUE_TABS).exclude(['all']).optional().catch(undefined),
  filter: z.enum(QUEUE_FILTERS).exclude(['all']).optional().catch(undefined),
  search: z
    .preprocess(
      // A reference typed in full is text; a file number of digits alone arrives as a number.
      (value) => (typeof value === 'number' ? String(value) : value),
      z.string().trim().min(1).max(200).optional(),
    )
    .catch(undefined),
  cursor: z.string().max(500).optional().catch(undefined),
});

export type QueueSearch = z.infer<typeof queueSearchSchema>;

/**
 * The statuses that need the access officer: verify, identify, decide; for a law enforcement
 * request, verify and decide.
 */
export const NEEDS_ACTION: readonly QueueStatus[] = [
  'submitted',
  'pending-applicant-verification',
  'officer-unresolved',
  'under-decision',
  'received',
  'verified',
];

export const DECIDED: readonly QueueStatus[] = ['granted', 'partially-granted', 'denied'];

export const CLOSED: readonly QueueStatus[] = ['cannot-identify', 'withdrawn'];

/**
 * The access service's query for a tab and filter: the kind, statuses or the late flag. The
 * service applies statuses to each kind, so one list serves both.
 */
export interface QueueServiceQuery {
  kind?: 'form-k' | 'lea';
  status?: string;
  late?: 'true';
  search?: string;
  cursor?: string;
  limit: number;
}

export function queueServiceQuery(
  search: QueueSearch,
  limit: number = QUEUE_PAGE_SIZE,
): QueueServiceQuery {
  const query: QueueServiceQuery = { limit };
  if (search.kind) query.kind = search.kind;
  switch (search.filter) {
    case 'action':
      query.status = NEEDS_ACTION.join(',');
      break;
    case 'window':
      // Form K's window for representations; a law enforcement request has none.
      query.status = 'awaiting-representations';
      break;
    case 'late':
      query.late = 'true';
      break;
    case 'decided':
      query.status = DECIDED.join(',');
      break;
    case 'closed':
      query.status = CLOSED.join(',');
      break;
    case undefined:
      break;
  }
  if (search.search) query.search = search.search;
  if (search.cursor) query.cursor = search.cursor;
  return query;
}

/** Whether anything narrows the queue, so an empty page means "no matches", not "no requests". */
export function hasQueueFilters(search: QueueSearch): boolean {
  return Boolean(search.filter ?? search.search);
}
