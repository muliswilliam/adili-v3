import type { DocumentsClient } from './documents/client';
import type { ReviewClient } from './review/client.server';
import type { Referral, ReferralInput, ReferralStatus } from './review/types';
import {
  DECISION_REFUSAL_STATUS,
  type DecisionRefusal,
  PROPOSE_REFUSAL_STATUS,
  type ProposeRefusal,
} from '../referral/refusals';
import {
  callService,
  callWithRefusals,
  type RefusalResult,
  type ServiceResult,
} from './service-call';

/**
 * The review service's referral endpoints (spec 08, S12 and S13): propose an assets referral
 * from a case, the Commission's referrals, one referral with what its package includes, approve
 * and decline, and the evidence package's download. Each refusal the screens explain gets its
 * own `refusal` (from the problem's `code`); anything else is a plain service error. Pure: the
 * caller injects the client (see `referrals.ts` for the server functions).
 */

export type { DecisionRefusal, ProposeRefusal };

/** A proposal's answer: the referral, a refusal (assignee, one open), or a failure. */
export type ProposeResult = RefusalResult<Referral, ProposeRefusal>;

/** A decision's answer: the referral, a refusal (separation of duties, decided), or a failure. */
export type DecisionResult = RefusalResult<Referral, DecisionRefusal>;

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
): Promise<ProposeResult> {
  return callWithRefusals(
    () =>
      client.POST('/v1/review/cases/{caseId}/referrals', {
        params: { path: { caseId }, header: { 'Idempotency-Key': idempotencyKey } },
        body: input,
      }),
    PROPOSE_REFUSAL_STATUS,
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
): Promise<DecisionResult> {
  return callWithRefusals(
    () =>
      client.POST('/v1/review/referrals/{referralId}/approve', {
        params: { path: { referralId }, header: { 'Idempotency-Key': idempotencyKey } },
      }),
    DECISION_REFUSAL_STATUS,
  );
}

/** `POST .../decline` with the supervisor's note (1 to 2,000); nothing is sent. */
export function declineReferral(
  client: ReviewClient,
  referralId: string,
  note: string,
): Promise<DecisionResult> {
  return callWithRefusals(
    () =>
      client.POST('/v1/review/referrals/{referralId}/decline', {
        params: { path: { referralId } },
        body: { reason: note },
      }),
    DECISION_REFUSAL_STATUS,
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
