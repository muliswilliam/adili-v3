import { z } from 'zod';

/** review.yaml `DeterminationInput`: an officer proposes any outcome but the bulk closure's. */
export const determinationInput = z.object({
  outcome: z.enum(['compliant', 'non-compliant', 'further-action']),
  reasons: z.string().trim().min(1).max(4000),
  furtherActionNote: z.string().trim().max(2000).nullish(),
});
export type DeterminationInput = z.infer<typeof determinationInput>;

/** review.yaml `ReasonInput`: why a supervisor returns a proposal. */
export const reasonInput = z.object({ reason: z.string().trim().min(1).max(2000) });
export type ReasonInput = z.infer<typeof reasonInput>;
