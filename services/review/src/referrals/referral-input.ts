import { z } from 'zod';

import { REFERRAL_STATUSES, REVIEWER_GROUNDS } from './schema.js';

/**
 * review.yaml `ReferralInput`: a reviewer's referral from a case, on grounds of undeclared or
 * unexplained assets, with the flags and clarifications that support it and the narrative.
 */
export const referralInput = z.object({
  grounds: z.enum(REVIEWER_GROUNDS),
  narrative: z.string().trim().min(1).max(8000),
  flagIds: z.array(z.uuid()).min(1).max(100),
  clarificationIds: z.array(z.uuid()).max(50),
});
export type ReferralInput = z.infer<typeof referralInput>;

/** Query of `GET /v1/commissions/{slug}/referrals` (review.yaml `listReferrals`). */
export const referralsQuery = z.object({
  status: z.enum(REFERRAL_STATUSES).optional(),
  cursor: z
    .string()
    .max(500)
    .optional()
    .meta({ description: '`nextCursor` of the previous page; omit for the first page' }),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ReferralsQuery = z.infer<typeof referralsQuery>;
