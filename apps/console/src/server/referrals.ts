import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import { DECLINE_NOTE_MAX_LENGTH, NARRATIVE_MAX_LENGTH } from '../referral/view';
import { asReviewer, withReviewer } from './as-viewer.server';
import { SLUG_PATTERN } from './directory/contract';
import { letterDocumentsClient } from './documents/letter-client.server';
import {
  approveReferral,
  declineReferral,
  listReferrals,
  loadReferral,
  proposeReferral,
  type ReferralDecisionRefusal,
  type ReferralResult,
  type ReferralsPage,
  referralPackageLink,
} from './referrals.server';
import type { Referral } from './review/types';
import type { ServiceResult } from './service-call';

/**
 * Server functions for referrals to EACC (spec 08, S12 and S13), called as the signed-in
 * reviewer or supervisor. The review service decides who may propose, approve and decline (the
 * separation-of-duties rule); tokens stay on the server.
 */

const id = z.uuid();

const signedOut = <T>(): ReferralResult<T> => ({
  ok: false,
  refusal: null,
  error: { kind: 'unauthenticated' },
});

/** review.yaml `ReferralInput`, as the Refer to EACC dialog sends it. */
export const referralInput = z.object({
  grounds: z.enum(['undeclared-assets', 'unexplained-assets']),
  narrative: z.string().trim().min(1).max(NARRATIVE_MAX_LENGTH),
  flagIds: z.array(id).min(1).max(100),
  clarificationIds: z.array(id).max(50),
});

export const proposeCaseReferral = createServerFn({ method: 'POST' })
  .validator(z.object({ caseId: id, input: referralInput, idempotencyKey: id }))
  .handler(({ data }): Promise<ReferralResult<Referral>> =>
    withReviewer(
      (client) => proposeReferral(client, data.caseId, data.input, data.idempotencyKey),
      signedOut<Referral>,
    ),
  );

export const getReferrals = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      slug: z.string().regex(SLUG_PATTERN),
      status: z.enum(['proposed', 'approved', 'declined', 'sent']).optional(),
      cursor: z.string().max(500).optional(),
    }),
  )
  .handler(({ data }): Promise<ServiceResult<ReferralsPage>> =>
    asReviewer((client) =>
      listReferrals(client, data.slug, { status: data.status, cursor: data.cursor }),
    ),
  );

export const getReferral = createServerFn({ method: 'GET' })
  .validator(z.object({ referralId: id }))
  .handler(({ data }): Promise<ServiceResult<Referral>> =>
    asReviewer((client) => loadReferral(client, data.referralId)),
  );

const decisionSignedOut = (): ReferralResult<Referral, ReferralDecisionRefusal> => ({
  ok: false,
  refusal: null,
  error: { kind: 'unauthenticated' },
});

export const approveCaseReferral = createServerFn({ method: 'POST' })
  .validator(z.object({ referralId: id, idempotencyKey: id }))
  .handler(({ data }): Promise<ReferralResult<Referral, ReferralDecisionRefusal>> =>
    withReviewer(
      (client) => approveReferral(client, data.referralId, data.idempotencyKey),
      decisionSignedOut,
    ),
  );

export const declineCaseReferral = createServerFn({ method: 'POST' })
  .validator(
    z.object({ referralId: id, note: z.string().trim().min(1).max(DECLINE_NOTE_MAX_LENGTH) }),
  )
  .handler(({ data }): Promise<ReferralResult<Referral, ReferralDecisionRefusal>> =>
    withReviewer(
      (client) => declineReferral(client, data.referralId, data.note),
      decisionSignedOut,
    ),
  );

/**
 * A short-lived link to a sent referral's evidence package: review names the package, and the
 * documents service hands out the link as the signed-in officer, audited there.
 */
export const getReferralPackageLink = createServerFn({ method: 'GET' })
  .validator(z.object({ referralId: id }))
  .handler(({ data }): Promise<ServiceResult<{ downloadUrl: string }>> =>
    asReviewer((client, { accessToken }) =>
      referralPackageLink(client, letterDocumentsClient(accessToken), data.referralId),
    ),
  );
