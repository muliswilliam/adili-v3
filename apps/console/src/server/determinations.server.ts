import type { DocumentsClient } from './documents/client';
import type { ReviewClient } from './review/client.server';
import type { Determination, DeterminationInput, LetterDownload } from './review/types';
import { type DeterminationRefusal, REFUSAL_STATUS } from '../determination/refusals';
import { callService, type ServiceError, type ServiceResult } from './service-call';

export type { DeterminationRefusal };

/**
 * The review service's determination endpoints (spec 08, S1 and S2): propose on a case, approve,
 * return and withdraw, and the decision letter. Each refusal the screens explain gets its own
 * `refusal` (from the problem's `code`); anything else is a plain service error. Pure: the
 * caller injects the client (see `determinations.ts` for the server functions).
 */

export type DeterminationResult<T> =
  | { ok: true; data: T }
  | { ok: false; refusal: DeterminationRefusal }
  | { ok: false; refusal: null; error: ServiceError };

function isRefusalKind(value: unknown): value is DeterminationRefusal['kind'] {
  return typeof value === 'string' && Object.hasOwn(REFUSAL_STATUS, value);
}

/** The refusal a 403 or 409 problem names, or null for any other answer. */
export function refusalOf(error: ServiceError): DeterminationRefusal | null {
  if (error.kind !== 'problem') return null;
  const problem: { status: number; type: string; code?: unknown; reason?: unknown } = error.problem;
  if (problem.status !== 403 && problem.status !== 409) return null;
  const code = isRefusalKind(problem.code) ? problem.code : problem.type;
  if (!isRefusalKind(code)) return null;
  if (code === 'separation-of-duties') {
    return {
      kind: code,
      reason: problem.reason === 'proposer' ? 'proposer' : 'reviewer-of-record',
    };
  }
  return { kind: code };
}

async function settle<T>(
  call: () => Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<DeterminationResult<T>> {
  const result = await callService(call);
  if (result.ok) return result;
  const refusal = refusalOf(result.error);
  return refusal ? { ok: false, refusal } : { ok: false, refusal: null, error: result.error };
}

/**
 * `POST /v1/review/cases/{caseId}/determinations`: the assignee proposes an outcome with reasons,
 * for a supervisor to approve. `idempotencyKey` is one per dialog, reused on retry.
 */
export function proposeDetermination(
  client: ReviewClient,
  caseId: string,
  input: DeterminationInput,
  idempotencyKey: string,
): Promise<DeterminationResult<Determination>> {
  return settle(() =>
    client.POST('/v1/review/cases/{caseId}/determinations', {
      params: { path: { caseId }, header: { 'Idempotency-Key': idempotencyKey } },
      body: input,
    }),
  );
}

/**
 * `POST .../approve`: a supervisor who neither proposed it nor held the case approves; review
 * allocates the CMP reference, issues the letter, notifies the declarant and closes the case.
 */
export function approveDetermination(
  client: ReviewClient,
  determinationId: string,
  idempotencyKey: string,
): Promise<DeterminationResult<Determination>> {
  return settle(() =>
    client.POST('/v1/review/determinations/{determinationId}/approve', {
      params: { path: { determinationId }, header: { 'Idempotency-Key': idempotencyKey } },
    }),
  );
}

/** `POST .../return`: back to the proposer with the supervisor's reason (1 to 2,000). */
export function returnDetermination(
  client: ReviewClient,
  determinationId: string,
  reason: string,
): Promise<DeterminationResult<Determination>> {
  return settle(() =>
    client.POST('/v1/review/determinations/{determinationId}/return', {
      params: { path: { determinationId } },
      body: { reason },
    }),
  );
}

/** `POST .../withdraw`: the proposer takes it back while it waits for approval. */
export function withdrawDetermination(
  client: ReviewClient,
  determinationId: string,
): Promise<DeterminationResult<Determination>> {
  return settle(() =>
    client.POST('/v1/review/determinations/{determinationId}/withdraw', {
      params: { path: { determinationId } },
    }),
  );
}

/**
 * `GET .../letter`: the approved determination's decision letter (issued now for a bulk closure
 * that has none). Staff get the document id and download it from the documents service.
 */
export function determinationLetter(
  client: ReviewClient,
  determinationId: string,
): Promise<DeterminationResult<LetterDownload>> {
  return settle(() =>
    client.GET('/v1/review/determinations/{determinationId}/letter', {
      params: { path: { determinationId } },
    }),
  );
}

/**
 * A short-lived link to an approved determination's decision letter: review names the letter
 * (issuing it on the first request for a bulk closure), then the documents service hands out
 * the link as the signed-in officer and audits it. Review's 409 `not-approved` comes back as a
 * problem.
 */
export async function decisionLetterLink(
  review: ReviewClient,
  documents: DocumentsClient,
  determinationId: string,
): Promise<ServiceResult<{ downloadUrl: string }>> {
  const letter = await determinationLetter(review, determinationId);
  if (!letter.ok) {
    return letter.refusal === null
      ? { ok: false, error: letter.error }
      : { ok: false, error: { kind: 'unavailable', detail: null } };
  }
  const link = await callService(() =>
    documents.GET('/v1/documents/{documentId}/download', {
      params: { path: { documentId: letter.data.documentId } },
    }),
  );
  return link.ok ? { ok: true, data: { downloadUrl: link.data.downloadUrl } } : link;
}
