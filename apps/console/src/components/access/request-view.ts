import { formatDate, type RegisterEntry as TimelineEntry } from '@adili/ui';

import type { AccessProblem, OfficerRequestView, RegisterEntry } from '../../server/access/types';
import type { ServiceError } from '../../server/service-call';
import { messages as m } from './messages';
import { CLOSED, DECIDED } from './queue-query';

/**
 * What the request page shows beside Form K (spec 10 FE-5), from the request and whether the
 * viewer may act: the access officer gets the step to take, the supervisor where it stands.
 */
export type RequestStep =
  /** A passport applicant's particulars to check. */
  | { kind: 'verify' }
  /** The officer Part II names to find on the roster, or to record as not identified. */
  | { kind: 'identify' }
  /** Identified; the workflow is notifying the declarant. */
  | { kind: 'notifying' }
  /** Identified as an officer with no account: the access officer records the written notice. */
  | { kind: 'notice' }
  /** The declarant's window for representations is open; the decision waits for it. */
  | { kind: 'window'; windowEndsAt: string }
  /** Representations are closed; the access officer decides. */
  | { kind: 'decide' }
  | { kind: 'decided' }
  | { kind: 'cannot-identify' }
  | { kind: 'withdrawn' }
  /** The supervisor's view of a step only the access officer takes. */
  | { kind: 'waiting'; text: string };

export function requestStep(view: OfficerRequestView, readOnly: boolean): RequestStep {
  switch (view.status) {
    case 'pending-applicant-verification':
      return readOnly ? { kind: 'waiting', text: m.waitingVerification } : { kind: 'verify' };
    case 'submitted':
    case 'officer-unresolved':
      if (view.resolvedRosterRecordId !== null) {
        if (!awaitingNotice(view)) return { kind: 'notifying' };
        return readOnly ? { kind: 'waiting', text: m.waitingNotice } : { kind: 'notice' };
      }
      return readOnly ? { kind: 'waiting', text: m.waitingIdentify } : { kind: 'identify' };
    case 'awaiting-representations':
      return view.windowEndsAt
        ? { kind: 'window', windowEndsAt: view.windowEndsAt }
        : { kind: 'notifying' };
    case 'under-decision':
      return { kind: 'decide' };
    case 'granted':
    case 'partially-granted':
    case 'denied':
      return { kind: 'decided' };
    case 'cannot-identify':
      return { kind: 'cannot-identify' };
    case 'withdrawn':
      return { kind: 'withdrawn' };
  }
}

/**
 * Resolved to an officer with no account and not notified yet: the access officer serves the
 * notice in writing and records it (spec 10 decision 2).
 */
export function awaitingNotice(
  view: Pick<OfficerRequestView, 'resolvedRosterRecordId' | 'declarantOnboarded' | 'notice'>,
): boolean {
  return (
    view.resolvedRosterRecordId !== null &&
    view.declarantOnboarded === false &&
    view.notice === null
  );
}

/** Whether the declarant was notified on paper: the access officer enters what they answer. */
export function notifiedInWriting(view: Pick<OfficerRequestView, 'notice'>): boolean {
  return view.notice?.channel === 'written';
}

/** Whether the request is still running: neither decided nor closed. */
export function isOpen(view: Pick<OfficerRequestView, 'status'>): boolean {
  return !DECIDED.includes(view.status) && !CLOSED.includes(view.status);
}

/** The latest register entry of a kind, e.g. when the declarant was notified. */
export function lastEntry(
  view: Pick<OfficerRequestView, 'timeline'>,
  kind: RegisterEntry['kind'],
): RegisterEntry | undefined {
  return view.timeline.filter((entry) => entry.kind === kind).at(-1);
}

/** Who acted, with their part in the request, as the prototype's register reads. */
function actorOf(entry: RegisterEntry): string | null {
  if (!entry.actor) return null;
  if (entry.kind === 'received' || entry.kind === 'withdrawn' || entry.kind === 'downloaded') {
    return `${entry.actor} (applicant)`;
  }
  // Representations received in writing are entered by the access officer.
  if (entry.kind === 'representations' && !entry.inWriting) return `${entry.actor} (declarant)`;
  return entry.actor;
}

/** The register's line for a step done on paper (r.22(2)); the default copy otherwise. */
export const IN_WRITING_TITLES: Partial<Record<RegisterEntry['kind'], string>> = {
  notified: 'Declarant notified in writing',
  representations: 'Representations received in writing',
};

/**
 * The register's line for a step about a nil letter (spec 10 decision 1): a grant that found
 * nothing in its scope delivered the letter, not a package.
 */
export const NIL_LETTER_TITLES: Partial<Record<RegisterEntry['kind'], string>> = {
  'package-issued': 'Nil letter issued',
  downloaded: 'Nil letter downloaded',
};

/** The title a step takes from what the grant delivered, if not the default. */
export function packageTitleOf(
  entry: Pick<RegisterEntry, 'kind'>,
  delivered: { kind: 'access-package' | 'nil-letter' } | null,
): string | undefined {
  return delivered?.kind === 'nil-letter' ? NIL_LETTER_TITLES[entry.kind] : undefined;
}

/** The access register as the timeline primitive draws it. */
export function timelineOf(
  view: Pick<OfficerRequestView, 'timeline' | 'decision' | 'package'>,
): TimelineEntry[] {
  return view.timeline.map((entry) => {
    const title =
      (entry.inWriting ? IN_WRITING_TITLES[entry.kind] : undefined) ??
      packageTitleOf(entry, view.package);
    return {
      id: entry.id,
      kind: entry.kind,
      at: entry.at,
      actor: actorOf(entry),
      ...(title ? { title } : {}),
      ...(entry.kind === 'decided' && view.decision ? { outcome: view.decision.outcome } : {}),
    };
  });
}

/**
 * The last instant of a window ending at `endsAt`: a window ending at midnight (a written
 * notice's) shows as the day before, its last day, not the day it ends at.
 */
export function lastInstantOf(endsAt: string): string {
  return new Date(Date.parse(endsAt) - 1).toISOString();
}

/** The Nairobi calendar day of an instant, `YYYY-MM-DD`. */
export function nairobiDay(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(new Date(iso));
}

/** `days` calendar days after `day` (`YYYY-MM-DD`). */
export function dayAfter(day: string, days: number): string {
  const at = new Date(`${day}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/** A calendar day (`YYYY-MM-DD`) as the console writes dates. */
export function formatDay(day: string): string {
  return formatDate(`${day}T12:00:00+03:00`);
}

/**
 * What is wrong with the day a written notice was served: none given, not a real date, in the
 * future, or before `earliest` (`YYYY-MM-DD`, with the words for it); null when it is fine.
 */
export function noticeDayError(
  day: string | null,
  details: { invalid: boolean },
  bounds: { today: string; earliest: string; earliestMessage: (date: string) => string },
): string | null {
  if (details.invalid) return m.noticeDayInvalid;
  if (!day) return m.noticeDayRequired;
  if (day > bounds.today) return m.noticeDayFuture;
  if (day < bounds.earliest) return bounds.earliestMessage(formatDay(bounds.earliest));
  return null;
}

/** What a failed command says, and whether the page is out of date (reload, do not retry). */
export interface ActionFailure {
  message: string;
  /** The request changed or the viewer may not act: close the dialog and reload. */
  stale: boolean;
  /** Sign in again. */
  signIn: boolean;
}

const CONFLICTS: Record<string, string> = {
  'officer-resolved': m.officerResolved,
  'request-closed': m.requestClosed,
  'request-decided': m.requestDecided,
  'not-pending-verification': m.notPendingVerification,
  'declarant-notified': m.declarantNotified,
  'representations-closed': m.representationsClosed,
};

export function actionFailure(error: ServiceError<AccessProblem>): ActionFailure {
  if (error.kind === 'unauthenticated') {
    return { message: m.sessionEnded, stale: false, signIn: true };
  }
  if (error.kind === 'unavailable') {
    return {
      message:
        error.problemType === 'directory-unavailable' ? m.directoryUnavailable : m.saveFailed,
      stale: false,
      signIn: false,
    };
  }
  const { problem } = error;
  if (problem.status === 403) return { message: m.supervisorCannotAct, stale: true, signIn: false };
  if (problem.status === 404 || problem.status === 409) {
    return {
      message: (problem.code && CONFLICTS[problem.code]) ?? m.stale,
      stale: true,
      signIn: false,
    };
  }
  if (problem.status === 400 && problem.errors?.some((each) => each.path === 'rosterRecordId')) {
    return { message: m.rosterRecordProblem, stale: false, signIn: false };
  }
  return { message: m.saveFailed, stale: false, signIn: false };
}

/** The note a verification needs: what was checked, 1 to 1,000 characters. */
export function verifyNoteError(note: string): string | null {
  const text = note.trim();
  if (!text) return m.verifyNoteRequired;
  if (text.length > 1000) return m.verifyNoteTooLong;
  return null;
}
