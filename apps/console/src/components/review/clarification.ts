import type { Clarification, ClarificationStatus, Requirement } from '../../server/review/client';
import { formatDate, formatDateTime } from '../format';

/**
 * The clarification detail's rules and words (spec 07a FE-4, S15): which of Mark resolved, Raise
 * follow-up and Withdraw the viewer gets, the line that says where the clarification stands, and
 * the checks on the resolve and withdraw dialogs. Pure; the clock is passed in.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** Nairobi is UTC+3 all year. */
const NAIROBI_OFFSET_MS = 3 * 60 * 60 * 1000;
/** The ClarificationWorkflow reminds the declarant on day 20 unless they have responded. */
const REMINDER_DAY = 20;

export const RESOLVE_NOTE_MAX = 2000;
export const WITHDRAW_REASON_MAX = 1000;

function dayNumber(iso: string): number {
  return Math.floor((Date.parse(iso) + NAIROBI_OFFSET_MS) / DAY_MS);
}

/** Calendar days from `from` to `to` in Kenyan time. */
export function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * DAY_MS).toISOString();
}

export function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? '' : 's'}`;
}

/** Act s.35(4), in the words the composer and the letter use. */
export const REQUIREMENT_LABELS = {
  'provide-omitted': 'Provide the omitted information',
  'explain-discrepancy': 'Explain the discrepancy or inconsistency',
  correct: 'Correct the entry',
} satisfies Record<Requirement, string>;

export type StatusTone = 'neutral' | 'info' | 'brand' | 'success' | 'warning' | 'destructive';

export const CLARIFICATION_STATUSES = {
  draft: { label: 'Draft', tone: 'neutral' },
  issued: { label: 'Issued', tone: 'info' },
  responded: { label: 'Responded', tone: 'brand' },
  resolved: { label: 'Resolved', tone: 'success' },
  overdue: { label: 'Overdue', tone: 'destructive' },
  withdrawn: { label: 'Withdrawn', tone: 'neutral' },
} satisfies Record<ClarificationStatus, { label: string; tone: StatusTone }>;

export interface ClarificationActions {
  resolve: boolean;
  followUp: 'hidden' | 'enabled' | 'disabled';
  withdraw: boolean;
}

/**
 * The actions on a clarification. Only the case's assignee acts (a supervisor reassigns first).
 * Resolve while it is out or answered; follow up once answered, resolved or overdue, while the
 * six-month window is open; withdraw only before a response.
 */
export function clarificationActions({
  status,
  mine,
  windowOpen,
}: {
  status: ClarificationStatus;
  mine: boolean;
  windowOpen: boolean;
}): ClarificationActions {
  if (!mine) return { resolve: false, followUp: 'hidden', withdraw: false };
  const followUpShown = status === 'responded' || status === 'resolved' || status === 'overdue';
  return {
    resolve: status === 'issued' || status === 'responded' || status === 'overdue',
    followUp: followUpShown ? (windowOpen ? 'enabled' : 'disabled') : 'hidden',
    withdraw: status === 'issued' || status === 'overdue',
  };
}

export interface StatusLine {
  tone: 'neutral' | 'info' | 'success' | 'warning' | 'destructive';
  title: string;
  body: string;
}

type StatusFields = Pick<
  Clarification,
  'status' | 'issuedAt' | 'dueAt' | 'respondedAt' | 'responseLate' | 'resolvedAt' | 'resolutionNote'
>;

/** Where the clarification stands, in one callout. */
export function statusLine(clarification: StatusFields, now: string): StatusLine {
  const { status, issuedAt, dueAt, respondedAt, resolvedAt } = clarification;
  switch (status) {
    case 'draft':
      return { tone: 'neutral', title: 'Not sent.', body: 'The declarant cannot see drafts.' };
    case 'withdrawn':
      return {
        tone: 'neutral',
        title: 'Withdrawn.',
        body: 'Letter revoked as issued in error; no response needed.',
      };
    case 'resolved':
      return {
        tone: 'success',
        title: resolvedAt ? `Resolved ${formatDate(resolvedAt)}.` : 'Resolved.',
        body: clarification.resolutionNote ?? '',
      };
    case 'overdue':
      return {
        tone: 'destructive',
        title: dueAt ? `Overdue since ${formatDate(addDays(dueAt, 1))}.` : 'Overdue.',
        body: 'A notice to comply is drafted for approval under Actions.',
      };
    case 'responded': {
      const on = respondedAt ? `On ${formatDateTime(respondedAt)}.` : '';
      if (clarification.responseLate && dueAt && respondedAt) {
        const days = Math.max(1, daysBetween(dueAt, respondedAt));
        return { tone: 'warning', title: `Responded ${plural(days, 'day')} late`, body: on };
      }
      return { tone: 'success', title: 'Responded on time', body: on };
    }
    case 'issued': {
      if (!issuedAt || !dueAt)
        return { tone: 'info', title: 'Waiting for the declarant.', body: '' };
      const left = daysBetween(now, dueAt);
      const due = left <= 0 ? 'Due today.' : `Due in ${plural(left, 'day')}.`;
      const reminder = addDays(issuedAt, REMINDER_DAY);
      const reminded = daysBetween(issuedAt, now) >= REMINDER_DAY;
      return {
        tone: 'info',
        title: 'Waiting for the declarant.',
        body: `${due} Reminder ${reminded ? 'sent' : 'goes'} ${formatDate(reminder)}.`,
      };
    }
  }
}

export function resolveNoteError(note: string): string | null {
  if (!note.trim()) return 'Add a note so colleagues know why it is resolved.';
  if (note.length > RESOLVE_NOTE_MAX) return 'Keep the note to 2,000 characters or fewer.';
  return null;
}

export function withdrawReasonError(reason: string): string | null {
  if (!reason.trim()) return 'Give a reason. It is kept with the record.';
  if (reason.length > WITHDRAW_REASON_MAX) return 'Keep the reason to 1,000 characters or fewer.';
  return null;
}

/** What resolving does to the case, given the other clarifications still open on it. */
export function resolveOutcome(othersOpen: number): string {
  return othersOpen > 0
    ? `${plural(othersOpen, 'other clarification')} still open. The case stays awaiting clarification.`
    : 'The case becomes ready for determination.';
}

/** Statuses still waiting on the declarant or the reviewer. */
export function isOutstanding(status: ClarificationStatus): boolean {
  return status === 'issued' || status === 'responded' || status === 'overdue';
}

export interface HistoryEntry {
  key: string;
  title: string;
  at: string;
}

/**
 * The clarification's own history, oldest first. The day-20 reminder and the overdue mark are
 * the ClarificationWorkflow's; they are derived here from the dates the contract carries.
 */
export function historyOf(
  clarification: StatusFields & Pick<Clarification, 'reference'>,
  now: string,
): HistoryEntry[] {
  const { status, issuedAt, dueAt, respondedAt, resolvedAt } = clarification;
  if (!issuedAt || !dueAt) return [];
  const entries: HistoryEntry[] = [
    {
      key: 'issued',
      title: `Issued ${clarification.reference ?? ''} · letter produced · email and SMS sent`,
      at: formatDateTime(issuedAt),
    },
  ];
  const reminder = addDays(issuedAt, REMINDER_DAY);
  if (
    status !== 'withdrawn' &&
    daysBetween(issuedAt, respondedAt ?? now) >= REMINDER_DAY &&
    (!respondedAt || Date.parse(respondedAt) > Date.parse(reminder))
  ) {
    entries.push({
      key: 'reminder',
      title: 'Reminder sent by email and SMS (day 20)',
      at: formatDate(reminder),
    });
  }
  if (status === 'overdue') {
    entries.push({ key: 'overdue', title: 'Marked overdue', at: formatDate(addDays(dueAt, 1)) });
  }
  if (respondedAt) {
    entries.push({
      key: 'responded',
      title: clarification.responseLate ? 'Response received, late' : 'Response received',
      at: formatDateTime(respondedAt),
    });
  }
  if (resolvedAt)
    entries.push({ key: 'resolved', title: 'Marked resolved', at: formatDate(resolvedAt) });
  if (status === 'withdrawn') {
    entries.push({
      key: 'withdrawn',
      title: 'Withdrawn · letter revoked as issued in error',
      at: '',
    });
  }
  return entries;
}
