import { formatDate, formatDateTime } from '@adili/ui';

import type { AccessRequest, RegisterEntry } from '../server/access/types';
import { REQUEST_COPY as COPY, PACKAGE_COPY as PACKAGE } from './copy';
import { packageView } from './package';

/**
 * The stages of a Form K request as the applicant follows them, from its status and its
 * register timeline: received, the passport check (for a passport applicant), the officer
 * identified, the officer notified, the decision. A withdrawn or closed request ends where it
 * stopped.
 */

/** `stopped`: the Commission closed it there; `ended`: the applicant withdrew it. */
export type StageState = 'done' | 'current' | 'upcoming' | 'stopped' | 'ended';

export interface Stage {
  id: string;
  title: string;
  detail: string | null;
  state: StageState;
}

const DECIDED = new Set(['granted', 'partially-granted', 'denied']);

/** Requests the applicant can still withdraw: any before a decision or closure. */
export const WITHDRAWABLE = new Set<AccessRequest['status']>([
  'submitted',
  'pending-applicant-verification',
  'officer-unresolved',
  'awaiting-representations',
  'under-decision',
]);

function at(timeline: RegisterEntry[], kind: RegisterEntry['kind']): string | null {
  return timeline.filter((entry) => entry.kind === kind).at(-1)?.at ?? null;
}

/** The order each status has reached: 0 received ... 4 decided. */
const REACHED: Record<AccessRequest['status'], number> = {
  'pending-applicant-verification': 1,
  submitted: 2,
  'officer-unresolved': 2,
  'awaiting-representations': 3,
  'under-decision': 4,
  granted: 5,
  'partially-granted': 5,
  denied: 5,
  'cannot-identify': 2,
  withdrawn: 0,
};

function stateOf(order: number, reached: number): StageState {
  if (order < reached) return 'done';
  return order === reached ? 'current' : 'upcoming';
}

/**
 * A granted request's package follows the decision: being prepared, ready until its window
 * ends at `now` (epoch milliseconds), or its window closed (also once `windowClosed`, the
 * documents service having said so).
 */
export function requestStages(request: AccessRequest, now: number, windowClosed = false): Stage[] {
  const { status, timeline, commission } = request;
  const received = at(timeline, 'received') ?? request.submittedAt;
  const passport = status === 'pending-applicant-verification' || at(timeline, 'verified') !== null;
  const stages: Stage[] = [
    {
      id: 'received',
      title: COPY.received,
      detail: COPY.receivedDetail(formatDateTime(received)),
      state: 'done',
    },
  ];

  if (status === 'withdrawn' || status === 'cannot-identify') {
    const closed = at(timeline, status);
    stages.push({
      id: status,
      title: status === 'withdrawn' ? COPY.withdrawnStep : COPY.officerNotIdentified,
      detail: closed ? formatDate(closed) : null,
      state: status === 'withdrawn' ? 'ended' : 'stopped',
    });
    return stages;
  }

  const reached = REACHED[status];
  if (passport) {
    const verified = at(timeline, 'verified');
    stages.push({
      id: 'verified',
      title: COPY.passportCheck,
      detail: verified ? formatDate(verified) : COPY.passportWaiting(commission.name),
      state: stateOf(1, reached),
    });
  }
  const notified = at(timeline, 'notified');
  const officerState = stateOf(2, reached);
  stages.push({
    id: 'identified',
    title: COPY.officerIdentified,
    // The register records no entry of its own for the identification: notifying follows it.
    detail: officerState === 'current' ? COPY.officerChecking(commission.name) : null,
    state: officerState,
  });
  const notifiedState = stateOf(3, reached);
  stages.push({
    id: 'notified',
    title: COPY.officerNotified,
    detail:
      notifiedState === 'upcoming'
        ? COPY.officerNotifiedFuture
        : notifiedState === 'current'
          ? COPY.officerResponding
          : notified
            ? formatDate(notified)
            : null,
    state: notifiedState,
  });
  stages.push({
    id: 'decision',
    title: COPY.decided,
    detail:
      DECIDED.has(status) && request.decision
        ? formatDate(request.decision.decidedAt)
        : COPY.decisionDueOn(formatDate(request.decisionDeadlineAt)),
    state: DECIDED.has(status) ? 'done' : stateOf(4, reached),
  });
  const pkg = packageView(request, now, windowClosed);
  if (pkg?.state === 'preparing') {
    stages.push({
      id: 'package',
      title: PACKAGE.stagePreparing,
      detail: PACKAGE.stagePreparingDetail,
      state: 'current',
    });
  } else if (pkg?.state === 'ready') {
    stages.push({
      id: 'package',
      title: PACKAGE.stageReady,
      detail: PACKAGE.stageReadyDetail(formatDateTime(pkg.package.downloadExpiresAt)),
      state: 'current',
    });
  } else if (pkg?.state === 'expired') {
    stages.push({
      id: 'package',
      title: PACKAGE.stageClosed,
      detail: formatDate(pkg.package.downloadExpiresAt),
      state: 'done',
    });
  }
  return stages;
}

/** Where the 30-day decision clock stands, for an open request; null once it has stopped. */
export function decisionClock(
  request: AccessRequest,
  now: number,
): { day: number; of: number; daysLeft: number } | null {
  if (!WITHDRAWABLE.has(request.status)) return null;
  const start = Date.parse(request.submittedAt);
  const end = Date.parse(request.decisionDeadlineAt);
  const of = Math.round((end - start) / 86_400_000);
  const day = Math.max(0, Math.floor((now - start) / 86_400_000));
  const daysLeft = Math.ceil((end - now) / 86_400_000);
  return { day: Math.min(day, of), of, daysLeft };
}
