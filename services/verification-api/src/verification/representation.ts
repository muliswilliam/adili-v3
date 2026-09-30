import { DISCLOSURE_LEVELS, DOCUMENT_STATUSES, REVOCATION_REASONS } from '@adili/events/contracts';
import { z } from 'zod';

import type { ProjectionRow } from './schema.js';

export const verificationStatusSchema = z.enum([...DOCUMENT_STATUSES, 'not-found']);
export type VerificationStatus = z.infer<typeof verificationStatusSchema>;

export const disclosureLevelSchema = z.enum(DISCLOSURE_LEVELS);

/** The public-safe fields of a public or restricted document (ADR-010 §2). */
export const verifiedDocumentSchema = z.object({
  type: z.string().meta({ examples: ['acknowledgement-slip'] }),
  issuerName: z.string(),
  issuerCode: z.string(),
  issuedAt: z.iso.datetime({ offset: true }),
  reference: z.string().nullable(),
  version: z.int().nullable(),
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
 * What the page may show of a projected document: everything its level allows, validity only
 * for confidential documents (the projection holds no payload or link for them either).
 */
export function toVerificationResult(row: ProjectionRow, checkedAt: Date): VerificationResult {
  const disclosed = row.disclosureLevel !== 'confidential';
  const payload = disclosed ? row.publicPayload : null;
  return {
    verificationId: row.verificationId,
    status: row.status,
    disclosureLevel: row.disclosureLevel,
    document: payload
      ? {
          type: payload.type,
          issuerName: payload.issuerName,
          issuerCode: payload.issuerCode,
          issuedAt: payload.issuedAt,
          reference: payload.reference,
          version: payload.version,
        }
      : null,
    sha256: disclosed ? row.sha256 : null,
    supersededBy: disclosed && row.status === 'superseded' ? row.supersededBy : null,
    revokedReason: disclosed && row.status === 'revoked' ? row.revokedReason : null,
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
