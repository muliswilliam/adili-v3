import { isOutstanding } from '../clarification/labels';
import type { ReviewClient } from './review/client.server';
import type { CaseListItem, Clarification, ClarificationStatus } from './review/types';
import { callService, type ServiceResult } from './service-call';

/**
 * The review service's clarification endpoints for the case's reviewer (spec 07a S15), folded
 * into results the clarification detail can switch on. Pure: the caller injects the client (see
 * `clarifications.ts` for the server functions that call these as the signed-in reviewer).
 */

export interface ClarificationRef {
  id: string;
  reference: string | null;
  status: ClarificationStatus;
}

export interface ClarificationDetail {
  clarification: Clarification;
  case: CaseListItem;
  /** The viewer holds the case, so the actions are theirs. */
  mine: boolean;
  /** The six-month window to request clarification is still open. */
  windowOpen: boolean;
  /** Other clarifications on the case still outstanding (for the resolve dialog). */
  othersOpen: number;
  original: ClarificationRef | null;
  followUps: ClarificationRef[];
}

function refOf(clarification: Clarification): ClarificationRef {
  return { id: clarification.id, reference: clarification.reference, status: clarification.status };
}

function notFound<T>(): ServiceResult<T> {
  return {
    ok: false,
    error: { kind: 'problem', problem: { type: 'about:blank', title: 'Not found', status: 404 } },
  };
}

/**
 * `GET /v1/review/clarifications/{id}` with its case (`GET /v1/review/cases/{caseId}`, an audited
 * read) for the header, the holder and the other clarifications on the case.
 */
export async function loadClarificationDetail(
  client: ReviewClient,
  caseId: string,
  clarificationId: string,
  subject: string,
  now: string,
): Promise<ServiceResult<ClarificationDetail>> {
  const [one, detail] = await Promise.all([
    callService(() =>
      client.GET('/v1/review/clarifications/{clarificationId}', {
        params: { path: { clarificationId } },
      }),
    ),
    callService(() => client.GET('/v1/review/cases/{caseId}', { params: { path: { caseId } } })),
  ]);
  if (!one.ok) return one;
  if (!detail.ok) return detail;
  const clarification = one.data;
  if (clarification.caseId !== caseId) return notFound();
  const all = detail.data.clarifications;
  const original = clarification.followUpOf
    ? (all.find((each) => each.id === clarification.followUpOf) ?? null)
    : null;
  return {
    ok: true,
    data: {
      clarification,
      case: detail.data.case,
      mine: detail.data.case.assignee?.subject === subject,
      windowOpen: Date.parse(now) <= Date.parse(detail.data.case.windowEndsAt),
      othersOpen: all.filter((each) => each.id !== clarification.id && isOutstanding(each.status))
        .length,
      original: original ? refOf(original) : null,
      followUps: all.filter((each) => each.followUpOf === clarification.id).map(refOf),
    },
  };
}

/** `POST .../resolve` with the note (assignee only). */
export function resolve(
  client: ReviewClient,
  clarificationId: string,
  note: string,
): Promise<ServiceResult<Clarification>> {
  return callService(() =>
    client.POST('/v1/review/clarifications/{clarificationId}/resolve', {
      params: { path: { clarificationId } },
      body: { note },
    }),
  );
}

/** `POST .../withdraw` with the reason; the letter is revoked as issued in error. */
export function withdraw(
  client: ReviewClient,
  clarificationId: string,
  reason: string,
): Promise<ServiceResult<Clarification>> {
  return callService(() =>
    client.POST('/v1/review/clarifications/{clarificationId}/withdraw', {
      params: { path: { clarificationId } },
      body: { reason },
    }),
  );
}

/** `POST .../follow-up`: a new draft pre-filled with the items, `followUpOf` set. */
export function raiseFollowUp(
  client: ReviewClient,
  clarificationId: string,
): Promise<ServiceResult<Clarification>> {
  return callService(() =>
    client.POST('/v1/review/clarifications/{clarificationId}/follow-up', {
      params: { path: { clarificationId } },
    }),
  );
}
