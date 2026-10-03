import type { DeclarantNotice } from '../server/review/types';
import { isClosed } from './view';

/**
 * Where the declarant's salary stands, from a salary stoppage or disciplinary referral notice
 * (spec 08 FE-7, #208; S7, S10, US 20). Pure.
 *
 * - `stopped`: payroll stopped the salary and the ladder is open.
 * - `disciplinary`: the Commission asked the employer to start disciplinary proceedings; the
 *   salary stays stopped.
 * - `reinstating`: the declarant complied; the reinstatement is on its way to payroll.
 * - `reinstated`: payroll confirmed the reinstatement (`at`).
 */
export type SalaryStanding =
  | { kind: 'stopped'; notice: DeclarantNotice }
  | { kind: 'disciplinary'; notice: DeclarantNotice }
  | { kind: 'reinstating'; notice: DeclarantNotice }
  | { kind: 'reinstated'; notice: DeclarantNotice; at: string };

/** The salary's standing a notice tells, or null for a notice to comply or a warning. */
export function salaryStandingOf(notice: DeclarantNotice): SalaryStanding | null {
  if (notice.step === 'disciplinary-referral') {
    return isClosed(notice) ? null : { kind: 'disciplinary', notice };
  }
  if (notice.step !== 'salary-stoppage' || notice.salaryStoppedAt === null) return null;
  if (notice.salaryReinstatedAt !== null) {
    return { kind: 'reinstated', notice, at: notice.salaryReinstatedAt };
  }
  return isClosed(notice) ? { kind: 'reinstating', notice } : { kind: 'stopped', notice };
}

/**
 * The salary's standing to put on top of the Notices: an open disciplinary referral first, then
 * a stopped salary, then a reinstatement on its way, newest first. A confirmed reinstatement is
 * not shown on top. Null when the salary was never stopped, or is paid again.
 */
export function salaryOnTop(all: readonly DeclarantNotice[]): SalaryStanding | null {
  const standings = [...all]
    .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))
    .map(salaryStandingOf)
    .filter((each): each is SalaryStanding => each !== null && each.kind !== 'reinstated');
  return (
    standings.find((each) => each.kind === 'disciplinary') ??
    standings.find((each) => each.kind === 'stopped') ??
    standings.find((each) => each.kind === 'reinstating') ??
    null
  );
}
