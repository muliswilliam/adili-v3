import { DeclarationSchema, type DeclarationV1 } from '@adili/forms';
import { z } from 'zod';

import type { ReviewClient } from './review/client.server';
import type { Assignee, CaseDetail, CaseListItem, Flag, Note, RegistryView } from './review/types';
import { callService, type ServiceError, type ServiceResult } from './service-call';

/**
 * The review service's case endpoints for the case view (spec 07a FE-3, review.yaml), folded
 * into results the screen can switch on. Pure: the caller injects the client (`review-case.ts`
 * holds the server functions that call these as the signed-in reviewer or supervisor).
 */

/** JSON as a server function can send it (an `unknown` map cannot be checked as serialisable). */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** A flag whose evidence is plain JSON, as review.yaml has it: facts, never amounts. */
export type CaseFlag = Omit<Flag, 'evidence'> & { evidence: Record<string, JsonValue> };

type RegistryPersonView = RegistryView['persons'][number];
type RegistrySystemView = RegistryPersonView['systems'][number];

/** A registry record beside a declared item, the record as plain JSON (as the gateway holds it). */
export type CaseRegistryRow = Omit<RegistrySystemView['rows'][number], 'registryRecord'> & {
  registryRecord: Record<string, JsonValue>;
};

/** review.yaml `RegistryView` with plain JSON records and evidence, as a server function sends it. */
export interface CaseRegistryView {
  checkedAt: string | null;
  persons: (Omit<RegistryPersonView, 'systems'> & {
    systems: (Omit<RegistrySystemView, 'rows' | 'flags'> & {
      rows: CaseRegistryRow[];
      flags: CaseFlag[];
    })[];
  })[];
}

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
  const rest: CaseData = { ...others, flags: flags };
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

/** `POST .../claim`: the caller holds the case; 409 when another reviewer got there first. */
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

/** `PUT .../assignment`: a supervisor gives the case to a reviewer, or unassigns it (null). */
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

/** `POST .../flags/{flagId}/reviewed`: once, with the assignee's conclusion; 409 when it was. */
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
  );
}

/**
 * `GET .../registry`: per person and registry, the latest check's status with the registry's
 * records (pulled from the integration-gateway for this read) beside the declared items. A 502
 * means the declaration or the records could not be read; the case's own registry summary still
 * has the statuses.
 */
export async function loadRegistry(
  client: ReviewClient,
  caseId: string,
): Promise<ServiceResult<CaseRegistryView>> {
  const result = await callService(() =>
    client.GET('/v1/review/cases/{caseId}/registry', { params: { path: { caseId } } }),
  );
  if (!result.ok) return result;
  const view = result.data;
  const persons: CaseRegistryView['persons'] = [];
  for (const person of view.persons) {
    const systems: CaseRegistryView['persons'][number]['systems'] = [];
    for (const system of person.systems) {
      const rows: CaseRegistryRow[] = [];
      for (const row of system.rows) {
        const record = registryRecordSchema.safeParse(row.registryRecord);
        // A record that is not plain JSON is outside the contract: as if review had not answered.
        if (!record.success) return { ok: false, error: { kind: 'unavailable', detail: null } };
        rows.push({ ...row, registryRecord: record.data });
      }
      systems.push({ ...system, rows });
    }
    persons.push({ ...person, systems });
  }
  return { ok: true, data: { checkedAt: view.checkedAt, persons } };
}

const jsonValue: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValue),
    z.record(z.string(), jsonValue),
  ]),
);

/** A registry record as the gateway holds it: an object of plain JSON values. */
const registryRecordSchema = z.record(z.string(), jsonValue);

/**
 * `GET .../registry/status`: when the case's latest registry check was stored. Not an audited
 * read (no declaration, no records), so the case view polls it while a re-check runs and reads
 * the Registry tab once the new check has landed.
 */
export async function loadRegistryStatus(
  client: ReviewClient,
  caseId: string,
): Promise<ServiceResult<{ checkedAt: string | null }>> {
  return callService(() =>
    client.GET('/v1/review/cases/{caseId}/registry/status', { params: { path: { caseId } } }),
  );
}

/** Why review refused a re-check, beyond the usual service errors. */
export type RecheckRefusal =
  /** Re-checked within the last 10 minutes (429); the next one is accepted after this. */
  | { kind: 'cooldown'; retryAfterSeconds: number }
  /** Neither the assignee nor a supervisor (403). */
  | { kind: 'forbidden' }
  /** The case is determined (409). */
  | { kind: 'closed' };

export type RecheckResult =
  | { ok: true }
  | { ok: false; refusal: RecheckRefusal }
  | { ok: false; refusal: null; error: ServiceError };

/** review.yaml's cooldown: what a 429 without `retryAfterSeconds` waits for. */
const COOLDOWN_SECONDS = 600;

/**
 * `POST .../recheck` (202): the registries are checked again in the background; the case's
 * registry summary shows the new check once it is stored.
 */
export async function recheck(client: ReviewClient, caseId: string): Promise<RecheckResult> {
  const result = await callService(() =>
    client.POST('/v1/review/cases/{caseId}/recheck', { params: { path: { caseId } } }),
  );
  if (result.ok) return { ok: true };
  const { error } = result;
  if (error.kind === 'problem') {
    const problem: { status: number; retryAfterSeconds?: unknown } = error.problem;
    if (problem.status === 429) {
      const seconds = problem.retryAfterSeconds;
      return {
        ok: false,
        refusal: {
          kind: 'cooldown',
          retryAfterSeconds:
            typeof seconds === 'number' && seconds > 0 ? seconds : COOLDOWN_SECONDS,
        },
      };
    }
    if (problem.status === 403) return { ok: false, refusal: { kind: 'forbidden' } };
    if (problem.status === 409) return { ok: false, refusal: { kind: 'closed' } };
  }
  return { ok: false, refusal: null, error };
}

/** A reviewer (or supervisor) a supervisor can give the case to. */
export interface Reviewer {
  subject: string;
  name: string;
  /** Open review cases the reviewer holds now. */
  open: number;
  /** The reviewer held this case before (a reviewer of record). */
  ofRecord: boolean;
}

/**
 * `GET /v1/commissions/{slug}/review/queue/reviewers`: the Commission's reviewers and
 * supervisors (as the directory has its staff) with the open cases each holds, by name; the
 * case's holder left out and its reviewers of record marked.
 */
export async function loadReviewers(
  client: ReviewClient,
  slug: string,
  detail: { assignee: string | null; reviewerHistory: Assignee[] },
): Promise<ServiceResult<Reviewer[]>> {
  const result = await callService(() =>
    client.GET('/v1/commissions/{slug}/review/queue/reviewers', { params: { path: { slug } } }),
  );
  if (!result.ok) return result;
  return {
    ok: true,
    data: result.data.items
      .filter((member) => member.subject !== detail.assignee)
      .map((member) => ({
        subject: member.subject,
        name: member.name,
        open: member.openCases,
        ofRecord: detail.reviewerHistory.some((each) => each.subject === member.subject),
      })),
  };
}
