/**
 * The review mock's compliance determinations and approvals inbox (spec 08, review.yaml), behind
 * `mock.server.ts`, which owns the cases and hands them in through `MockCases`. As the service has
 * it (services/review, PR #444):
 *
 * - Propose (the case's assignee only, else 403 `not-the-assignee`): 409 `determination-open`
 *   while one is proposed or approved, 409 `clarification-open` while a clarification is open;
 *   an outcome and reasons (1 to 4,000), a further-action note up to 2,000.
 * - Approve (Idempotency-Key required) and return (a reason, 1 to 2,000) by the separation-of-
 *   duties rule: 403 `separation-of-duties` (with `reason`) for the proposer or a reviewer of
 *   record, 403 `supervisor-required` for anyone else without the supervisor role; 409
 *   `not-proposed` once decided. Approval allocates a CMP reference, issues the letter and moves
 *   the case to `determined` (or `further-action`).
 * - Withdraw by the proposer while proposed (403 `not-the-proposer`, 409 `not-proposed`).
 * - The approvals inbox lists them through `determinationApprovals` (`approvals-mock.server.ts`).
 *
 */
import { randomUUID } from 'node:crypto';

import { SUPERVISOR } from '@adili/roles';

import { isRecord, json, problem, readJson } from '../mock-http';
import { isBulkClosure } from '../../determination/view';
import { type MockApprovalSource, seedReassignment } from './approvals-mock.server';
import {
  type MockApprover,
  type MockCase,
  type MockCases,
  mockProblem,
  resolvedCaller,
} from './mock-parts.server';
import { reviewClock } from './mock-clock.server';
import type { Assignee, Determination } from './types';

interface StoredDetermination extends Determination {
  /** The letter's document, once approved. */
  letterDocumentId: string | null;
}

const determinations = new Map<string, StoredDetermination>();
let issuer = 'TSC';
let sequence = 0;

/** How much of the reasons the inbox card shows (the service's excerpt). */
const REASONS_EXCERPT = 200;
const OUTCOMES = ['compliant', 'non-compliant', 'further-action'] as const;
const OUTCOME_LABELS: Record<Determination['outcome'], string> = {
  compliant: 'Compliant',
  'compliant-no-issues': 'Compliant: no issues identified',
  'non-compliant': 'Non-compliant',
  'further-action': 'Further action',
};

/** A seeded determination: who proposed it, when, and how far it got. */
export interface DeterminationSeed {
  id?: string;
  caseId: string;
  outcome: Determination['outcome'];
  reasons: string;
  furtherActionNote?: string | null;
  /** Null for the system's proposal (a bulk closure). */
  proposer: Assignee | null;
  proposedAt: string;
  status?: Determination['status'];
  /** Who approved or returned it, and when. */
  decidedBy?: Assignee;
  decidedAt?: string;
  returnReason?: string;
  /** Seeded as reassigned to this supervisor (`approvals-mock.server.ts`). */
  reassignedTo?: Assignee;
}

/** Empties the store and seeds `seeds`; references carry the Commission's `issuer` code. */
export function resetDeterminationsMock(
  seeds: readonly DeterminationSeed[],
  options: { issuer: string },
) {
  determinations.clear();
  issuer = options.issuer;
  sequence = 3100;
  for (const seed of seeds) {
    const id = seed.id ?? randomUUID();
    const status = seed.status ?? 'proposed';
    const approved = status === 'approved';
    const returned = status === 'returned';
    determinations.set(id, {
      id,
      caseId: seed.caseId,
      outcome: seed.outcome,
      reasons: seed.reasons,
      furtherActionNote: seed.furtherActionNote ?? null,
      furtherActionLink: null,
      proposerKind: seed.proposer ? 'user' : 'system',
      proposer: seed.proposer,
      proposedAt: seed.proposedAt,
      status,
      approver: approved ? (seed.decidedBy ?? null) : null,
      approvedAt: approved ? (seed.decidedAt ?? null) : null,
      returnedBy: returned ? (seed.decidedBy ?? null) : null,
      returnedAt: returned ? (seed.decidedAt ?? null) : null,
      returnReason: returned ? (seed.returnReason ?? null) : null,
      reference: approved ? cmpReference() : null,
      letterAvailable: approved,
      letterDocumentId: approved ? randomUUID() : null,
    });
    if (seed.reassignedTo) seedReassignment(id, seed.reassignedTo);
  }
}

/** Every determination of a case, oldest first (review.yaml `CaseDetail.determinations`). */
export function determinationsOf(caseId: string, caller: Assignee): Determination[] {
  return [...determinations.values()]
    .filter((each) => each.caseId === caseId)
    .sort((a, b) => a.proposedAt.localeCompare(b.proposedAt))
    .map((each) => view(each, caller));
}

/** The decision letter a document id is, for the placeholder file route. */
export function mockDecisionLetterTitle(documentId: string): string | null {
  for (const each of determinations.values()) {
    if (each.letterDocumentId === documentId) return `Decision letter ${each.reference ?? ''}`;
  }
  return null;
}

function view(stored: StoredDetermination, caller: Assignee): Determination {
  return {
    id: stored.id,
    caseId: stored.caseId,
    outcome: stored.outcome,
    reasons: stored.reasons,
    furtherActionNote: stored.furtherActionNote,
    furtherActionLink: stored.furtherActionLink,
    proposerKind: stored.proposerKind,
    proposer: resolvedCaller(stored.proposer, caller),
    proposedAt: stored.proposedAt,
    status: stored.status,
    approver: stored.approver,
    approvedAt: stored.approvedAt,
    returnedBy: stored.returnedBy,
    returnedAt: stored.returnedAt,
    returnReason: stored.returnReason,
    reference: stored.reference,
    letterAvailable: stored.letterAvailable,
  };
}

/** CMP-<ISSUER>-<YEAR>-<seq>-<check> (ADR-011), the check a stand-in letter. */
function cmpReference(): string {
  sequence += 1;
  const year = new Date(reviewClock.now()).getUTCFullYear();
  return `CMP-${issuer}-${String(year)}-${String(sequence).padStart(7, '0')}-${'KMPRTXUQ'[sequence % 8] ?? 'K'}`;
}

const coded = mockProblem;

type CannotApprove = 'proposer' | 'reviewer-of-record' | 'role';

/** The separation-of-duties rule (ADR-004): null when the caller may decide it. */
function cannotApprove(
  stored: StoredDetermination,
  found: MockCase | null,
  caller: MockApprover,
): CannotApprove | null {
  if (resolvedCaller(stored.proposer, caller)?.subject === caller.subject) return 'proposer';
  const ofRecord = [...(found?.history ?? []), ...(found?.holder ? [found.holder] : [])];
  if (ofRecord.some((each) => each.subject === caller.subject)) return 'reviewer-of-record';
  return caller.roles.includes(SUPERVISOR) ? null : 'role';
}

function refuse(reason: CannotApprove): Response {
  if (reason === 'role') {
    return coded(403, 'supervisor-required', 'Only a supervisor can approve or return this.', {
      reason,
    });
  }
  return coded(
    403,
    'separation-of-duties',
    reason === 'proposer'
      ? 'You proposed this, so another supervisor must decide it.'
      : 'You reviewed this case, so another supervisor must decide it.',
    { reason },
  );
}

const notProposed = (status: string) =>
  coded(409, 'not-proposed', `The determination is ${status}; it no longer waits for a decision.`, {
    determinationStatus: status,
  });

/**
 * Answers the determination, approvals and reviewers endpoints, or null for any other request
 * (the case mock answers those).
 */
export async function determinationsRoute(
  request: Request,
  caller: MockApprover,
  cases: MockCases,
): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  const method = request.method;

  const propose = /^\/v1\/review\/cases\/([^/]+)\/determinations$/.exec(pathname);
  if (method === 'POST' && propose?.[1]) return proposeOn(request, propose[1], caller, cases);

  const one = /^\/v1\/review\/determinations\/([^/]+)$/.exec(pathname);
  if (method === 'GET' && one?.[1]) {
    const found = determinations.get(one[1]);
    return found ? json(200, view(found, caller)) : problem(404, 'Not found');
  }

  const letter = /^\/v1\/review\/determinations\/([^/]+)\/letter$/.exec(pathname);
  if (method === 'GET' && letter?.[1]) {
    const found = determinations.get(letter[1]);
    if (!found) return problem(404, 'Not found');
    if (found.status !== 'approved' || !found.letterDocumentId) {
      return coded(409, 'not-approved', 'Only an approved determination has a decision letter.');
    }
    return json(200, {
      documentId: found.letterDocumentId,
      verificationId: `V${found.letterDocumentId.slice(0, 8).toUpperCase()}`,
      downloadUrl: null,
    });
  }

  const decide = /^\/v1\/review\/determinations\/([^/]+)\/(approve|return|withdraw)$/.exec(
    pathname,
  );
  if (method === 'POST' && decide?.[1] && decide[2]) {
    const found = determinations.get(decide[1]);
    if (!found) return problem(404, 'Not found');
    const verb = decide[2];
    if (verb === 'withdraw') return withdraw(found, caller, cases);
    if (verb === 'approve' && !request.headers.get('idempotency-key')) {
      return problem(400, 'Idempotency-Key is required');
    }
    if (found.status !== 'proposed') return notProposed(found.status);
    const reason = cannotApprove(found, cases.find(found.caseId), caller);
    if (reason) return refuse(reason);
    return verb === 'approve' ? approve(found, caller, cases) : returnTo(request, found, caller);
  }

  return null;
}

async function proposeOn(
  request: Request,
  caseId: string,
  caller: MockApprover,
  cases: MockCases,
): Promise<Response> {
  const found = cases.find(caseId);
  if (!found) return problem(404, 'Not found');
  if (found.holder?.subject !== caller.subject) {
    return coded(403, 'not-the-assignee', 'Only the reviewer who holds the case can propose.');
  }
  const body = await readJson(request);
  const outcome = isRecord(body) ? body.outcome : null;
  const reasons = isRecord(body) ? body.reasons : null;
  const note = isRecord(body) ? (body.furtherActionNote ?? null) : null;
  if (
    !OUTCOMES.some((each) => each === outcome) ||
    typeof reasons !== 'string' ||
    !reasons.trim() ||
    reasons.length > 4000 ||
    (note !== null && (typeof note !== 'string' || note.length > 2000))
  ) {
    return problem(400, 'Body failed validation');
  }
  const open = determinationsOf(caseId, caller).some(
    (each) => each.status === 'proposed' || each.status === 'approved',
  );
  if (open) {
    return coded(409, 'determination-open', 'A determination is already proposed or approved.');
  }
  if (found.openClarifications > 0) {
    return coded(409, 'clarification-open', 'A clarification of the case is still open.');
  }
  const id = randomUUID();
  const stored: StoredDetermination = {
    id,
    caseId,
    outcome: outcome as (typeof OUTCOMES)[number],
    reasons,
    furtherActionNote: outcome === 'further-action' ? note : null,
    furtherActionLink: null,
    proposerKind: 'user',
    proposer: { subject: caller.subject, name: caller.name },
    proposedAt: reviewClock.isoNow(),
    status: 'proposed',
    approver: null,
    approvedAt: null,
    returnedBy: null,
    returnedAt: null,
    returnReason: null,
    reference: null,
    letterAvailable: false,
    letterDocumentId: null,
  };
  determinations.set(id, stored);
  cases.record(
    caseId,
    'determination-proposed',
    caller,
    `Determination proposed: ${OUTCOME_LABELS[stored.outcome]}`,
    id,
  );
  return json(201, view(stored, caller));
}

function approve(stored: StoredDetermination, caller: MockApprover, cases: MockCases): Response {
  const approver = { subject: caller.subject, name: caller.name };
  stored.status = 'approved';
  stored.approver = approver;
  stored.approvedAt = reviewClock.isoNow();
  stored.reference = cmpReference();
  stored.letterAvailable = true;
  stored.letterDocumentId = randomUUID();
  const further = stored.outcome === 'further-action';
  cases.setStatus(
    stored.caseId,
    further ? 'further-action' : 'determined',
    approver,
    `Determination ${stored.reference} approved: ${OUTCOME_LABELS[stored.outcome]}`,
  );
  return json(200, view(stored, caller));
}

async function returnTo(
  request: Request,
  stored: StoredDetermination,
  caller: MockApprover,
): Promise<Response> {
  const body = await readJson(request);
  const reason = isRecord(body) ? body.reason : null;
  if (typeof reason !== 'string' || !reason.trim() || reason.length > 2000) {
    return problem(400, 'A reason of 1 to 2,000 characters is required');
  }
  stored.status = 'returned';
  stored.returnedBy = { subject: caller.subject, name: caller.name };
  stored.returnedAt = reviewClock.isoNow();
  stored.returnReason = reason;
  return json(200, view(stored, caller));
}

function withdraw(stored: StoredDetermination, caller: MockApprover, cases: MockCases): Response {
  if (resolvedCaller(stored.proposer, caller)?.subject !== caller.subject) {
    return coded(403, 'not-the-proposer', 'Only the reviewer who proposed it can withdraw it.');
  }
  if (stored.status !== 'proposed') return notProposed(stored.status);
  stored.status = 'withdrawn';
  cases.record(
    stored.caseId,
    'determination-withdrawn',
    caller,
    'Determination withdrawn by the proposer',
    stored.id,
  );
  return json(200, view(stored, caller));
}

/** The determination approval source of the inbox mock: proposed ones, oldest first. */
export const determinationApprovals: MockApprovalSource<'determination'> = {
  kind: 'determination',
  pending: (caller, cases) =>
    [...determinations.values()]
      .filter((each) => each.status === 'proposed' && !isBulkClosure(each))
      .map((stored) => {
        const found = cases.find(stored.caseId);
        return {
          subjectId: stored.id,
          proposedAt: stored.proposedAt,
          proposerKind: stored.proposerKind,
          proposer: resolvedCaller(stored.proposer, caller),
          summary: {
            caseId: stored.caseId,
            caseReference: found?.item.reference ?? null,
            declarantName: found?.item.declarantName ?? null,
            personnelFileNumber: found?.item.personnelFileNumber ?? null,
            outcome: stored.outcome,
            reasonsExcerpt: stored.reasons.slice(0, REASONS_EXCERPT),
          },
          cannotApproveReason: cannotApprove(stored, found, caller),
        };
      }),
  find: (subjectId) => {
    const found = determinations.get(subjectId);
    return found ? { pending: found.status === 'proposed', status: found.status } : null;
  },
};
