import { daysBetween, formatDate, formatDateTime, plural } from '@adili/ui';

import type { ClarificationLink } from '../server/clarifications.server';
import type { DeclarantClarification } from '../server/review/types';
import { COPY } from './copy';
import { countdown, isOpen, lateDays, reminderAt, reminderSent } from './deadline';

/** What the clarification page derives from the contract's fields and the clock. Pure. */

export interface Period {
  title: string;
  detail: string;
  tone: 'neutral' | 'warning' | 'danger' | 'success';
  /** Days used of the response period, while it runs. */
  progress: { day: number; of: number } | null;
}

/** The response period panel: time left, time over, or how the response landed. */
export function periodOf(clarification: DeclarantClarification, now: string): Period {
  const { status, issuedAt, dueAt, respondedAt } = clarification;
  if (status === 'withdrawn' || !issuedAt || !dueAt) {
    return {
      title: COPY.noResponseNeeded,
      detail: COPY.withdrawnPeriod,
      tone: 'neutral',
      progress: null,
    };
  }
  if (respondedAt) {
    const late = clarification.responseLate;
    return {
      title: late
        ? `Responded ${plural(lateDays(dueAt, respondedAt), 'day')} late`
        : COPY.respondedOnTime,
      detail: COPY.submittedDue(formatDateTime(respondedAt), formatDate(dueAt)),
      tone: late ? 'warning' : 'success',
      progress: null,
    };
  }
  const left = countdown(dueAt, now);
  if (left.overdue) {
    return {
      title: left.text,
      detail: COPY.wasDue(formatDate(dueAt)),
      tone: 'danger',
      progress: null,
    };
  }
  const of = Math.max(1, daysBetween(issuedAt, dueAt));
  const day = Math.min(of, Math.max(0, daysBetween(issuedAt, now)));
  return {
    title: left.text,
    detail: COPY.dueDay(formatDate(dueAt), day, of),
    tone: left.tone,
    progress: { day, of },
  };
}

export interface HistoryEntry {
  key: string;
  title: string;
  detail: string | null;
}

/** The clarification's history as the declarant sees it, oldest first. */
export function historyOf(
  clarification: DeclarantClarification,
  followUps: ClarificationLink[],
  now: string,
): HistoryEntry[] {
  const { status, issuedAt, dueAt, respondedAt, resolvedAt } = clarification;
  const entries: HistoryEntry[] = [];
  if (!issuedAt || !dueAt) return entries;
  entries.push({
    key: 'issued',
    title: COPY.issuedBy(clarification.commission.name),
    detail: formatDateTime(issuedAt),
  });
  if (status !== 'withdrawn' && reminderSent(issuedAt, respondedAt, now)) {
    entries.push({
      key: 'reminder',
      title: COPY.reminderSent,
      detail: formatDate(reminderAt(issuedAt)),
    });
  }
  if (status === 'overdue' || clarification.responseLate) {
    entries.push({ key: 'due-passed', title: COPY.duePassed, detail: formatDate(dueAt) });
  }
  if (respondedAt) {
    entries.push({
      key: 'responded',
      title: clarification.responseLate
        ? COPY.youRespondedLate(lateDays(dueAt, respondedAt))
        : COPY.youResponded,
      detail: formatDateTime(respondedAt),
    });
  }
  for (const followUp of followUps) {
    entries.push({
      key: `follow-up-${followUp.id}`,
      title: COPY.furtherSentShort,
      detail: followUp.reference,
    });
  }
  if (resolvedAt)
    entries.push({ key: 'resolved', title: COPY.resolvedShort, detail: formatDate(resolvedAt) });
  if (status === 'withdrawn')
    entries.push({ key: 'withdrawn', title: COPY.withdrawnShort, detail: null });
  if (isOpen(status))
    entries.push({ key: 'due', title: COPY.responseDue, detail: formatDate(dueAt) });
  return entries;
}
