import { DeclarationSchema, type DeclarationV1 } from '@adili/forms';

import type { ReviewClient } from './review/client.server';
import type { Assignee, CaseDetail, CaseListItem, CaseStatus, Flag, Note } from './review/types';
import { callService, type ServiceResult } from './service-call';

/**
 * The review service's case endpoints for the case view (spec 07a FE-3, review.yaml), folded
 * into results the screen can switch on. Pure: the caller injects the client (`review-case.ts`
 * holds the server functions that call these as the signed-in officer).
 */

/** JSON as a server function can send it (an `unknown` map cannot be checked as serialisable). */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** A flag whose evidence is plain JSON, as review.yaml has it: facts, never amounts. */
export type CaseFlag = Omit<Flag, 'evidence'> & { evidence: Record<string, JsonValue> };

/** The case detail without its document, which is parsed separately. */
export type CaseData = Omit<CaseDetail, 'document' | 'flags'> & {
  flags: CaseFlag[];
};

export interface CaseLoad {
  detail: CaseData;
  /** The current version's declaration as filed; null when it could not be read. */
  document: DeclarationV1 | null;
  /**
   * Declarations did not answer (review.yaml's 502 `declarations-unavailable`, which still
   * carries the rest of the case) or answered with a document this console cannot read.
   */
  documentUnavailable: boolean;
}

function isCaseDetail(body: unknown): body is CaseDetail {
  return (
    typeof body === 'object' &&
    body !== null &&
    'case' in body &&
    'flags' in body &&
    'timeline' in body &&
    'notes' in body
  );
}

function split(detail: CaseDetail): CaseLoad {
  const { document, flags, ...others } = detail;
  const rest: CaseData = { ...others, flags: flags as CaseFlag[] };
  if (document === null) return { detail: rest, document: null, documentUnavailable: true };
  const parsed = DeclarationSchema.safeParse(document);
  return parsed.success
    ? { detail: rest, document: parsed.data, documentUnavailable: false }
    : { detail: rest, document: null, documentUnavailable: true };
}

/**
 * `GET /v1/review/cases/{caseId}`: the case, its flags, clarifications, notes, timeline and the
 * declaration pulled for this read (an audited view). A 502 still carries the case, so the
 * reviewer sees everything but the declaration.
 */
export async function loadCase(
  client: ReviewClient,
  caseId: string,
): Promise<ServiceResult<CaseLoad>> {
  let unavailableBody: unknown = null;
  const result = await callService(async () => {
    const outcome = await client.GET('/v1/review/cases/{caseId}', {
      params: { path: { caseId } },
    });
    if (outcome.response.status === 502) unavailableBody = outcome.error;
    return outcome;
  });
  if (result.ok) return { ok: true, data: split(result.data) };
  if (isCaseDetail(unavailableBody)) {
    return { ok: true, data: split({ ...unavailableBody, document: null }) };
  }
  return result;
}

/** `POST .../claim`: the caller holds the case; 409 when another officer got there first. */
export function claim(client: ReviewClient, caseId: string): Promise<ServiceResult<CaseListItem>> {
  return callService(() =>
    client.POST('/v1/review/cases/{caseId}/claim', { params: { path: { caseId } } }),
  );
}

/** `POST .../release`: back to the queue (the holder only; else 403). */
export function release(
  client: ReviewClient,
  caseId: string,
): Promise<ServiceResult<CaseListItem>> {
  return callService(() =>
    client.POST('/v1/review/cases/{caseId}/release', { params: { path: { caseId } } }),
  );
}

/** `PUT .../assignment`: a supervisor gives the case to an officer, or unassigns it (null). */
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

/** `POST .../notes`: an internal note, which the declarant never sees. */
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

/** `POST .../flags/{flagId}/reviewed`: once, with the officer's conclusion; 409 when it was. */
export async function markFlagReviewed(
  client: ReviewClient,
  caseId: string,
  flagId: string,
  note: string,
): Promise<ServiceResult<CaseFlag>> {
  const result = await callService(() =>
    client.POST('/v1/review/cases/{caseId}/flags/{flagId}/reviewed', {
      params: { path: { caseId, flagId } },
      body: { note },
    }),
  );
  return result.ok ? { ok: true, data: result.data as CaseFlag } : result;
}

/** An officer a supervisor can give the case to. */
export interface Officer {
  subject: string;
  name: string;
  /** Review cases the officer holds now (as far as the queue shows; see `loadOfficers`). */
  open: number;
  /** The officer held this case before (a reviewer of record). */
  ofRecord: boolean;
}

/** Statuses of a case someone holds. */
const HELD: readonly CaseStatus[] = [
  'assigned',
  'awaiting-clarification',
  'clarified',
  'ready-for-determination',
  'sample-review',
  'further-action',
];

/**
 * The officers a supervisor can reassign a case to. review.yaml lists no officers, so this reads
 * them off the Commission's queue: everyone holding a case (the first 100 per status, enough to
 * name them), with the count, plus the case's reviewers of record and the supervisor. An officer
 * who has never held a case is missing until the contract lists the Commission's reviewers.
 */
export async function loadOfficers(
  client: ReviewClient,
  slug: string,
  detail: { assignee: string | null; reviewerHistory: Assignee[] },
  self: { subject: string; name: string },
): Promise<ServiceResult<Officer[]>> {
  const pages = await Promise.all(
    HELD.map((status) =>
      callService(() =>
        client.GET('/v1/commissions/{slug}/review/queue', {
          params: { path: { slug }, query: { status, limit: 100 } },
        }),
      ),
    ),
  );

  const officers = new Map<string, Officer>();
  const add = (subject: string, name: string) => {
    const known = officers.get(subject);
    if (known) return known;
    const officer = {
      subject,
      name,
      open: 0,
      ofRecord: detail.reviewerHistory.some((each) => each.subject === subject),
    };
    officers.set(subject, officer);
    return officer;
  };
  for (const page of pages) {
    if (!page.ok) return page;
    for (const item of page.data.items) {
      if (item.assignee) add(item.assignee.subject, item.assignee.name).open += 1;
    }
  }
  for (const each of detail.reviewerHistory) add(each.subject, each.name);
  add(self.subject, self.name);
  return {
    ok: true,
    data: [...officers.values()]
      .filter((officer) => officer.subject !== detail.assignee)
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}
