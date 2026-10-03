import type { FormMV1 } from '@adili/forms';
import { daysBetween, formatDate, formatDateTime, formatLongDate } from '@adili/ui';

import type { ComplianceReport, ReportPeriod } from '../../server/reporting/types';
import { finalCompileOf, previewFromOf } from './financial-year';
import { messages as m } from './messages';

/**
 * The Form M workspace's derived facts, as pure functions of the reporting service's answers and
 * today in Nairobi (`YYYY-MM-DD`): what each period card, banner, sign-off step and the footer say.
 */

/** Days from `today` to `dueDate`: negative once it has passed. */
export function daysToDue(dueDate: string, today: string): number {
  return daysBetween(`${today}T12:00:00Z`, `${dueDate}T12:00:00Z`);
}

/** The line under a period's year: its preview window, days left, or when it was submitted. */
export function periodLine(period: ReportPeriod, today: string): string {
  const due = formatDate(period.dueDate);
  if (period.status === 'submitted' && period.submittedAt) {
    return m.submittedOn(formatDate(period.submittedAt), period.late === true);
  }
  if (period.status === 'not-started') {
    return period.previewAvailable
      ? m.previewAvailable(due)
      : m.previewFrom(formatDate(previewFromOf(period.fy)), due);
  }
  const days = daysToDue(period.dueDate, today);
  return days >= 0 ? m.dueIn(due, days) : m.wasDue(due, -days);
}

export type DueTone = 'neutral' | 'warning' | 'danger';

/** The footer's "Due 31 July 2027 · 112 days left", amber within two weeks, red once overdue. */
export function dueLine(dueDate: string, today: string): { text: string; tone: DueTone } {
  const days = daysToDue(dueDate, today);
  const left = days >= 0 ? m.daysLeft(days) : m.daysOverdue(-days);
  return {
    text: `${m.dueFull(formatLongDate(dueDate))} · ${left}`,
    tone: days < 0 ? 'danger' : days <= 14 ? 'warning' : 'neutral',
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
    'fy' | 'status' | 'compiledAt' | 'reviewedBy' | 'confirmedBy' | 'submittedAt'
  >,
  missing: readonly string[],
): SignOffStep[] {
  const submitted = report.status === 'submitted';
  const reviewed = submitted || report.reviewedBy !== null;
  const filled = submitted || missing.length === 0;
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
      detail: report.reviewedBy?.name ?? null,
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
