import { daysBetween } from '@adili/ui';

import type { ActionStep, DeclarantNotice } from '../server/review/types';

/** The declarant's notices as the Notices pages read them (spec 08 FE-7), by ladder. Pure. */

export const NOTICE_STEPS = [
  'notice-to-comply',
  'warning',
  'salary-stoppage',
  'disciplinary-referral',
] as const satisfies readonly ActionStep[];

const CLOSED: ReadonlySet<DeclarantNotice['status']> = new Set([
  'complied',
  'cancelled',
  'reinstated',
  'declined',
]);

export function isClosed(notice: DeclarantNotice): boolean {
  return CLOSED.has(notice.status);
}

const stepIndex = (step: ActionStep) => (NOTICE_STEPS as readonly ActionStep[]).indexOf(step);

/** The notices of the same ladder as `notice`, earliest step first. */
export function ladderNotices(notice: DeclarantNotice, all: readonly DeclarantNotice[]) {
  return all
    .filter((each) => each.ladderId === notice.ladderId)
    .sort((a, b) => stepIndex(a.step) - stepIndex(b.step) || a.issuedAt.localeCompare(b.issuedAt));
}

/** The later step that replaced `notice`, or null while it is the ladder's latest. */
export function followedBy(
  notice: DeclarantNotice,
  all: readonly DeclarantNotice[],
): DeclarantNotice | null {
  return (
    ladderNotices(notice, all).find(
      (each) => stepIndex(each.step) > stepIndex(notice.step) && each.issuedAt >= notice.issuedAt,
    ) ?? null
  );
}

/** The open notice whose act-by date comes first, for the banner on top; null when none. */
export function urgentNotice(all: readonly DeclarantNotice[], now: string): DeclarantNotice | null {
  const open = all.filter(
    (notice) =>
      !isClosed(notice) &&
      notice.actBy !== null &&
      notice.actBy >= now &&
      followedBy(notice, all) === null,
  );
  return open.sort((a, b) => (a.actBy ?? '').localeCompare(b.actBy ?? ''))[0] ?? null;
}

export type LadderStepState = 'issued' | 'current' | 'complied' | 'not-issued';

export interface NoticeLadderStep {
  step: ActionStep;
  state: LadderStepState;
  issuedAt: string | null;
}

/** The four steps of `notice`'s ladder, as far as the declarant's notices show them. */
export function ladderOf(
  notice: DeclarantNotice,
  all: readonly DeclarantNotice[],
): NoticeLadderStep[] {
  const ladder = ladderNotices(notice, all);
  const latest = ladder.at(-1);
  return NOTICE_STEPS.map((step) => {
    const found = ladder.findLast((each) => each.step === step);
    if (!found) return { step, state: 'not-issued', issuedAt: null };
    const state: LadderStepState = isClosed(found)
      ? 'complied'
      : found === latest
        ? 'current'
        : 'issued';
    return { step, state, issuedAt: found.issuedAt };
  });
}

export interface NoticeWindow {
  /** Calendar days to the act-by date; negative once it has passed. */
  daysLeft: number;
  /** The window's day today (capped at its length) and its length in days. */
  day: number;
  of: number;
}

/** Where the window to act stands, or null for a step that sets no deadline. */
export function windowOf(notice: DeclarantNotice, now: string): NoticeWindow | null {
  // A salary stoppage's window is the Commission's, before a disciplinary referral may be
  // proposed; the declarant has no deadline but to comply (#208).
  if (!notice.actBy || notice.step === 'salary-stoppage') return null;
  const of = notice.windowDays ?? daysBetween(notice.issuedAt, notice.actBy);
  const day = Math.min(of, Math.max(0, daysBetween(notice.issuedAt, now)));
  return { daysLeft: daysBetween(now, notice.actBy), day, of };
}

/** One response is allowed to an issued notice to comply or warning (review.yaml). */
export function canRespond(notice: DeclarantNotice): boolean {
  return (
    notice.status === 'issued' &&
    notice.response === null &&
    (notice.step === 'notice-to-comply' || notice.step === 'warning')
  );
}
