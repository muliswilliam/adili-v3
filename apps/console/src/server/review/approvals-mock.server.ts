/**
 * The review mock's approvals inbox (spec 08, S14; review.yaml `listApprovals`,
 * `reassignApproval`, `listCommissionReviewers`), behind `mock.server.ts`. As the service does,
 * it unions one source per kind (`MockApprovalSource`): each lists its pending approvals with the
 * caller's `cannotApproveReason`, and finds one to reassign. The inbox orders them oldest first,
 * pages them by cursor and counts them by kind and age band (across kinds); supervisors only
 * (403 `supervisor-required`). Reassigning records the supervisor an approval is pointed at;
 * 409 `not-proposed` once decided. The determinations' source is `determinations-mock.server.ts`,
 * the ladder's actions' (#205) `actions-mock.server.ts`, the referrals' `referrals-mock.server.ts`.
 */
import { SUPERVISOR } from '@adili/roles';

import type { InboxKind } from '../../approvals/kinds';
import { isRecord, json, problem, readJson } from '../mock-http';
import {
  type MockApprover,
  type MockCases,
  mockProblem,
  resolvedCaller,
} from './mock-parts.server';
import { reviewClock } from './mock-clock.server';
import type { ApprovalItem, Assignee } from './types';

/** A pending approval as a kind's source gives it: the item without what the inbox adds. */
export type MockPendingApproval = Omit<ApprovalItem, 'kind' | 'canApprove' | 'reassignedTo'>;

export interface MockApprovalSource<K extends InboxKind> {
  kind: K;
  /** The kind's pending approvals, for `caller` (their proposer resolved, why they cannot). */
  pending: (caller: MockApprover, cases: MockCases) => MockPendingApproval[];
  /** One approval of the kind, pending or not; null when there is none. */
  find: (subjectId: string) => { pending: boolean; status: string } | null;
}

/** A Commission's reviewer or supervisor, as `listCommissionReviewers` lists them. */
export type MockStaffMember = Assignee & { supervisor: boolean };

const AGE_BANDS = ['under-7-days', '7-to-30-days', 'over-30-days'] as const;
const DAY_MS = 86_400_000;

/** One source per kind the inbox shows: a kind added to `INBOX_KINDS` fails here until it has one. */
export type MockApprovalSources = { [K in InboxKind]: MockApprovalSource<K> };

let sources: readonly MockApprovalSource<InboxKind>[] = [];
let staff: MockStaffMember[] = [];
/** The seed's "now" less the real time it was seeded at: ages count from the seed's clock. */
let clockOffset = 0;
const reassignments = new Map<string, Assignee>();

/**
 * Starts the inbox over with `sources`, one per kind, and the Commission's staff, dated as if it
 * is `now` (the fixtures' seed time), so the age bands do not drift with the real clock.
 */
export function resetApprovalsMock(options: {
  sources: MockApprovalSources;
  staff: MockStaffMember[];
  now: number;
}) {
  sources = Object.values(options.sources);
  clockOffset = options.now - Date.now();
  staff = options.staff;
  reassignments.clear();
}

/** Seeds an approval as reassigned to `to` (`MOCK_CALLER` for whoever is signed in). */
export function seedReassignment(subjectId: string, to: Assignee) {
  reassignments.set(subjectId, to);
}

function ageBand(proposedAt: string, now: number): (typeof AGE_BANDS)[number] {
  const days = (now - Date.parse(proposedAt)) / DAY_MS;
  return days >= 30 ? 'over-30-days' : days >= 7 ? '7-to-30-days' : 'under-7-days';
}

const supervisorRequired = () =>
  mockProblem(403, 'supervisor-required', 'Approvals are for supervisors.');

/** Answers the inbox, reassign and reviewers endpoints, or null for any other request. */
export async function approvalsRoute(
  request: Request,
  caller: MockApprover,
  cases: MockCases,
): Promise<Response | null> {
  const { pathname, searchParams } = new URL(request.url);
  const method = request.method;

  const inbox = /^\/v1\/commissions\/([^/]+)\/approvals$/.exec(pathname);
  if (method === 'GET' && inbox?.[1]) return listApprovals(searchParams, caller, cases);

  const reassign = /^\/v1\/review\/approvals\/([^/]+)\/([^/]+)\/reassign$/.exec(pathname);
  if (method === 'POST' && reassign?.[1] && reassign[2]) {
    return reassignTo(request, reassign[1], reassign[2], caller);
  }

  const reviewers = /^\/v1\/commissions\/([^/]+)\/review\/queue\/reviewers$/.exec(pathname);
  if (method === 'GET' && reviewers?.[1]) {
    if (!caller.roles.includes(SUPERVISOR)) return supervisorRequired();
    return json(200, { items: staff.map((member) => ({ ...member, openCases: 0 })) });
  }

  return null;
}

function reassignedTo(subjectId: string, caller: Assignee): Assignee | null {
  return resolvedCaller(reassignments.get(subjectId) ?? null, caller);
}

function listApprovals(params: URLSearchParams, caller: MockApprover, cases: MockCases): Response {
  if (!caller.roles.includes(SUPERVISOR)) return supervisorRequired();
  const kind = params.get('kind');
  const limit = Math.min(Math.max(Number(params.get('limit') ?? 50) || 50, 1), 100);
  const cursor = params.get('cursor');
  const now = reviewClock.now();
  const counts: Record<string, number> = {};
  for (const band of AGE_BANDS) counts[band] = 0;
  const listed: ApprovalItem[] = [];
  for (const source of sources) {
    const pending = source.pending(caller, cases);
    counts[source.kind] = pending.length;
    for (const each of pending) {
      const band = ageBand(each.proposedAt, now);
      counts[band] = (counts[band] ?? 0) + 1;
      if (kind !== null && kind !== source.kind) continue;
      listed.push({
        ...each,
        kind: source.kind,
        canApprove: each.cannotApproveReason === null,
        reassignedTo: reassignedTo(each.subjectId, caller),
      });
    }
  }
  listed.sort(
    (a, b) => a.proposedAt.localeCompare(b.proposedAt) || a.subjectId.localeCompare(b.subjectId),
  );
  let start = 0;
  if (cursor !== null) {
    start = listed.findIndex((each) => each.subjectId === cursor) + 1;
    if (start === 0) return problem(400, 'Unknown cursor');
  }
  const page = listed.slice(start, start + limit);
  const last = page.at(-1);
  return json(200, {
    items: page,
    nextCursor: last && start + limit < listed.length ? last.subjectId : null,
    counts,
  });
}

async function reassignTo(
  request: Request,
  kind: string,
  subjectId: string,
  caller: MockApprover,
): Promise<Response> {
  if (!caller.roles.includes(SUPERVISOR)) return supervisorRequired();
  const found = sources.find((source) => source.kind === kind)?.find(subjectId) ?? null;
  if (!found) return problem(404, 'Not found');
  if (!found.pending) {
    return mockProblem(
      409,
      'not-proposed',
      `It is ${found.status}; it no longer waits for a decision.`,
    );
  }
  const body = await readJson(request);
  const subject = isRecord(body) ? body.toSupervisor : null;
  if (typeof subject !== 'string' || !subject.trim() || subject.length > 200) {
    return problem(400, 'toSupervisor is required');
  }
  const to = staff.find((member) => member.subject === subject) ?? { subject, name: subject };
  const reassigned = { subject: to.subject, name: to.name };
  reassignments.set(subjectId, reassigned);
  return json(200, { kind, subjectId, reassignedTo: reassigned });
}
