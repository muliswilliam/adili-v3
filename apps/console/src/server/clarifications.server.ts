import { isOutstanding } from '../clarification/labels';
import type { ReviewClient } from './review/client.server';
import type { components } from './review/api.gen';
import type { CaseListItem, Clarification, ClarificationStatus } from './review/types';
import { callService, type ServiceError, type ServiceResult } from './service-call';

type Schemas = components['schemas'];

/**
 * The review service's clarification endpoints for the case's reviewer (spec 07a S15), folded
 * into results the clarification detail can switch on. Pure: the caller injects the client (see
 * `clarifications.ts` for the server functions that call these as the signed-in reviewer).
 */

/** JSON as it crosses the server function boundary; a declaration document is an open object. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
export type JsonObject = Record<string, Json>;

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
  /**
   * The case's current version as filed (`CaseDetail.document`), which names the items and
   * which the composer offers targets from; null when the declarations service did not answer.
   */
  document: JsonObject | null;
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
      document: detail.data.document as JsonObject | null,
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

/** review.yaml `ClarificationItemInput`. */
export type ClarificationItemInput = Schemas['ClarificationItemInput'];

/**
 * Saves the composer's items: `POST /v1/review/cases/{caseId}/clarifications` for a new draft
 * (with `key`, so a retry does not make a second one), else `PUT .../clarifications/{id}` (only
 * while it is a draft; 409 after).
 */
export function saveDraft(
  client: ReviewClient,
  caseId: string,
  clarificationId: string | null,
  items: ClarificationItemInput[],
  key: string,
): Promise<ServiceResult<Clarification>> {
  if (clarificationId === null) {
    return callService(() =>
      client.POST('/v1/review/cases/{caseId}/clarifications', {
        params: { path: { caseId }, header: { 'Idempotency-Key': key } },
        body: { items },
      }),
    );
  }
  return callService(() =>
    client.PUT('/v1/review/clarifications/{clarificationId}', {
      params: { path: { clarificationId } },
      body: { items },
    }),
  );
}

/** An issue that failed, with the draft it saved on the way (kept for the reviewer). */
export type IssueResult =
  { ok: true; data: Clarification } | { ok: false; error: ServiceError; draftId: string | null };

/**
 * Saves the items, then issues the draft (`POST .../issue` with `keys.issue`): the review service
 * allocates the CLR reference, requests the letter, notifies the declarant and starts the 30-day
 * clock. When the issue fails (window closed, 403, unavailable) the saved draft's id comes back,
 * so the composer keeps editing that draft rather than starting another. A retry after an issue
 * that went through finds the clarification no longer a draft (409) and replays the issue under
 * the same key, which answers the issued clarification.
 */
export async function issueDraft(
  client: ReviewClient,
  caseId: string,
  clarificationId: string | null,
  items: ClarificationItemInput[],
  keys: { draft: string; issue: string },
): Promise<IssueResult> {
  const saved = await saveDraft(client, caseId, clarificationId, items, keys.draft);
  const replay =
    !saved.ok &&
    clarificationId !== null &&
    saved.error.kind === 'problem' &&
    saved.error.problem.status === 409;
  if (!saved.ok && !replay) return { ...saved, draftId: clarificationId };
  const id = saved.ok ? saved.data.id : (clarificationId ?? '');
  const issued = await callService(() =>
    client.POST('/v1/review/clarifications/{clarificationId}/issue', {
      params: { path: { clarificationId: id }, header: { 'Idempotency-Key': keys.issue } },
    }),
  );
  return issued.ok ? issued : { ...issued, draftId: id };
}
