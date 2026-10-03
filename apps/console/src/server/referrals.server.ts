import type { DocumentsClient } from './documents/client';
import type { ReviewClient } from './review/client.server';
import type { Referral, ReferralInput, ReferralStatus } from './review/types';
import { callService, type ServiceError, type ServiceResult } from './service-call';

/**
 * The review service's referral endpoints (spec 08, S12 and S13): propose an assets referral
 * from a case, the Commission's referrals, one referral with what its package includes, approve
 * and decline, and the evidence package's download. Each refusal the screens explain gets its
 * own `refusal` (from the problem's `code`); anything else is a plain service error. Pure: the
 * caller injects the client (see `referrals.ts` for the server functions).
 */

/** Why review refused a referral call, as review.yaml's problem codes name it. */
export type ReferralRefusal =
  /** Propose: one from the case already waits for approval (409). */
  | { kind: 'referral-open' }
  /** Propose: only the case's assignee proposes (403). */
  | { kind: 'not-the-assignee' }
  /** Approve or decline: the caller proposed it or held one of its cases (403). */
  | { kind: 'separation-of-duties'; reason: 'proposer' | 'reviewer-of-record' }
  /** Approve or decline: a reviewer, not a supervisor (403). */
  | { kind: 'supervisor-required' }
  /** Approve or decline: it was decided already (409). */
  | { kind: 'not-proposed' };

/** The refusals of a decision (approve, decline). */
export type ReferralDecisionRefusal = Exclude<
  ReferralRefusal,
  { kind: 'referral-open' | 'not-the-assignee' }
>;

export type ReferralResult<T, Refusal extends ReferralRefusal = ReferralRefusal> =
  | { ok: true; data: T }
  | { ok: false; refusal: Refusal }
  | { ok: false; refusal: null; error: ServiceError };

/** Each refusal's HTTP status, as review.yaml answers it. */
export const REFERRAL_REFUSAL_STATUS: Record<ReferralRefusal['kind'], 403 | 409> = {
  'referral-open': 409,
  'not-the-assignee': 403,
  'separation-of-duties': 403,
  'supervisor-required': 403,
  'not-proposed': 409,
};

function isRefusalKind(value: unknown): value is ReferralRefusal['kind'] {
  return typeof value === 'string' && value in REFERRAL_REFUSAL_STATUS;
}

/** The refusal a 403 or 409 problem names, or null for any other answer. */
export function referralRefusalOf(error: ServiceError): ReferralRefusal | null {
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
): Promise<ReferralResult<T>> {
  const result = await callService(call);
  if (result.ok) return result;
  const refusal = referralRefusalOf(result.error);
  return refusal ? { ok: false, refusal } : { ok: false, refusal: null, error: result.error };
}

/** A decision's answer: a proposal's refusals (assignee, open) are outside the contract here. */
async function decision(
  call: () => Promise<{ data?: Referral; error?: unknown; response: Response }>,
): Promise<ReferralResult<Referral, ReferralDecisionRefusal>> {
  const result = await settle(call);
  if (result.ok || result.refusal === null) return result;
  const { refusal } = result;
  if (refusal.kind === 'referral-open' || refusal.kind === 'not-the-assignee') {
    return { ok: false, refusal: null, error: { kind: 'unavailable', detail: null } };
  }
  return { ok: false, refusal };
}

/**
 * `POST /v1/review/cases/{caseId}/referrals`: the case's assignee proposes an assets referral
 * with the flags and clarifications it rests on, for a supervisor to approve. `idempotencyKey`
 * is one per dialog, reused on retry.
 */
export function proposeReferral(
  client: ReviewClient,
  caseId: string,
  input: ReferralInput,
  idempotencyKey: string,
): Promise<ReferralResult<Referral>> {
  return settle(() =>
    client.POST('/v1/review/cases/{caseId}/referrals', {
      params: { path: { caseId }, header: { 'Idempotency-Key': idempotencyKey } },
      body: input,
    }),
  );
}

export interface ReferralsQuery {
  status?: ReferralStatus;
  cursor?: string;
  limit?: number;
}

export interface ReferralsPage {
  items: Referral[];
  nextCursor: string | null;
}

/** `GET /v1/commissions/{slug}/referrals`: newest proposal first, of one status or all. */
export function listReferrals(
  client: ReviewClient,
  slug: string,
  query: ReferralsQuery,
): Promise<ServiceResult<ReferralsPage>> {
  return callService(() =>
    client.GET('/v1/commissions/{slug}/referrals', {
      params: {
        path: { slug },
        query: {
          ...(query.status ? { status: query.status } : {}),
          ...(query.cursor ? { cursor: query.cursor } : {}),
          ...(query.limit ? { limit: query.limit } : {}),
        },
      },
    }),
  );
}

/**
 * `GET /v1/review/referrals/{referralId}`: the referral with `evidence` (what its package
 * includes, by reference) and, once sent, the package's manifest.
 */
export function loadReferral(
  client: ReviewClient,
  referralId: string,
): Promise<ServiceResult<Referral>> {
  return callService(() =>
    client.GET('/v1/review/referrals/{referralId}', { params: { path: { referralId } } }),
  );
}

/**
 * `POST .../approve`: a supervisor who neither proposed it nor held its case approves; review
 * allocates the RFL reference, then assembles the package and sends it to EACC in the
 * background. The declarant is not told.
 */
export function approveReferral(
  client: ReviewClient,
  referralId: string,
  idempotencyKey: string,
): Promise<ReferralResult<Referral, ReferralDecisionRefusal>> {
  return decision(() =>
    client.POST('/v1/review/referrals/{referralId}/approve', {
      params: { path: { referralId }, header: { 'Idempotency-Key': idempotencyKey } },
    }),
  );
}

/** `POST .../decline` with the supervisor's note (1 to 2,000); nothing is sent. */
export function declineReferral(
  client: ReviewClient,
  referralId: string,
  note: string,
): Promise<ReferralResult<Referral, ReferralDecisionRefusal>> {
  return decision(() =>
    client.POST('/v1/review/referrals/{referralId}/decline', {
      params: { path: { referralId } },
      body: { reason: note },
    }),
  );
}

/**
 * A short-lived link to a sent referral's evidence package (Confidential): review names the
 * package's document, then the documents service hands out the link as the signed-in officer
 * and audits it. No package yet reads as unavailable.
 */
export async function referralPackageLink(
  review: ReviewClient,
  documents: DocumentsClient,
  referralId: string,
): Promise<ServiceResult<{ downloadUrl: string }>> {
  const referral = await loadReferral(review, referralId);
  if (!referral.ok) return referral;
  const documentId = referral.data.package?.documentId;
  if (!documentId) return { ok: false, error: { kind: 'unavailable', detail: null } };
  const link = await callService(() =>
    documents.GET('/v1/documents/{documentId}/download', {
      params: { path: { documentId } },
    }),
  );
  return link.ok ? { ok: true, data: { downloadUrl: link.data.downloadUrl } } : link;
}
