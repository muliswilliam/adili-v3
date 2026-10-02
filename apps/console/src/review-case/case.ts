import { calendarDaysUntil, formatDate, plural } from '@adili/ui';

import type { Assignee, CaseDetail, CaseListItem } from '../server/review/types';

/**
 * Who may do what on a review case, and the facts its header states (spec 07a FE-3, S8):
 * reviewers and supervisors claim an unassigned case and release their own; a supervisor
 * reassigns or unassigns any, or assigns an unassigned one. The officer holding the case marks
 * its flags reviewed; anyone else reads it. Notes are open to every reviewer and supervisor of
 * the Commission, so a colleague can leave word. Pure.
 */

export interface CaseActions {
  /** The viewer holds the case. */
  mine: boolean;
  claim: boolean;
  release: boolean;
  /** Supervisor: reassign (held) or assign (unassigned) to another officer. */
  reassign: 'reassign' | 'assign' | null;
  unassign: boolean;
  /** Mark reviewed on the open flags. */
  reviewFlags: boolean;
  /** Someone else holds the case and the viewer is not a supervisor: read-only. */
  heldBy: Assignee | null;
}

export function caseActions(
  item: Pick<CaseListItem, 'assignee'>,
  viewerSubject: string,
  supervisor: boolean,
): CaseActions {
  const holder = item.assignee;
  const mine = holder?.subject === viewerSubject;
  return {
    mine,
    claim: holder === null,
    release: mine,
    reassign: supervisor ? (holder ? 'reassign' : 'assign') : null,
    unassign: supervisor && holder !== null,
    reviewFlags: mine,
    heldBy: holder && !mine && !supervisor ? holder : null,
  };
}

export interface WindowLine {
  open: boolean;
  text: string;
  /** Three weeks or less left: the header shows it in warning colours. */
  soon: boolean;
}

/** Days left in the window to request clarification, at which the header warns. */
export const WINDOW_WARN_DAYS = 21;

/** "Window closes 12 Oct 2026 · 16 days left", or "Window closed 2 Sep 2026". */
export function windowLine(windowEndsAt: string, now: number): WindowLine {
  const days = calendarDaysUntil(windowEndsAt, now);
  if (Date.parse(windowEndsAt) < now) {
    return { open: false, text: `Window closed ${formatDate(windowEndsAt)}`, soon: false };
  }
  const left = days <= 0 ? 'closes today' : `${plural(days, 'day')} left`;
  return {
    open: true,
    text: `Window closes ${formatDate(windowEndsAt)} · ${left}`,
    soon: days <= WINDOW_WARN_DAYS,
  };
}

/** "Version 2 of 2", and when the current version is an amendment, when it came. */
export function versionLine(detail: Pick<CaseDetail, 'case' | 'versions'>): {
  text: string;
  amendedAt: string | null;
} {
  const total = Math.max(detail.versions.length, detail.case.currentVersion);
  const current = detail.versions.find((each) => each.version === detail.case.currentVersion);
  return {
    text: `Version ${String(detail.case.currentVersion)} of ${String(total)}`,
    amendedAt: current?.amendment ? current.submittedAt : null,
  };
}

/**
 * Officers a supervisor can hand the case to: those the case already knows (its reviewers of
 * record) and the supervisor themself, never the current holder. review.yaml has no list of a
 * Commission's reviewers yet, so these are the only subjects the console can name.
 */
export function assignableOfficers(
  detail: Pick<CaseDetail, 'case' | 'reviewerHistory'>,
  viewer: Assignee,
): Assignee[] {
  const officers: Assignee[] = [];
  for (const officer of [...detail.reviewerHistory, viewer]) {
    if (officer.subject === detail.case.assignee?.subject) continue;
    if (officers.some((each) => each.subject === officer.subject)) continue;
    officers.push(officer);
  }
  return officers;
}

export const NOTE_MAX_LENGTH = 2000;

/** What is wrong with a note, or null when it can be added. */
export function noteError(text: string): string | null {
  if (!text.trim()) return 'Write a note first.';
  if (text.length > NOTE_MAX_LENGTH) return 'Notes can be up to 2,000 characters.';
  return null;
}

/**
 * What the Clarifications tab says above its list: until when the window is open for the
 * officer holding the case, or why they cannot issue one (spec 07a FE-4 words it).
 */
export function clarificationLine(
  item: Pick<CaseListItem, 'assignee' | 'windowEndsAt'>,
  viewerSubject: string,
  now: number,
): string {
  if (item.assignee?.subject !== viewerSubject) {
    return item.assignee
      ? `Only ${item.assignee.name}, who holds this case, can issue clarifications.`
      : 'Claim this case to issue a clarification.';
  }
  return Date.parse(item.windowEndsAt) < now
    ? `The clarification window closed on ${formatDate(item.windowEndsAt)}.`
    : `Window open until ${formatDate(item.windowEndsAt)}`;
}
