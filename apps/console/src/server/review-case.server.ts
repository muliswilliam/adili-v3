import type { ReviewClient } from './review/client.server';
import type { Assignee, CaseDetail, CaseListItem, Flag, Note } from './review/types';
import { callService, type ServiceResult } from './service-call';

/**
 * The review service's case endpoints for the case view (spec 07a FE-3, S8, S9, S11), folded into
 * results the screen can switch on. Pure: the caller injects the client (see `review-case.ts`
 * for the server functions that call these as the signed-in reviewer or supervisor).
 */

/** JSON, as the document and a flag's evidence are: what a server function can return. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
export type JsonObject = Record<string, Json>;

/**
 * A flag as the case view gets it: review.yaml types its evidence as any object, but the rules
 * record only clear facts (strings, numbers, booleans, lists of codes).
 */
export type CaseFlag = Omit<Flag, 'evidence'> & { evidence: JsonObject };

/** The case detail as the case view reads it (determinations are spec 08's). */
export type CaseViewDetail = Omit<CaseDetail, 'flags' | 'document' | 'determinations'> & {
  flags: CaseFlag[];
  document: JsonObject | null;
};

function viewOf(detail: CaseDetail): CaseViewDetail {
  const view: Partial<CaseDetail> = { ...detail };
  delete view.determinations;
  return view as CaseViewDetail;
}

export interface CaseView {
  detail: CaseViewDetail;
  /**
   * The declarations service could not give the document (502 `declarations-unavailable`): the
   * rest of the case still shows, and no view was recorded.
   */
  documentUnavailable: boolean;
  /** Who is looking, as their session names them. */
  viewer: Assignee;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const PROBLEM_FIELDS = new Set(['type', 'title', 'status', 'detail']);

/** The 502 problem carries the case detail with a null document (review.yaml `getReviewCase`). */
function caseDetailOf(body: unknown): CaseViewDetail | null {
  if (!isRecord(body) || !isRecord(body.case) || !Array.isArray(body.flags)) return null;
  if (!Array.isArray(body.timeline) || !Array.isArray(body.versions)) return null;
  // The problem's own fields; the rest is the case detail.
  const rest = Object.fromEntries(
    Object.entries(body).filter(([field]) => !PROBLEM_FIELDS.has(field)),
  );
  return { ...viewOf(rest as unknown as CaseDetail), document: null };
}

/**
 * `GET /v1/review/cases/{caseId}`: the case with its declaration, pulled on demand and audited
 * as a read. When declarations is down the service still answers with the case (502); that is
 * a case view without the document, not a failed load.
 */
export async function loadCaseView(
  client: ReviewClient,
  caseId: string,
  viewer: Assignee,
): Promise<ServiceResult<CaseView>> {
  const unavailable: { detail: CaseViewDetail | null } = { detail: null };
  const result = await callService(async () => {
    const outcome = await client.GET('/v1/review/cases/{caseId}', {
      params: { path: { caseId } },
    });
    if (outcome.response.status === 502) unavailable.detail = caseDetailOf(outcome.error);
    return outcome;
  });
  if (unavailable.detail) {
    return { ok: true, data: { detail: unavailable.detail, documentUnavailable: true, viewer } };
  }
  if (!result.ok) return result;
  return { ok: true, data: { detail: viewOf(result.data), documentUnavailable: false, viewer } };
}

/** `POST .../claim`: the case becomes the caller's (409 `case-already-assigned` if taken). */
export function claim(client: ReviewClient, caseId: string): Promise<ServiceResult<CaseListItem>> {
  return callService(() =>
    client.POST('/v1/review/cases/{caseId}/claim', { params: { path: { caseId } } }),
  );
}

/** `POST .../release`: the caller's case goes back to the queue (403 for anyone else's). */
export function release(
  client: ReviewClient,
  caseId: string,
): Promise<ServiceResult<CaseListItem>> {
  return callService(() =>
    client.POST('/v1/review/cases/{caseId}/release', { params: { path: { caseId } } }),
  );
}

/** `PUT .../assignment`: a supervisor hands the case to `assignee`, or unassigns it (null). */
export function reassign(
  client: ReviewClient,
  caseId: string,
  assignee: string | null,
): Promise<ServiceResult<CaseListItem>> {
  return callService(() =>
    client.PUT('/v1/review/cases/{caseId}/assignment', {
      params: { path: { caseId } },
      body: { assignee },
    }),
  );
}

/** `POST .../notes`: an internal note (1 to 2,000 characters). */
export function addNote(
  client: ReviewClient,
  caseId: string,
  text: string,
): Promise<ServiceResult<Note>> {
  return callService(() =>
    client.POST('/v1/review/cases/{caseId}/notes', {
      params: { path: { caseId } },
      body: { text },
    }),
  );
}

/** `POST .../flags/{flagId}/reviewed` with the reviewer's conclusion (409 if reviewed already). */
export function markFlagReviewed(
  client: ReviewClient,
  caseId: string,
  flagId: string,
  note: string,
): Promise<ServiceResult<CaseFlag>> {
  return callService(() =>
    client.POST('/v1/review/cases/{caseId}/flags/{flagId}/reviewed', {
      params: { path: { caseId, flagId } },
      body: { note },
    }),
  ) as Promise<ServiceResult<CaseFlag>>;
}

/** A short-lived link to one of the declaration's attachments (an audited read). */
export function attachmentLink(
  client: ReviewClient,
  caseId: string,
  uploadId: string,
): Promise<ServiceResult<{ downloadUrl: string; expiresAt: string }>> {
  return callService(() =>
    client.GET('/v1/review/cases/{caseId}/attachments/{uploadId}/download', {
      params: { path: { caseId, uploadId } },
    }),
  );
}
