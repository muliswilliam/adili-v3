import { ACCESS_GROUNDS, ACCESS_OUTCOMES } from '@adili/events/contracts';
import { z } from 'zod';

import { scopeSchema } from './scope.js';

/**
 * An access officer's decision on a Form K or law enforcement request (access.yaml `Decision`):
 * final once taken. Denials and partial grants cite Regulation 24 grounds; a partial grant
 * narrows the scope; reasons are always given.
 */

export const outcomeSchema = z.enum(ACCESS_OUTCOMES);
export const groundSchema = z.enum(ACCESS_GROUNDS).meta({ description: 'Regulation 24' });

export const decisionSchema = z.object({
  outcome: outcomeSchema,
  /** The scope granted: the requested one for a grant, a narrower one for a partial grant. */
  grantedScope: scopeSchema.nullable(),
  grounds: z.array(groundSchema),
  reasons: z.string(),
  decidedBy: z.object({ subject: z.string(), name: z.string() }),
  decidedAt: z.iso.datetime({ offset: true }),
});

export type Decision = z.infer<typeof decisionSchema>;

/** A granted package as the requests show it (access.yaml `Package`). */
export const packageSchema = z.object({
  documentId: z.uuid(),
  verificationId: z.string(),
  issuedAt: z.iso.datetime({ offset: true }),
  downloadExpiresAt: z.iso.datetime({ offset: true }),
  downloads: z.int().min(0),
});

export type Package = z.infer<typeof packageSchema>;
