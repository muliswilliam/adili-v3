import { ne, type SQL, sql } from 'drizzle-orm';

import { badRequest, conflict } from '../problems.js';
import { complianceReports, type ReportStatus } from './schema.js';

/**
 * A compliance report's statuses and the moves between them (spec 09), in one place:
 *
 * - none, `draft` or `reviewed` to `compiling`: a compile is asked for (supervisor, yearly compile);
 * - `compiling` to `draft`: the workflow saved the draft, unless a recompile was asked for while it
 *   ran, which leaves it `compiling`; new numbers are reviewed again;
 * - `draft` or `reviewed` to `reviewed`: the supervisor marks the draft reviewed;
 * - `reviewed` to `submitted`: the commission-admin confirms (hosted);
 * - anything but `submitted` to `submitted`: the Commission's system files its own (federated).
 *
 * A submitted report never moves again. Remarks, contact details and review are edited only on a
 * `draft` or `reviewed` report.
 */

/** Whether the report is submitted, and so never changes again. */
export function isSubmitted(report: { status: ReportStatus }): boolean {
  return report.status === 'submitted';
}

/** The columns of a report a compile was asked for at `at`: `compiling`. */
export function compileRequested(at: Date): { status: 'compiling'; compileRequestedAt: Date } {
  return { status: 'compiling', compileRequestedAt: at };
}

/**
 * The status a compile finishing at `compiledAt` leaves: `draft`, or `compiling` again when a
 * recompile was asked for after it started (the workflow compiles once more).
 */
export function statusAfterCompile(compiledAt: Date): SQL<ReportStatus> {
  return sql<ReportStatus>`case when ${complianceReports.compileRequestedAt} > ${compiledAt.toISOString()}::timestamptz then 'compiling' else 'draft' end`;
}

/** The condition of every move: the report is not submitted. */
export function notSubmitted(): SQL {
  return ne(complianceReports.status, 'submitted');
}

/** The status the supervisor's review moves a draft to. */
export const REVIEWED = 'reviewed' satisfies ReportStatus;

/** The status a confirmed or filed report ends in. */
export const SUBMITTED = 'submitted' satisfies ReportStatus;

/**
 * A draft can be edited (remarks, contact details, review, confirm): 409 `report-submitted` once
 * submitted, `report-compiling` while it is being compiled.
 */
export function requireEditable(report: { status: ReportStatus }): void {
  if (isSubmitted(report)) throw reportSubmitted();
  if (report.status === 'compiling') {
    throw conflict(
      'report-compiling',
      'The report is being compiled. Try again once the draft is ready.',
    );
  }
}

/** A report is confirmed once reviewed: 400 `not-reviewed` before. */
export function requireReviewed(report: { status: ReportStatus }): void {
  if (report.status === REVIEWED) return;
  throw badRequest('A supervisor marks the draft reviewed before it is confirmed.', {
    code: 'not-reviewed',
  });
}

/** A report is filed or compiled until it is submitted: 409 `report-submitted` after. */
export function requireNotSubmitted(report: { status: ReportStatus }): void {
  if (isSubmitted(report)) throw reportSubmitted();
}

/** 409 `report-submitted`: one report per Commission per year, frozen once submitted. */
function reportSubmitted() {
  return conflict('report-submitted', 'The report is submitted and can no longer change.');
}
