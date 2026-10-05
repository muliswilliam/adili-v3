import type { FormMV1 } from '@adili/forms';
import {
  calendarDaysUntil,
  daysBetween,
  formatDate,
  formatDateTime,
  formatLongDate,
} from '@adili/ui';

import type { ComplianceReport, ReportPeriod } from '../../server/reporting/types';
import { finalCompileOf, previewFromOf } from './financial-year';
import { messages as m } from './messages';

/**
 * The Form M workspace's derived facts, as pure functions of the reporting service's answers and
 * today in Nairobi (`YYYY-MM-DD`): what each period card, banner, sign-off step and the footer say.
 */

/** Noon in Nairobi on a `YYYY-MM-DD` day, as epoch ms: a "now" for the calendar helpers. */
const noonOf = (day: string) => Date.parse(`${day}T12:00:00+03:00`);

/** Kenyan calendar days from `today` to `dueDate`: negative once it has passed. */
export function daysToDue(dueDate: string, today: string): number {
  return calendarDaysUntil(`${dueDate}T12:00:00+03:00`, noonOf(today));
}

/**
 * Whether the year has ended and its final draft is due to have been compiled (from 1 July
 * after it): a year without a report then needs compiling now, not a preview.
 */
export function yearEnded(fy: number, today: string): boolean {
  return today >= finalCompileOf(fy);
}

/** The line under a period's year: its preview window, days left, or when it was submitted. */
export function periodLine(period: ReportPeriod, today: string): string {
  const due = formatDate(period.dueDate);
  if (period.status === 'submitted' && period.submittedAt) {
    return m.submittedOn(formatDate(period.submittedAt), period.late === true);
  }
  const days = daysToDue(period.dueDate, today);
  if (period.status === 'not-started' && !yearEnded(period.fy, today)) {
    return period.previewAvailable
      ? m.previewAvailable(due)
      : m.previewFrom(formatDate(previewFromOf(period.fy)), due);
  }
  return days >= 0 ? m.dueIn(due, days) : m.wasDue(due, -days);
}

export type DueTone = 'neutral' | 'warning' | 'destructive';

/** The footer's "Due 31 July 2027 · 112 days left", amber within two weeks, red once overdue. */
export function dueLine(dueDate: string, today: string): { text: string; tone: DueTone } {
  const days = daysToDue(dueDate, today);
  const left = days >= 0 ? m.daysLeft(days) : m.daysOverdue(-days);
  return {
    text: `${m.dueFull(formatLongDate(dueDate))} · ${left}`,
    tone: days < 0 ? 'destructive' : days <= 14 ? 'warning' : 'neutral',
  };
}

/**
 * Whether the report is a preview: compiled from the data as it stood before its financial year
 * ended (30 June, Nairobi time). The scheduled compile on 1 July makes the final draft.
 */
export function isPreview(report: Pick<ComplianceReport, 'fy' | 'compiledAt'>): boolean {
  if (!report.compiledAt) return false;
  return daysBetween(report.compiledAt, `${finalCompileOf(report.fy)}T00:00:00+03:00`) > 0;
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * What the commission-admin has still to fill before confirming, in words: the Part I contact
 * fields, and Part B's question 6 (whether a complaints register is kept), which has no default.
 */
export function manualMissing(document: Pick<FormMV1, 'partI' | 'partII'>): string[] {
  const missing = partIMissing(document);
  if (document.partII.complaints.registerMaintained === null) {
    missing.push(m.missingFields.complaintsRegister);
  }
  return missing;
}

/** The Part I contact fields the commission-admin has still to fill, in words. */
export function partIMissing(document: Pick<FormMV1, 'partI'>): string[] {
  const { contactDetails, physicalAddress, emailAddress } = document.partI;
  const missing: string[] = [];
  if (!contactDetails.trim()) missing.push(m.missingFields.contactDetails);
  if (!physicalAddress.trim()) missing.push(m.missingFields.physicalAddress);
  if (!emailAddress.trim()) missing.push(m.missingFields.emailAddress);
  else if (!EMAIL.test(emailAddress.trim())) missing.push(m.missingFields.invalidEmail);
  return missing;
}

/**
 * When the supervisor reviewed the report, formatted: the date of their Part III signature, which
 * the header and the sign-off step both show. Null until they have signed.
 */
export function reviewedOn(document: Pick<FormMV1, 'partIII'>): string | null {
  const { date } = document.partIII.compiledBy;
  return date ? formatDate(date) : null;
}

export type SignOffState = 'done' | 'current' | 'upcoming';

export interface SignOffStep {
  id: 'compiled' | 'reviewed' | 'filled' | 'submitted';
  label: string;
  detail: string | null;
  state: SignOffState;
}

/**
 * The four steps from compile to submission (spec 09: supervisor reviews, commission-admin fills
 * Part I and Part B, then confirms), each done, the next one to take, or still to come.
 */
export function signOffSteps(
  report: Pick<
    ComplianceReport,
    'fy' | 'status' | 'compiledAt' | 'reviewedBy' | 'confirmedBy' | 'submittedAt' | 'document'
  >,
  missing: readonly string[],
): SignOffStep[] {
  const submitted = report.status === 'submitted';
  const reviewed = submitted || report.reviewedBy !== null;
  const filled = submitted || missing.length === 0;
  const reviewedDate = report.document ? reviewedOn(report.document) : null;
  const state = (done: boolean, next: boolean): SignOffState =>
    done ? 'done' : next ? 'current' : 'upcoming';
  return [
    {
      id: 'compiled',
      label: isPreview(report) ? m.steps.previewCompiled : m.steps.compiled,
      detail: report.compiledAt ? formatDateTime(report.compiledAt) : null,
      state: 'done',
    },
    {
      id: 'reviewed',
      label: m.steps.reviewed,
      detail: report.reviewedBy
        ? [report.reviewedBy.name, reviewedDate].filter(Boolean).join(', ')
        : null,
      state: state(reviewed, true),
    },
    {
      id: 'filled',
      label: m.steps.filled,
      detail: filled ? null : m.missing([...missing]),
      state: state(filled, reviewed),
    },
    {
      id: 'submitted',
      label: m.steps.submitted,
      detail:
        submitted && report.submittedAt
          ? [report.confirmedBy?.name, formatDateTime(report.submittedAt)]
              .filter(Boolean)
              .join(', ')
          : null,
      state: state(submitted, reviewed && filled),
    },
  ];
}
