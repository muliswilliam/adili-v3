import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import {
  ASSETS_GROUNDS,
  DECLINE_NOTE_MAX_LENGTH,
  MAX_CLARIFICATIONS,
  MAX_FLAGS,
  NARRATIVE_MAX_LENGTH,
  REFERRAL_STATUSES,
} from '../referral/view';
import { asReviewer, withReviewer } from './as-viewer.server';
import { SLUG_PATTERN } from './directory/contract';
import { letterDocumentsClient } from './documents/letter-client.server';
import {
  approveReferral,
  declineReferral,
  listReferrals,
  loadReferral,
  proposeReferral,
  type DecisionResult,
  type ProposeResult,
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

/** Without a session: what any referral call answers. */
const signedOut = (): { ok: false; refusal: null; error: { kind: 'unauthenticated' } } => ({
  ok: false,
  refusal: null,
  error: { kind: 'unauthenticated' },
});

/** review.yaml `ReferralInput`, as the Refer to EACC dialog sends it. */
export const referralInput = z.object({
  grounds: z.enum(ASSETS_GROUNDS),
  narrative: z.string().trim().min(1).max(NARRATIVE_MAX_LENGTH),
  flagIds: z.array(id).min(1).max(MAX_FLAGS),
  clarificationIds: z.array(id).max(MAX_CLARIFICATIONS),
});

export const proposeCaseReferral = createServerFn({ method: 'POST' })
  .validator(z.object({ caseId: id, input: referralInput, idempotencyKey: id }))
  .handler(({ data }): Promise<ProposeResult> =>
    withReviewer(
      (client) => proposeReferral(client, data.caseId, data.input, data.idempotencyKey),
      signedOut,
    ),
  );

export const getReferrals = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      slug: z.string().regex(SLUG_PATTERN),
      status: z.enum(REFERRAL_STATUSES).optional(),
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

export const approveCaseReferral = createServerFn({ method: 'POST' })
  .validator(z.object({ referralId: id, idempotencyKey: id }))
  .handler(({ data }): Promise<DecisionResult> =>
    withReviewer(
      (client) => approveReferral(client, data.referralId, data.idempotencyKey),
      signedOut,
    ),
  );

export const declineCaseReferral = createServerFn({ method: 'POST' })
  .validator(
    z.object({ referralId: id, note: z.string().trim().min(1).max(DECLINE_NOTE_MAX_LENGTH) }),
  )
  .handler(({ data }): Promise<DecisionResult> =>
    withReviewer((client) => declineReferral(client, data.referralId, data.note), signedOut),
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
