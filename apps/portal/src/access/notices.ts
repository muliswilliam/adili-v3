import {
  accessOutcomeLabels,
  accessOutcomeTones,
  daysBetween,
  formatDate,
  formatDateTime,
  formatScope,
  type IconProps,
  type RegisterEntry,
  type Tone,
} from '@adili/ui';
import {
  BalanceScaleIcon,
  CheckListIcon,
  Clock01Icon,
  PoliceBadgeIcon,
  Tick02Icon,
  UnavailableIcon,
  Undo02Icon,
} from '@hugeicons/core-free-icons';

import type { DeclarantNotice, LeaDeclarantNotice, Outcome, Scope } from '../server/access/types';
import { NOTICE_COPY, NOTICES_COPY, OUTCOMES, STANCES } from './notice-copy';

/**
 * The requests someone made to see the declarant's declaration (spec 10 FE-4, S4), as the
 * declarant reads them: where each stands, whether it waits for them, the window for their
 * response and its history. Pure: every function takes "now" (the server's clock at load), so
 * the server and the browser agree.
 */

/** Where a request stands for the declarant, beyond the service's status. */
export type NoticeState =
  'awaiting' | 'saved' | 'under-decision' | Outcome | 'withdrawn' | 'closed' | 'lea';

/** The window is open: the service says so, and it has not ended since the page loaded. */
export function windowOpen(notice: DeclarantNotice, now: string): boolean {
  return (
    notice.kind === 'form-k' &&
    notice.canRespond &&
    notice.windowEndsAt !== null &&
    Date.parse(now) < Date.parse(notice.windowEndsAt)
  );
}

/** Waits for the declarant: the window is open and they have not responded. */
export function needsResponse(notice: DeclarantNotice, now: string): boolean {
  return notice.kind === 'form-k' && windowOpen(notice, now) && notice.representations === null;
}

export function noticeState(notice: DeclarantNotice, now: string): NoticeState {
  if (notice.kind === 'lea') return 'lea';
  if (notice.status === 'withdrawn') return 'withdrawn';
  if (notice.status === 'cannot-identify') return 'closed';
  if (notice.decision) return notice.decision.outcome;
  if (windowOpen(notice, now)) return notice.representations ? 'saved' : 'awaiting';
  return 'under-decision';
}

/**
 * The state a notice's badge shows: a law-enforcement grant by its outcome (granted or partially
 * granted), anything else by where it stands.
 */
export function badgeState(notice: DeclarantNotice, now: string): NoticeState {
  return notice.kind === 'lea' ? notice.outcome : noticeState(notice, now);
}

export interface StateMeta {
  label: string;
  tone: Tone;
  icon: IconProps['icon'];
}

export const STATE_META: Record<NoticeState, StateMeta> = {
  awaiting: { label: NOTICES_COPY.statusAwaiting, tone: 'warning', icon: Clock01Icon },
  saved: { label: NOTICES_COPY.statusSaved, tone: 'success', icon: Tick02Icon },
  'under-decision': {
    label: NOTICES_COPY.statusUnderDecision,
    tone: 'info',
    icon: BalanceScaleIcon,
  },
  grant: { label: accessOutcomeLabels.grant, tone: accessOutcomeTones.grant, icon: Tick02Icon },
  'partial-grant': {
    label: accessOutcomeLabels['partial-grant'],
    tone: accessOutcomeTones['partial-grant'],
    icon: CheckListIcon,
  },
  deny: { label: accessOutcomeLabels.deny, tone: accessOutcomeTones.deny, icon: UnavailableIcon },
  withdrawn: { label: NOTICES_COPY.statusWithdrawn, tone: 'default', icon: Undo02Icon },
  closed: { label: NOTICES_COPY.statusClosed, tone: 'default', icon: UnavailableIcon },
  lea: { label: NOTICES_COPY.statusLea, tone: 'info', icon: PoliceBadgeIcon },
};

/** Those waiting for a response first, then open windows, then the latest notified. */
export function sortNotices(notices: DeclarantNotice[], now: string): DeclarantNotice[] {
  const rank = (notice: DeclarantNotice) =>
    needsResponse(notice, now) ? 0 : windowOpen(notice, now) ? 1 : 2;
  return [...notices].sort(
    (a, b) => rank(a) - rank(b) || Date.parse(b.notifiedAt) - Date.parse(a.notifiedAt),
  );
}

/**
 * "A law-enforcement agency was granted access on 2 Sep 2026 (Asset Recovery Agency, case
 * ARA/INV/2026/014)": the outcome, the agency and its case reference from the grant. Never the
 * agency's reason or the decision's grounds (spec 10 decision 4).
 */
export function leaTitle(notice: LeaDeclarantNotice): string {
  return NOTICES_COPY.lea(
    OUTCOMES[notice.outcome].verb.en,
    formatDate(notice.decidedAt),
    notice.agency.name,
    notice.caseReference,
  );
}

/** Whose details a scope covers, in a few words: "You and spouse". */
export function scopePeople(scope: Scope): string {
  if (scope.includeSpouses && scope.includeChildren) return NOTICES_COPY.youSpouseChildren;
  if (scope.includeSpouses) return NOTICES_COPY.youAnd(NOTICES_COPY.spouses);
  if (scope.includeChildren) return NOTICES_COPY.youAnd(NOTICES_COPY.children);
  return NOTICES_COPY.youOnly;
}

/** A scope on one line: "2026 · You and spouse · Income, assets, liabilities". */
export function scopeLine(scope: Scope): string {
  return formatScope(scope, scopePeople);
}

/** Calendar days until the window ends, in Kenyan time (0 on the last day). */
export function daysLeft(notice: DeclarantNotice, now: string): number {
  return notice.kind === 'form-k' && notice.windowEndsAt
    ? daysBetween(now, notice.windowEndsAt)
    : 0;
}

export interface WindowView {
  open: boolean;
  /** "3 days left", "Closed early", "Window closed". */
  title: string;
  detail: string;
  tone: 'neutral' | 'warning' | 'danger';
  /** Days used of the window's length, for the bar. */
  day: number;
  of: number;
}

/**
 * The window for the declarant's response, while the request is not decided or withdrawn: its
 * countdown while open, else how it closed. Null when there is no window to show.
 */
export function windowView(notice: DeclarantNotice, now: string): WindowView | null {
  if (notice.kind !== 'form-k') return null;
  const { windowEndsAt } = notice;
  if (!windowEndsAt || notice.decision) return null;
  if (notice.status === 'withdrawn' || notice.status === 'cannot-identify') return null;
  const of = Math.max(1, daysBetween(notice.notifiedAt, windowEndsAt));
  const open = windowOpen(notice, now);
  if (open) {
    const left = daysLeft(notice, now);
    const day = Math.min(of, Math.max(0, daysBetween(notice.notifiedAt, now)));
    return {
      open,
      title: NOTICE_COPY.daysLeft(left),
      detail: NOTICE_COPY.windowOpenDetail(
        notice.representations ? NOTICE_COPY.editUntilVerb : NOTICE_COPY.respondByVerb,
        formatDateTime(windowEndsAt),
        day,
        of,
      ),
      tone: left <= 1 ? 'danger' : 'warning',
      day,
      of,
    };
  }
  const consented = notice.representations?.stance === 'consent';
  return {
    open,
    title: consented ? NOTICE_COPY.closedEarly : NOTICE_COPY.windowClosed,
    detail:
      consented && notice.representations
        ? NOTICE_COPY.consentedOn(formatDate(notice.representations.submittedAt))
        : NOTICE_COPY.closedAt(formatDateTime(windowEndsAt)),
    tone: 'neutral',
    day: of,
    of,
  };
}

/**
 * The request's history as the declarant may see it (S12): notified, their response, and the
 * decision. Staff names are not shown, only their role at the Commission.
 */
export function historyOf(notice: DeclarantNotice): RegisterEntry[] {
  const code = notice.commission.name;
  if (notice.kind === 'lea') {
    return [
      {
        id: 'granted',
        kind: 'decided',
        at: notice.decidedAt,
        outcome: notice.outcome,
        title: NOTICE_COPY.agencyGranted(
          notice.agency.name,
          OUTCOMES[notice.outcome].verb.en,
          notice.caseReference,
        ),
        actor: NOTICE_COPY.officerOf(code),
      },
      {
        id: 'notified',
        kind: 'notified',
        at: notice.notifiedAt,
        title: NOTICE_COPY.youWereNotified,
        actor: NOTICE_COPY.notifiedBy(code),
      },
    ];
  }
  const entries: RegisterEntry[] = [
    {
      id: 'notified',
      kind: 'notified',
      at: notice.notifiedAt,
      title: NOTICE_COPY.askedToSee(notice.applicantName),
      actor:
        notice.noticeChannel === 'written'
          ? NOTICE_COPY.notifiedInWritingBy(code)
          : NOTICE_COPY.notifiedBy(code),
    },
  ];
  const sent = notice.representations;
  if (sent) {
    entries.push({
      id: 'representations',
      kind: 'representations',
      at: sent.updatedAt,
      title: STANCES[sent.stance].done.en,
      actor: sent.receivedInWriting
        ? NOTICE_COPY.youInWriting
        : sent.updatedAt !== sent.submittedAt
          ? NOTICE_COPY.youEdited
          : NOTICE_COPY.you,
    });
  }
  const { decision } = notice;
  if (decision) {
    entries.push({
      id: 'decided',
      kind: 'decided',
      at: decision.decidedAt,
      outcome: decision.outcome,
      title: `${code} ${OUTCOMES[decision.outcome].verb.en}`,
      actor: NOTICE_COPY.officerOf(code),
    });
  }
  return entries;
}
