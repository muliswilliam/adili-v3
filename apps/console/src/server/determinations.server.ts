import type { ReviewClient } from './review/client.server';
import type { Determination, DeterminationInput, LetterDownload } from './review/types';
import { callService, type ServiceError } from './service-call';

/**
 * The review service's determination endpoints (spec 08, S1 and S2): propose on a case, approve,
 * return and withdraw, and the decision letter. Each refusal the screens explain gets its own
 * `refusal` (from the problem's `code`); anything else is a plain service error. Pure: the
 * caller injects the client (see `determinations.ts` for the server functions).
 */

/** Why review refused a determination call, as review.yaml's problem codes name it. */
export type DeterminationRefusal =
  /** Propose: one is already proposed or approved (409). */
  | { kind: 'determination-open' }
  /** Propose: a clarification of the case is still open (409). */
  | { kind: 'clarification-open' }
  /** Propose: only the case's assignee proposes (403). */
  | { kind: 'not-the-assignee' }
  /** Approve or return: the caller proposed it or held the case (403). */
  | { kind: 'separation-of-duties'; reason: 'proposer' | 'reviewer-of-record' }
  /** Approve or return: a reviewer, not a supervisor (403). */
  | { kind: 'supervisor-required' }
  /** Withdraw: only the proposer withdraws (403). */
  | { kind: 'not-the-proposer' }
  /** Approve, return or withdraw: it was decided already (409). */
  | { kind: 'not-proposed' };

export type DeterminationResult<T> =
  | { ok: true; data: T }
  | { ok: false; refusal: DeterminationRefusal }
  | { ok: false; refusal: null; error: ServiceError };

const CODES = new Set<DeterminationRefusal['kind']>([
  'determination-open',
  'clarification-open',
  'not-the-assignee',
  'separation-of-duties',
  'supervisor-required',
  'not-the-proposer',
  'not-proposed',
]);

function isRefusalKind(value: unknown): value is DeterminationRefusal['kind'] {
  return typeof value === 'string' && CODES.has(value as DeterminationRefusal['kind']);
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
