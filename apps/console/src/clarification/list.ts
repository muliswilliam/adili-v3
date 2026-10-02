import { messages as t } from '../components/review/composer/messages';
import type { CaseListItem, Clarification } from '../server/review/types';
import { lateDays } from './period';

/**
 * The case's clarifications tab (spec 07a FE-4): each clarification's dates in one line, and why
 * "New clarification" is unavailable when it is. Pure.
 */

type LineFields = Pick<
  Clarification,
  'status' | 'issuedAt' | 'dueAt' | 'respondedAt' | 'responseLate' | 'resolvedAt'
> & { items: readonly unknown[] };

/** "Issued 8 Sep 2026 · due 8 Oct 2026", "Not sent · 2 items", and so on. */
export function listLine(clarification: LineFields): string {
  const { status, issuedAt, dueAt, respondedAt, resolvedAt } = clarification;
  if (status === 'draft' || !issuedAt) return t.list.draftLine(clarification.items.length);
  const parts = [t.list.issued(issuedAt)];
  if (status === 'withdrawn') parts.push(t.list.withdrawn);
  else if (respondedAt) {
    parts.push(
      clarification.responseLate && dueAt
        ? t.list.respondedLate(respondedAt, lateDays(dueAt, respondedAt))
        : t.list.responded(respondedAt),
    );
  } else if (dueAt) parts.push(t.list.due(dueAt));
  if (resolvedAt) parts.push(t.list.resolved(resolvedAt));
  return parts.join(' · ');
}

/**
 * Why the viewer cannot start a clarification, or null when they can: only the reviewer holding
 * the case issues them (a supervisor claims or reassigns first), within the six-month window.
 */
export function newClarificationBlock(
  reviewCase: Pick<CaseListItem, 'assignee' | 'windowEndsAt'>,
  subject: string,
  now: string,
): string | null {
  const { assignee, windowEndsAt } = reviewCase;
  if (!assignee) return t.list.claimFirst;
  if (assignee.subject !== subject) return t.list.heldBy(assignee.name);
  if (Date.parse(now) > Date.parse(windowEndsAt)) return t.list.windowClosed(windowEndsAt);
  return null;
}
