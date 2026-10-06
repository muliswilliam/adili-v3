import type { ReviewClient } from './review/client.server';
import type { Determination, DeterminationInput, LetterDownload } from './review/types';
import { type DeterminationRefusal, REFUSAL_STATUS } from '../determination/refusals';
import { callWithRefusals, type RefusalResult, type ServiceResult } from './service-call';

/**
 * The review service's determination endpoints (spec 08, S1 and S2): propose on a case, approve,
 * return and withdraw, and the decision letter. Each refusal the screens explain gets its own
 * `refusal` (from the problem's `code`); anything else is a plain service error. Pure: the
 * caller injects the client (see `determinations.ts` for the server functions).
 */

export type DeterminationResult<T> = RefusalResult<T, DeterminationRefusal>;

function settle<T>(
  call: () => Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<DeterminationResult<T>> {
  return callWithRefusals(call, REFUSAL_STATUS);
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
 * that has none), with a short-lived link the documents service handed review for the Commission.
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
 * (issuing it on the first request for a bulk closure) and asks the documents service for the
 * link for the Commission, auditing the read (#507: documents' own download serves only the
 * declarant). Review's 409 `not-approved` comes back as a problem.
 */
export async function decisionLetterLink(
  review: ReviewClient,
  determinationId: string,
): Promise<ServiceResult<{ downloadUrl: string }>> {
  const letter = await determinationLetter(review, determinationId);
  if (!letter.ok) {
    return letter.refusal === null
      ? { ok: false, error: letter.error }
      : { ok: false, error: { kind: 'unavailable', detail: null } };
  }
  return { ok: true, data: { downloadUrl: letter.data.downloadUrl } };
}
