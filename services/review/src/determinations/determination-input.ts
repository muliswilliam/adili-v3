import { z } from 'zod';

import { FURTHER_ACTION_KINDS } from './schema.js';

/** review.yaml `FurtherActionLink`: the administrative action or referral further action is. */
export const furtherActionLink = z.object({
  kind: z.enum(FURTHER_ACTION_KINDS),
  id: z.uuid(),
});
export type FurtherActionLink = z.infer<typeof furtherActionLink>;

/**
 * review.yaml `DeterminationInput`: an officer proposes any outcome but the bulk closure's; a link
 * to an action or referral goes with further action only.
 */
export const determinationInput = z
  .object({
    outcome: z.enum(['compliant', 'non-compliant', 'further-action']),
    reasons: z.string().trim().min(1).max(4000),
    furtherActionNote: z.string().trim().max(2000).nullish(),
    furtherActionLink: furtherActionLink.nullish(),
  })
  .refine((input) => input.furtherActionLink == null || input.outcome === 'further-action', {
    path: ['furtherActionLink'],
    message: 'Only a further-action determination links to an action or referral',
  });
export type DeterminationInput = z.infer<typeof determinationInput>;

/** review.yaml `ReasonInput`: why a supervisor returns a proposal. */
export const reasonInput = z.object({ reason: z.string().trim().min(1).max(2000) });
export type ReasonInput = z.infer<typeof reasonInput>;
