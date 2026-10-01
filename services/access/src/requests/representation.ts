import type { FormKV1 } from '@adili/forms';
import { z } from 'zod';

import { decisionSchema, type Package, packageSchema } from '../decision.js';
import { type RegisterEntry, registerEntrySchema } from '../register/representation.js';
import { ACCESS_REQUEST_STATUSES, type accessRequests } from './schema.js';

/** A Form K document as the API takes and shows it; validated against `form-k.v1` by the service. */
export const formKSchema = z
  .record(z.string(), z.unknown())
  .meta({ description: 'A form-k.v1 document (packages/schemas/forms/form-k.v1.json)' });

export const accessRequestStatusSchema = z.enum(ACCESS_REQUEST_STATUSES);

/** The Commission a request is addressed to. */
export const commissionRefSchema = z.object({ slug: z.string(), name: z.string() });

/** access.yaml `AccessRequest`: a Form K request as its applicant sees it. */
export const accessRequestSchema = z.object({
  id: z.uuid(),
  reference: z.string().meta({ description: 'ARQ-<ISSUER>-<YEAR>-<seq>-<check>' }),
  commission: commissionRefSchema,
  status: accessRequestStatusSchema,
  formK: formKSchema.meta({ description: 'The form-k.v1 document as submitted' }),
  submittedAt: z.iso.datetime({ offset: true }),
  decisionDeadlineAt: z.iso.datetime({ offset: true }),
  decision: decisionSchema.nullable(),
  package: packageSchema.nullable(),
  timeline: z.array(registerEntrySchema),
});

export type AccessRequest = z.infer<typeof accessRequestSchema>;

export type AccessRequestRow = typeof accessRequests.$inferSelect;

/** The request's granted package, once issued; `downloads` counts the register's entries. */
export function packageOf(row: AccessRequestRow, downloads: number): Package | null {
  if (
    row.packageDocumentId === null ||
    row.packageVerificationId === null ||
    row.packageIssuedAt === null ||
    row.downloadExpiresAt === null
  ) {
    return null;
  }
  return {
    documentId: row.packageDocumentId,
    verificationId: row.packageVerificationId,
    issuedAt: row.packageIssuedAt.toISOString(),
    downloadExpiresAt: row.downloadExpiresAt.toISOString(),
    downloads,
  };
}

/** The API shape of a request, with its decrypted Form K and its register entries, oldest first. */
export function toAccessRequest(
  row: AccessRequestRow,
  formK: FormKV1,
  timeline: readonly RegisterEntry[],
): AccessRequest {
  const downloads = timeline.filter((entry) => entry.kind === 'downloaded').length;
  return {
    id: row.id,
    reference: row.reference,
    commission: { slug: row.tenant, name: row.commissionName },
    status: row.status,
    formK: formK as unknown as Record<string, unknown>,
    submittedAt: row.submittedAt.toISOString(),
    decisionDeadlineAt: row.decisionDeadlineAt.toISOString(),
    decision: row.decision,
    package: packageOf(row, downloads),
    timeline: [...timeline],
  };
}
