import type { RegisterEntry as TimelineEntry } from '@adili/ui';

import type { AccessProblem, LeaRequest } from '../../../server/access/types';
import type { ServiceError } from '../../../server/service-call';
import { packageTitleOf } from '../request-view';
import { messages as m } from './messages';

/**
 * What a law enforcement request's page shows beside the written request (spec 10 FE-6), from
 * the request and whether the viewer may act: the access officer verifies, then decides; the
 * supervisor sees where it stands.
 */
export type LeaStep =
  /** Received: provenance, reason and the officer sought to check. */
  | { kind: 'verify' }
  /** Verified: the access officer decides. */
  | { kind: 'decide' }
  | { kind: 'decided' }
  | { kind: 'withdrawn' }
  /** The supervisor's view of a step only the access officer takes. */
  | { kind: 'waiting'; text: string };

export function leaStep(request: Pick<LeaRequest, 'status'>, readOnly: boolean): LeaStep {
  switch (request.status) {
    case 'received':
      return readOnly ? { kind: 'waiting', text: m.waitingVerify } : { kind: 'verify' };
    case 'verified':
      return { kind: 'decide' };
    case 'granted':
    case 'denied':
      return { kind: 'decided' };
    case 'withdrawn':
      return { kind: 'withdrawn' };
  }
}

/**
 * A grant whose declarant has no account and is not told yet: the access officer serves the
 * notice in writing and records it (spec 10 decision 2).
 */
export function awaitingLeaNotice(
  request: Pick<LeaRequest, 'status' | 'declarantOnboarded' | 'declarantNotifiedAt'>,
): boolean {
  return (
    request.status === 'granted' &&
    request.declarantOnboarded === false &&
    request.declarantNotifiedAt === null
  );
}

/** Whether the request still waits for a decision. */
export function isOpenLea(request: Pick<LeaRequest, 'status'>): boolean {
  return request.status === 'received' || request.status === 'verified';
}

/**
 * Whether the fourteen-day deadline passed undecided: the workflow's breach flag, or the clock
 * when the page is read before the workflow flagged it.
 */
export function isBreached(
  request: Pick<LeaRequest, 'status' | 'breachedAt' | 'deadlineAt'>,
  now: string,
): boolean {
  if (!isOpenLea(request)) return false;
  return request.breachedAt !== null || Date.parse(request.deadlineAt) < Date.parse(now);
}

/** The officer and their agency, as the register and the decision name them. */
export function officerOf(request: Pick<LeaRequest, 'officer' | 'agency'>): string {
  return `${request.officer.name} (${request.agency.code})`;
}

/** The access register as the timeline primitive draws it, in the prototype's words. */
export function leaTimelineOf(request: LeaRequest): TimelineEntry[] {
  return request.timeline.map((entry): TimelineEntry => {
    const base = { id: entry.id, kind: entry.kind, at: entry.at, actor: entry.actor };
    switch (entry.kind) {
      case 'received':
        return {
          ...base,
          actor: entry.actor ? officerOf(request) : null,
          summary: m.receivedSummary(request.caseReference),
        };
      case 'verified':
        return {
          ...base,
          title: m.requestVerified,
          summary: request.resolvedName
            ? m.officerIdentifiedSummary(request.resolvedName)
            : undefined,
        };
      case 'decided':
        return {
          ...base,
          ...(request.decision ? { outcome: request.decision.outcome } : {}),
          summary:
            request.decision?.outcome === 'deny'
              ? m.agencyToldSummary(request.agency.code)
              : undefined,
        };
      case 'notified':
        return {
          ...base,
          title: entry.inWriting ? m.notifiedAfterGrantInWriting : m.notifiedAfterGrant,
        };
      case 'package-issued':
        return withTitle(base, packageTitleOf(entry, request.package));
      case 'downloaded':
        return withTitle(
          { ...base, actor: entry.actor ? officerOf(request) : null },
          packageTitleOf(entry, request.package),
        );
      default:
        return base;
    }
  });
}

function withTitle(entry: TimelineEntry, title: string | undefined): TimelineEntry {
  return title ? { ...entry, title } : entry;
}

/** What a failed verification says, and whether the page is out of date (reload, do not retry). */
export interface LeaActionFailure {
  message: string;
  /** The request changed or the viewer may not act: reload. */
  stale: boolean;
  signIn: boolean;
  /** The service named the roster record as not one that can be chosen. */
  record: boolean;
}

const ACTION_COPY = {
  sessionEnded: 'Your session has ended. Sign in again.',
  supervisorCannotAct: 'Only the access officer can do this.',
  stale: 'This request has changed. Reload to see it.',
  verifiedAlready: 'The request is verified already. The page shows it now.',
  decided: 'The request is decided. The page shows it now.',
  closed: 'The request is closed. The page shows it now.',
  accountInactive:
    'The account this request came from is no longer an active officer account of its agency. Nothing was recorded: deny the request instead.',
  notOnRoster: "That record is not on the Commission's roster. Search again.",
  directoryUnavailable:
    'The directory cannot be reached right now. Nothing was recorded. Try again.',
  saveFailed: 'We could not save this. Try again.',
};

const CONFLICTS: Record<string, string> = {
  'officer-resolved': ACTION_COPY.verifiedAlready,
  'request-decided': ACTION_COPY.decided,
  'request-closed': ACTION_COPY.closed,
  'declarant-notified': 'The declarant is told already. The page shows it now.',
  'not-under-decision': ACTION_COPY.stale,
};

export function leaActionFailure(error: ServiceError<AccessProblem>): LeaActionFailure {
  const failure = { stale: false, signIn: false, record: false };
  if (error.kind === 'unauthenticated') {
    return { ...failure, message: ACTION_COPY.sessionEnded, signIn: true };
  }
  if (error.kind === 'unavailable') {
    return {
      ...failure,
      message:
        error.problemType === 'directory-unavailable'
          ? ACTION_COPY.directoryUnavailable
          : ACTION_COPY.saveFailed,
    };
  }
  const { problem } = error;
  if (problem.status === 403) {
    return { ...failure, message: ACTION_COPY.supervisorCannotAct, stale: true };
  }
  if (problem.status === 404) return { ...failure, message: ACTION_COPY.stale, stale: true };
  if (problem.status === 409) {
    const known = problem.code ? CONFLICTS[problem.code] : undefined;
    // Without a code: the account it came from was revoked or changed since it was filed.
    return known
      ? { ...failure, message: known, stale: true }
      : { ...failure, message: ACTION_COPY.accountInactive };
  }
  if (problem.status === 400 && problem.errors?.some((each) => each.path === 'rosterRecordId')) {
    return { ...failure, message: ACTION_COPY.notOnRoster, record: true };
  }
  return { ...failure, message: ACTION_COPY.saveFailed };
}

/** The note a verification needs: what was checked, 1 to 1,000 characters. */
export function leaNoteError(note: string): string | null {
  const text = note.trim();
  if (!text) return m.noteRequired;
  if (text.length > 1000) return m.noteTooLong;
  return null;
}
