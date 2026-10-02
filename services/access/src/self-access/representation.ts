import { TENANT_KEY } from '@adili/api-kit';
import { z } from 'zod';

import { commissionRefSchema } from '../requests/representation.js';
import type { CertifiedCopyRow } from './certified-copy-issuance.js';
import { CERTIFIED_COPY_STATUSES } from './schema.js';

/** Body of `requestCertifiedCopy` (access.yaml `CertifiedCopyRequest`). */
export const certifiedCopyRequestSchema = z.strictObject({
  commission: z.string().regex(TENANT_KEY).meta({
    description: 'Slug of the Commission the declaration was filed with (its `commission.slug`)',
  }),
  declarationId: z.uuid(),
  version: z.int().min(1).meta({ description: 'The submitted version' }),
});

export type CertifiedCopyRequest = z.infer<typeof certifiedCopyRequestSchema>;

/**
 * access.yaml `CertifiedCopy`: a certified copy of one of the declarant's submitted versions, as
 * they follow it from `pending` to `issued` (or `failed`: declarations has no such submitted
 * version of theirs at the Commission). Once issued, the declarant downloads it from documents
 * (`getDocumentDownload` with `documentId`), with their own token.
 */
export const certifiedCopySchema = z.object({
  id: z.uuid(),
  commission: commissionRefSchema,
  declarationId: z.uuid(),
  version: z.int().min(1),
  /** The declaration's reference (ADR-011); null until issued. */
  reference: z.string().nullable(),
  status: z.enum(CERTIFIED_COPY_STATUSES),
  /** The Restricted `certified-copy` document; null until issued. */
  documentId: z.uuid().nullable(),
  verificationId: z.string().nullable(),
  requestedAt: z.iso.datetime({ offset: true }),
  issuedAt: z.iso.datetime({ offset: true }).nullable(),
});

export type CertifiedCopy = z.infer<typeof certifiedCopySchema>;

export function toCertifiedCopy(row: CertifiedCopyRow): CertifiedCopy {
  return {
    id: row.id,
    commission: { slug: row.tenant, name: row.commissionName },
    declarationId: row.declarationId,
    version: row.version,
    reference: row.reference,
    status: row.status,
    documentId: row.documentId,
    verificationId: row.verificationId,
    requestedAt: row.requestedAt.toISOString(),
    issuedAt: row.issuedAt?.toISOString() ?? null,
  };
}
