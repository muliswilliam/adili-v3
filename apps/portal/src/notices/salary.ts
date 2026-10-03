import type { DeclarantNotice } from '../server/review/types';
import { isClosed, ladderNotices } from './view';

/**
 * Where the declarant's salary stands, from a salary stoppage or disciplinary referral notice
 * (spec 08 FE-7, #208; S7, S10, US 20). Pure.
 *
 * - `stopped`: payroll stopped the salary and the ladder is open.
 * - `disciplinary`: the Commission asked the reporting entity to start disciplinary proceedings; the
 *   salary stays stopped.
 * - `reinstating`: the declarant complied (the stoppage notice reads `complied`); the
 *   reinstatement is on its way to payroll. A ladder that ended without compliance leaves its
 *   issued notices `issued`, and `DeclarantNotice` carries no ladder status, so that case reads
 *   `stopped` until payroll confirms the reinstatement (#518).
 * - `reinstated`: payroll confirmed the reinstatement (`at`). The notice no longer says why the
 *   ladder closed, so neither does the copy.
 */
export type SalaryStanding =
  | { kind: 'stopped'; notice: DeclarantNotice }
  | { kind: 'disciplinary'; notice: DeclarantNotice }
  | { kind: 'reinstating'; notice: DeclarantNotice }
  | { kind: 'reinstated'; notice: DeclarantNotice; at: string };

/** Whether payroll confirmed reinstating the salary stopped on `notice`'s ladder. */
function reinstatedOnLadder(notice: DeclarantNotice, all: readonly DeclarantNotice[]): boolean {
  return ladderNotices(notice, all).some(
    (each) => each.step === 'salary-stoppage' && each.salaryReinstatedAt !== null,
  );
}

/**
 * Whether `notice` no longer asks anything of the declarant: closed by its own status, or a
 * disciplinary referral whose ladder's stopped salary was reinstated. Review lists only issued
 * notices (`ISSUED_ACTION_STATUSES`: issued, responded, complied, reinstated) and leaves a
 * referral `issued` when its ladder ends without compliance, so the referral is closed by its
 * ladder's reinstatement: its obligation or clarification is gone.
 */
export function noticeClosed(notice: DeclarantNotice, all: readonly DeclarantNotice[]): boolean {
  return (
    isClosed(notice) || (notice.step === 'disciplinary-referral' && reinstatedOnLadder(notice, all))
  );
}

/**
 * The salary's standing a notice tells, or null for a notice to comply or a warning. `all` is
 * every notice of the declarant: a disciplinary referral stays `issued` when its ladder ends,
 * so it stops telling of a stopped salary once payroll confirmed that ladder's reinstatement.
 */
export function salaryStandingOf(
  notice: DeclarantNotice,
  all: readonly DeclarantNotice[],
): SalaryStanding | null {
  if (notice.step === 'disciplinary-referral') {
    return noticeClosed(notice, all) ? null : { kind: 'disciplinary', notice };
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
    .map((notice) => salaryStandingOf(notice, all))
    .filter((each): each is SalaryStanding => each !== null && each.kind !== 'reinstated');
  return (
    standings.find((each) => each.kind === 'disciplinary') ??
    standings.find((each) => each.kind === 'stopped') ??
    standings.find((each) => each.kind === 'reinstating') ??
    null
  );
}
