/**
 * What the review mock's spec 08 modules share (determinations, the approvals inbox, and the
 * ladder's actions and referrals as they arrive): the cases as they read and change them, the
 * caller with their roles, the "whoever is signed in" placeholder, and coded problems.
 */
import { json } from '../mock-http';
import type { Assignee, CaseListItem, CaseStatus } from './types';

/** What a spec 08 mock reads and changes of a case, resolved for the caller. */
export interface MockCase {
  item: CaseListItem;
  holder: Assignee | null;
  /** Everyone who held the case: its reviewers of record. */
  history: Assignee[];
  /** Open (issued, overdue or responded) clarifications of the case. */
  openClarifications: number;
}

export interface MockCases {
  find: (caseId: string) => MockCase | null;
  /** Moves the case to `status`, with a timeline entry by `actor`. */
  setStatus: (caseId: string, status: CaseStatus, actor: Assignee, summary: string) => void;
  /** Adds a timeline entry to the case. */
  record: (caseId: string, kind: string, actor: Assignee, summary: string, ref: string) => void;
}

/** The caller, as the mock reads them from the token. */
export interface MockApprover extends Assignee {
  roles: readonly string[];
}

/**
 * Stands for "whoever is signed in" as a seeded proposer, so the caller's own proposals (returned,
 * approved) show for any account.
 */
export const MOCK_CALLER: Assignee = { subject: '(caller)', name: '(caller)' };

/** `who`, the caller when it is the `MOCK_CALLER` placeholder. */
export function resolvedCaller(who: Assignee | null, caller: Assignee): Assignee | null {
  return who?.subject === MOCK_CALLER.subject
    ? { subject: caller.subject, name: caller.name }
    : who;
}

/** A problem with a `code`, as the service answers (`type` and `code` the same). */
export function mockProblem(status: number, code: string, detail: string, extra: object = {}) {
  return json(status, {
    type: code,
    title: status === 403 ? 'Forbidden' : status === 409 ? 'Conflict' : 'Error',
    status,
    detail,
    code,
    ...extra,
  });
}
