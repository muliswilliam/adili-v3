import {
  DISCLOSURE_LEVELS,
  REVOCATION_REASONS,
  VERIFICATION_OUTCOMES,
} from '@adili/events/contracts';
import { z } from 'zod';

import type { ProjectionRow } from './schema.js';

export const verificationStatusSchema = z.enum(VERIFICATION_OUTCOMES);
export type VerificationStatus = z.infer<typeof verificationStatusSchema>;

export const disclosureLevelSchema = z.enum(DISCLOSURE_LEVELS);

/**
 * The public-safe fields of a public or restricted document (ADR-010 §2): what the projection
 * keeps of an event's public payload, and what the page shows.
 */
export const verifiedDocumentSchema = z.object({
  type: z
    .string()
    .min(1)
    .meta({ examples: ['acknowledgement-slip'] }),
  issuerName: z.string().min(1),
  issuerCode: z.string().min(1),
  issuedAt: z.iso.datetime({ offset: true }),
  reference: z.string().nullable(),
  version: z.int().positive().nullable(),
});

export const verificationResultSchema = z.object({
  verificationId: z
    .string()
    .meta({ description: 'The code looked up, in its printed form (normalised)' }),
  status: verificationStatusSchema,
  disclosureLevel: disclosureLevelSchema.nullable(),
  document: verifiedDocumentSchema
    .nullable()
    .meta({ description: 'Public-safe fields; present for public and restricted levels' }),
  sha256: z
    .string()
    .nullable()
    .meta({ description: 'Hash of the issued PDF for the browser-side file check' }),
  supersededBy: z.string().nullable().meta({
    description: 'Verification id of the current version, when the level allows linking',
  }),
  revokedReason: z.enum(REVOCATION_REASONS).nullable(),
  checkedAt: z.iso.datetime({ offset: true }),
});
export type VerificationResult = z.infer<typeof verificationResultSchema>;

/**
 * The answer for a projected document: its row as is, the projection kept only what may show,
 * and `expired` for a valid document past the end of its validity (ADR-010 §3).
 */
export function toVerificationResult(row: ProjectionRow, checkedAt: Date): VerificationResult {
  const expired = row.status === 'valid' && row.expiresAt !== null && row.expiresAt <= checkedAt;
  return {
    verificationId: row.verificationId,
    status: expired ? 'expired' : row.status,
    disclosureLevel: row.disclosureLevel,
    document: row.publicPayload,
    sha256: row.sha256,
    supersededBy: row.supersededBy,
    revokedReason: row.revokedReason,
    checkedAt: checkedAt.toISOString(),
  };
}

/** The answer for a well-formed code nothing was issued under: the same shape, `not-found`. */
export function notFoundResult(verificationId: string, checkedAt: Date): VerificationResult {
  return {
    verificationId,
    status: 'not-found',
    disclosureLevel: null,
    document: null,
    sha256: null,
    supersededBy: null,
    revokedReason: null,
    checkedAt: checkedAt.toISOString(),
  };
}
