import { daysBetween, formatDate, formatDateTime, plural } from '@adili/ui';

import type { Clarification } from '../server/review/types';
import type { Tone } from './labels';
import { lateDays, reminderAt, reminderSent } from './period';

/**
 * Where a clarification stands and what happened to it, from the contract's fields and the
 * clock (spec 07a FE-4). Pure. Only what the record shows: the declarant's notifications and any
 * enforcement belong to other services and specs.
 */

export interface StatusLine {
  tone: Tone;
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
        title: dueAt ? `Overdue since ${formatDate(dueAt)}.` : 'Overdue.',
        body: 'Not answered by the due date. The declarant can still respond; the response will be marked late.',
      };
    case 'responded': {
      const on = respondedAt ? `On ${formatDateTime(respondedAt)}.` : '';
      if (clarification.responseLate && dueAt && respondedAt) {
        const days = lateDays(dueAt, respondedAt);
        return { tone: 'warning', title: `Responded ${plural(days, 'day')} late`, body: on };
      }
      return { tone: 'success', title: 'Responded on time', body: on };
    }
    case 'issued': {
      if (!issuedAt || !dueAt)
        return { tone: 'info', title: 'Waiting for the declarant.', body: '' };
      const left = daysBetween(now, dueAt);
      const due = left <= 0 ? 'Due today.' : `Due in ${plural(left, 'day')}.`;
      const sent = reminderSent(issuedAt, null, now);
      return {
        tone: 'info',
        title: 'Waiting for the declarant.',
        body: `${due} Reminder ${sent ? 'sent' : 'goes'} ${formatDate(reminderAt(issuedAt))}.`,
      };
    }
  }
}

export interface HistoryEntry {
  key: string;
  title: string;
  at: string;
}

/**
 * The clarification's own history, oldest first. The day-20 reminder and the overdue mark are
 * the ClarificationWorkflow's; they are derived from the dates the contract carries. The case
 * timeline (with recorded events) is the case view's.
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
      title: `Issued ${clarification.reference ?? ''}`,
      at: formatDateTime(issuedAt),
    },
  ];
  if (status !== 'withdrawn' && reminderSent(issuedAt, respondedAt, now)) {
    entries.push({
      key: 'reminder',
      title: 'Reminder sent by email and SMS (day 20)',
      at: formatDate(reminderAt(issuedAt)),
    });
  }
  if (status === 'overdue') {
    entries.push({ key: 'overdue', title: 'Marked overdue', at: formatDate(dueAt) });
  }
  if (respondedAt) {
    entries.push({
      key: 'responded',
      title: clarification.responseLate ? 'Response received, late' : 'Response received',
      at: formatDateTime(respondedAt),
    });
  }
  if (resolvedAt) {
    entries.push({ key: 'resolved', title: 'Marked resolved', at: formatDate(resolvedAt) });
  }
  if (status === 'withdrawn') {
    entries.push({
      key: 'withdrawn',
      title: 'Withdrawn · letter revoked as issued in error',
      at: '',
    });
  }
  return entries;
}
