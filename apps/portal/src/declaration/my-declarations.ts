import type { DeclarationListItem } from '../server/declarations/types';

/**
 * The rules of "My declarations" (spec 06 FE-4), shared by the BFF and the page: the order and
 * pages of the list, and when a declaration can be amended (S19).
 */

const isOpen = (item: Pick<DeclarationListItem, 'status'>) =>
  item.status === 'draft' || item.status === 'amending';

/** Drafts and amendments in progress first, then by statement date, newest first. */
export function orderDeclarations<T extends Pick<DeclarationListItem, 'status' | 'statementDate'>>(
  items: T[],
): T[] {
  return items
    .filter((item) => item.status !== 'discarded')
    .sort(
      (a, b) =>
        Number(isOpen(b)) - Number(isOpen(a)) || b.statementDate.localeCompare(a.statementDate),
    );
}

export const PAGE_SIZES = [5, 10, 20] as const;
export type PageSize = (typeof PAGE_SIZES)[number];
export const DEFAULT_PAGE_SIZE: PageSize = 5;

export function isPageSize(value: number): value is PageSize {
  return (PAGE_SIZES as readonly number[]).includes(value);
}

/** The page's slice of `items`, with the page clamped to the pages there are (at least one). */
export function pageOf<T>(items: T[], page: number, pageSize: number) {
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(Math.max(1, Math.trunc(page)), pages);
  return {
    items: items.slice((current - 1) * pageSize, current * pageSize),
    page: current,
    pages,
  };
}

export type AmendAvailability =
  /** Submitted and the service says Amend is open (until the due date): "Amend". */
  | { kind: 'open'; version: number; dueDate: string }
  /** Submitted, and the due date has passed: "Amendments closed {due date}". */
  | { kind: 'closed'; dueDate: string }
  /** An amendment is in progress: Continue and Discard amendment. */
  | { kind: 'amending'; fromVersion: number }
  /** Nothing is filed yet (a draft), or it is gone. */
  | { kind: 'none' };

export type AmendFacts = Pick<
  DeclarationListItem,
  'status' | 'dueDate' | 'currentVersion' | 'amendingFromVersion' | 'amendable'
>;

/**
 * What a row offers for amending (S19, spec story 21). The service decides whether Amend is
 * open (`amendable`: submitted and today, a Kenyan calendar date, on or before the due date);
 * after the due date changes go through the Commission (clarifications, slice 07).
 */
export function amendAvailability(facts: AmendFacts): AmendAvailability {
  if (facts.status === 'amending') {
    return {
      kind: 'amending',
      fromVersion: facts.amendingFromVersion ?? facts.currentVersion ?? 1,
    };
  }
  if (facts.status !== 'submitted' || facts.currentVersion === null) return { kind: 'none' };
  return facts.amendable
    ? { kind: 'open', version: facts.currentVersion, dueDate: facts.dueDate }
    : { kind: 'closed', dueDate: facts.dueDate };
}
