import {
  APPROVAL_KINDS,
  isInboxKind,
  type InboxKind,
  SUMMARIES,
  type Summaries,
} from '../approvals/kinds';
import type { ReviewClient } from './review/client.server';
import type { ApprovalItem, ApprovalKind, Assignee } from './review/types';
import { callService, type ServiceResult } from './service-call';

/**
 * The supervisors' approvals inbox (spec 08, S14): `GET /v1/commissions/{slug}/approvals`, one
 * kind at a time (each a tab), with every item's kind-specific summary read into a typed shape;
 * reassigning an approval; and the supervisors it can go to. Pure: the caller injects the client
 * (see `approvals.ts` for the server functions).
 *
 * review.yaml types `ApprovalItem.summary` as an open object, one shape per kind, read with the
 * kind's schema in `approvals/kinds.ts`.
 */

/** An approval of kind `K` as the inbox shows it: the contract's item, its summary typed. */
export type InboxItemOf<K extends InboxKind> = Omit<ApprovalItem, 'kind' | 'summary'> & {
  kind: K;
  summary: Summaries[K];
};

/** One approval as the inbox shows it, of any kind it shows. */
export type InboxItem = { [K in InboxKind]: InboxItemOf<K> }[InboxKind];

/** How many approvals have waited how long. */
export interface AgeCounts {
  under7Days: number;
  from7To30Days: number;
  over30Days: number;
}

/**
 * The pending approvals by kind (every kind, shown or not) and, within each kind, by how long
 * they have waited, so a tab's age bands count only what the tab lists (#712).
 */
export interface ApprovalCounts {
  byKind: Record<ApprovalKind, number>;
  byAge: Record<ApprovalKind, AgeCounts>;
}

export interface ApprovalsPage {
  items: InboxItem[];
  nextCursor: string | null;
  counts: ApprovalCounts;
}

export interface ApprovalsQuery {
  kind: InboxKind;
  cursor?: string;
  limit?: number;
}

/**
 * The counts the service sends, keyed by kind (`determination`) and by kind and age band
 * (`determination:under-7-days`); 0 for a missing key.
 */
function countsOf(counts: Record<string, number>): ApprovalCounts {
  const count = (key: string) => counts[key] ?? 0;
  const perKind = <T>(value: (kind: ApprovalKind) => T) =>
    Object.fromEntries(APPROVAL_KINDS.map((kind) => [kind, value(kind)])) as Record<
      ApprovalKind,
      T
    >;
  return {
    byKind: perKind(count),
    byAge: perKind((kind) => ({
      under7Days: count(`${kind}:under-7-days`),
      from7To30Days: count(`${kind}:7-to-30-days`),
      over30Days: count(`${kind}:over-30-days`),
    })),
  };
}

/** The item with its summary read by its kind's schema; null when it does not fit. */
function inboxItem(item: ApprovalItem): InboxItem | null {
  if (!isInboxKind(item.kind)) return null;
  // The one cast: an item of kind `item.kind` read by that kind's schema is that kind's member
  // of the union, which TypeScript cannot see through the generic.
  return itemOfKind(item.kind, item) as InboxItem | null;
}

/** `item` as an item of `kind`, its summary read by that kind's schema; null when it does not fit. */
function itemOfKind<K extends InboxKind>(kind: K, item: ApprovalItem): InboxItemOf<K> | null {
  const summary = SUMMARIES[kind].safeParse(item.summary);
  return summary.success ? { ...item, kind, summary: summary.data } : null;
}

/**
 * A page of one kind's pending approvals, oldest first, with `canApprove` for the caller and the
 * inbox's counts. A summary that does not fit its kind's schema is outside the contract: the page
 * reads as if review had not answered.
 */
export async function loadApprovals(
  client: ReviewClient,
  slug: string,
  query: ApprovalsQuery,
): Promise<ServiceResult<ApprovalsPage>> {
  const result = await callService(() =>
    client.GET('/v1/commissions/{slug}/approvals', {
      params: {
        path: { slug },
        query: {
          kind: query.kind,
          ...(query.cursor ? { cursor: query.cursor } : {}),
          ...(query.limit ? { limit: query.limit } : {}),
        },
      },
    }),
  );
  if (!result.ok) return result;
  const items: InboxItem[] = [];
  for (const item of result.data.items) {
    const read = inboxItem(item);
    if (!read) return { ok: false, error: { kind: 'unavailable', detail: null } };
    items.push(read);
  }
  return {
    ok: true,
    data: { items, nextCursor: result.data.nextCursor, counts: countsOf(result.data.counts) },
  };
}

/**
 * `POST /v1/review/approvals/{kind}/{subjectId}/reassign`: points the approval at another
 * supervisor. Informational: the separation-of-duties rule still decides who may approve.
 */
export async function reassignApproval(
  client: ReviewClient,
  kind: ApprovalKind,
  subjectId: string,
  toSupervisor: string,
): Promise<ServiceResult<{ reassignedTo: Assignee }>> {
  const result = await callService(() =>
    client.POST('/v1/review/approvals/{kind}/{subjectId}/reassign', {
      params: { path: { kind, subjectId } },
      body: { toSupervisor },
    }),
  );
  return result.ok ? { ok: true, data: { reassignedTo: result.data.reassignedTo } } : result;
}

/**
 * The Commission's supervisors an approval can be reassigned to, by name, the caller left out
 * (`GET .../review/queue/reviewers`, which lists reviewers and supervisors).
 */
export async function loadSupervisors(
  client: ReviewClient,
  slug: string,
  callerSubject: string,
): Promise<ServiceResult<Assignee[]>> {
  const result = await callService(() =>
    client.GET('/v1/commissions/{slug}/review/queue/reviewers', { params: { path: { slug } } }),
  );
  if (!result.ok) return result;
  return {
    ok: true,
    data: result.data.items
      .filter((member) => member.supervisor && member.subject !== callerSubject)
      .map(({ subject, name }) => ({ subject, name })),
  };
}
