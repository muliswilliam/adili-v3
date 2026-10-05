import { declarationSchemes, findScheme } from '@adili/numbering/references';
import { type BadgeProps, formatDate } from '@adili/ui';

import type { ClarificationStatus, DeclarantClarification } from '../server/review/types';
import { LIST_COPY, STATUSES } from './copy';
import { type Countdown, countdown, isOpen, lateDays, reminderAt, reminderSent } from './deadline';

/**
 * What the declarant's clarification list and the dashboard card derive from the contract's
 * `DeclarantClarification[]` (`GET /v1/me/clarifications`, the whole list) and the clock. Pure.
 */

/** Rows per page of the "Earlier" group; the list comes whole, so it pages in the browser. */
export const LIST_PAGE_SIZE = 5;

const DECLARATION_SCHEME_CODES = new Set<string>(
  Object.values(declarationSchemes).map((scheme) => scheme.code),
);

/**
 * "initial declaration" for a `DCI-...` reference, and so on, from the numbering scheme's name;
 * "declaration" for anything else. Only the scheme code is read: the type is plain from it even
 * when the rest of the reference would not parse.
 */
export function declarationTypeName(reference: string): string {
  const scheme = findScheme(reference.split('-')[0] ?? '');
  return scheme && DECLARATION_SCHEME_CODES.has(scheme.code)
    ? scheme.name.toLowerCase()
    : LIST_COPY.declaration;
}

type Variant = NonNullable<BadgeProps['variant']>;

export interface RowTag {
  key: 'reminder' | 'late' | 'follow-up' | 'further-sent';
  label: string;
  variant: Variant;
}

export interface ClarificationRow {
  id: string;
  title: string;
  reference: string;
  commission: string;
  /** ["Issued 14 Sep 2026", "due 14 Oct 2026"], or how it ended: shown joined by " · ". */
  dates: string[];
  /** The status as it stands now: an issued one past its due date is overdue. */
  kind: ClarificationStatus;
  /** The badge: an overdue one says by how much. */
  status: { label: string; variant: Variant };
  /** Time left, while open and not yet overdue. */
  countdown: Countdown | null;
  tags: RowTag[];
}

function datesOf(clarification: DeclarantClarification): string[] {
  const { status, issuedAt, dueAt, respondedAt, resolvedAt } = clarification;
  const end =
    status === 'withdrawn'
      ? LIST_COPY.withdrawn
      : resolvedAt
        ? LIST_COPY.resolved(formatDate(resolvedAt))
        : respondedAt
          ? LIST_COPY.responded(formatDate(respondedAt))
          : dueAt
            ? LIST_COPY.due(formatDate(dueAt))
            : null;
  return [issuedAt ? LIST_COPY.issued(formatDate(issuedAt)) : null, end].filter(
    (part) => part !== null,
  );
}

/** One row of the list: what was asked of which declaration, its dates, status and tags. */
export function rowOf(
  clarification: DeclarantClarification,
  all: DeclarantClarification[],
  now: string,
): ClarificationRow {
  const { status, issuedAt, dueAt, respondedAt } = clarification;
  const open = isOpen(status);
  const left = open && dueAt ? countdown(dueAt, now) : null;
  const overdue = status === 'overdue' || left?.overdue === true;
  const kind: ClarificationStatus = open && overdue ? 'overdue' : status;
  const badge = STATUSES[kind];

  const tags: RowTag[] = [];
  if (open && !overdue && issuedAt && reminderSent(issuedAt, respondedAt, now)) {
    tags.push({
      key: 'reminder',
      label: LIST_COPY.reminderSent(formatDate(reminderAt(issuedAt))),
      variant: 'default',
    });
  }
  if (clarification.responseLate && respondedAt && dueAt) {
    tags.push({
      key: 'late',
      label: LIST_COPY.respondedLate(lateDays(dueAt, respondedAt)),
      variant: 'warning',
    });
  }
  if (clarification.followUpOf) {
    tags.push({ key: 'follow-up', label: LIST_COPY.furtherClarification, variant: 'default' });
  }
  if (all.some((each) => each.followUpOf === clarification.id)) {
    tags.push({ key: 'further-sent', label: LIST_COPY.furtherSent, variant: 'brand' });
  }

  return {
    id: clarification.id,
    title: LIST_COPY.rowTitle(
      clarification.items.length,
      declarationTypeName(clarification.declarationReference),
    ),
    reference: clarification.reference ?? '',
    commission: clarification.commission.name,
    dates: datesOf(clarification),
    kind,
    status: {
      label: kind === 'overdue' && left?.overdue ? left.text : badge.label.en,
      variant: badge.variant,
    },
    countdown: left && !left.overdue ? left : null,
    tags,
  };
}

const time = (iso: string | null) => (iso ? Date.parse(iso) : 0);

export interface ClarificationGroups {
  /** Issued or overdue, soonest due first. */
  open: DeclarantClarification[];
  /** Responded, resolved or withdrawn, newest first. */
  earlier: DeclarantClarification[];
}

export function groupClarifications(list: DeclarantClarification[]): ClarificationGroups {
  return {
    open: list.filter((each) => isOpen(each.status)).sort((a, b) => time(a.dueAt) - time(b.dueAt)),
    earlier: list
      .filter((each) => !isOpen(each.status))
      .sort((a, b) => time(b.issuedAt) - time(a.issuedAt)),
  };
}

/** How many clarifications wait for the declarant's response. */
export function openCount(list: DeclarantClarification[]): number {
  return list.filter((each) => isOpen(each.status)).length;
}

/** A page of `rows`, a page number past the end reading as the last page. */
export function pageOf<T>(rows: T[], page: number): { page: number; rows: T[] } {
  const last = Math.max(1, Math.ceil(rows.length / LIST_PAGE_SIZE));
  const current = Math.min(Math.max(1, page), last);
  return {
    page: current,
    rows: rows.slice((current - 1) * LIST_PAGE_SIZE, current * LIST_PAGE_SIZE),
  };
}

/** The dashboard card's rows: those needing a response, else the two latest. */
export function homeClarifications(list: DeclarantClarification[]): DeclarantClarification[] {
  const { open, earlier } = groupClarifications(list);
  return open.length > 0 ? open : earlier.slice(0, 2);
}

/**
 * The clarifications about one declaration, matched on the reference of any of its versions:
 * those needing a response first, soonest due, then the rest, newest first.
 */
export function declarationClarifications(
  list: DeclarantClarification[],
  references: string[],
): DeclarantClarification[] {
  const ours = new Set(references);
  const { open, earlier } = groupClarifications(
    list.filter((each) => ours.has(each.declarationReference)),
  );
  return [...open, ...earlier];
}
