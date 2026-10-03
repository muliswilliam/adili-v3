import { z } from 'zod';

import { assigneeSchema, officer } from '../cases/assignee.js';
import { declarationTypeSchema } from '../cases/representation.js';
import { proposerKindSchema } from '../determinations/representation.js';
import type { EvidencePreviewItem } from './evidence-package.js';
import {
  MANIFEST_KINDS,
  type ManifestItem,
  REFERRAL_GROUNDS,
  REFERRAL_STATUSES,
  type ReferralGrounds,
  type ReferralSources,
  type referrals,
} from './schema.js';

/**
 * Bodies of the referrals API (spec 08). They are the contract: the OpenAPI document,
 * packages/schemas/internal/review.yaml, is generated from them (`pnpm contracts`).
 */

type ReferralRow = typeof referrals.$inferSelect;

export const referralGroundsSchema = z.enum(REFERRAL_GROUNDS);
export const referralStatusSchema = z.enum(REFERRAL_STATUSES);
export const manifestKindSchema = z.enum(MANIFEST_KINDS);

/** review.yaml `ReferralManifestItem`. */
export const manifestItemSchema = z.object({
  kind: manifestKindSchema,
  reference: z.string(),
  sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .meta({
      description:
        "SHA-256 of the item as the package includes it: canonical JSON (sorted keys) for versions' documents, flags, clarifications and obligations; the file's own hash for uploads and letters",
    }),
  documentId: z.uuid().nullable().meta({
    description: 'The upload (attachments) or issued document (letters); null for records',
  }),
}) satisfies z.ZodType<ManifestItem>;

const sourcesSchema = z.object({
  caseIds: z.array(z.uuid()),
  flagIds: z.array(z.uuid()),
  clarificationIds: z.array(z.uuid()),
  obligationIds: z.array(z.uuid()),
  actionIds: z.array(z.uuid()),
}) satisfies z.ZodType<ReferralSources>;

const evidencePreviewItemSchema = z.object({
  kind: manifestKindSchema,
  reference: z.string(),
}) satisfies z.ZodType<EvidencePreviewItem>;

/** review.yaml `Referral`. */
export const referralSchema = z.object({
  id: z.uuid(),
  caseId: z.uuid().nullable().meta({
    description: 'The case it was proposed from (or whose clarification went unanswered)',
  }),
  cycleYear: z.int().meta({
    description: "The cycle it is about (the case's, or the later missed biennial cycle's)",
  }),
  grounds: referralGroundsSchema,
  proposerKind: proposerKindSchema,
  proposer: assigneeSchema.nullable(),
  proposedAt: z.iso.datetime(),
  status: referralStatusSchema,
  approver: assigneeSchema.nullable(),
  approvedAt: z.iso.datetime().nullable(),
  declinedBy: assigneeSchema.nullable(),
  declinedAt: z.iso.datetime().nullable(),
  declineNote: z.string().nullable(),
  reference: z.string().nullable().meta({ description: 'RFL-<ISSUER>-<YEAR>-<seq>-<check>' }),
  sources: sourcesSchema,
  narrative: z.string(),
  package: z
    .object({
      documentId: z.uuid(),
      verificationId: z.string(),
      manifest: z.array(manifestItemSchema),
    })
    .nullable(),
  sentAt: z.iso.datetime().nullable(),
  icmsCaseNumber: z.string().nullable().meta({
    description:
      "ICMS's case number once EACC registered the sent referral there (`referral.icms-registered.v1`, spec 09); null until then",
  }),
  icmsRegisteredAt: z.iso
    .datetime()
    .nullable()
    .meta({ description: 'When ICMS registered it; null until then' }),
  declarantName: z.string(),
  personnelFileNumber: z.string(),
  evidence: z.array(evidencePreviewItemSchema).optional().meta({
    description:
      '`getReferral` only: what the package includes, by reference (attachments are listed in the manifest once it is assembled)',
  }),
});
export type ReferralView = z.infer<typeof referralSchema>;

/**
 * review.yaml `ReferralIcmsPayload`: what ICMS needs of a sent referral (spec 09 BE-5) and no
 * more, in the names of the package's cover sheet (`ReferralPackagePayload`). The evidence stays
 * in the Confidential package EACC downloads.
 */
export const referralIcmsPayloadSchema = z
  .object({
    reference: z.string().meta({ description: 'RFL-<ISSUER>-<YEAR>-<seq>-<check>' }),
    grounds: referralGroundsSchema,
    groundsLabel: z.string(),
    commission: z.object({ name: z.string(), issuerCode: z.string() }),
    declarant: z.object({
      name: z.string(),
      nationalId: z
        .string()
        .meta({ description: "From the directory's roster record of the referral's case" }),
    }),
    narrative: z.string(),
  })
  .meta({
    description:
      "What ICMS needs of a sent referral (spec 09 BE-5): its reference, grounds, Commission and narrative, and the declarant's name and national ID. Personal data: the caller passes it to ICMS and keeps it nowhere.",
  });
export type ReferralIcmsPayload = z.infer<typeof referralIcmsPayloadSchema>;

/**
 * review.yaml `ReferralPackagePayload`: what `referral-package.v1` renders. A cover sheet (the
 * reference, grounds, Commission, declarant, narrative, proposer and approver) with the manifest,
 * then the evidence it lists. Letters are the documents service's own documents, named by id.
 */
export const referralPackagePayloadSchema = z.object({
  declarantPersonId: z.uuid().meta({
    description:
      'The officer referred, who must never download the package: the documents service keeps it from them (an EACC officer is referred by EACC as their Commission). Not printed',
  }),
  reference: z.string(),
  grounds: referralGroundsSchema,
  groundsLabel: z.string(),
  cycleYear: z.int(),
  commission: z.object({ name: z.string(), issuerCode: z.string() }),
  declarant: z.object({ name: z.string(), personnelFileNumber: z.string() }),
  narrative: z.string(),
  proposedBy: z.string(),
  proposedAt: z.iso.datetime(),
  approvedBy: z.string(),
  approvedAt: z.iso.datetime(),
  manifest: z.array(manifestItemSchema),
  versions: z.array(
    z.object({
      reference: z.string(),
      version: z.int(),
      type: declarationTypeSchema,
      statementDate: z.iso.date(),
      submittedAt: z.iso.datetime(),
      late: z.boolean(),
      document: z
        .record(z.string(), z.unknown())
        .meta({ description: 'The declaration.v1 document as submitted' }),
    }),
  ),
  flags: z.array(z.record(z.string(), z.unknown())),
  clarifications: z.array(z.record(z.string(), z.unknown())),
  obligations: z.array(
    z.object({
      cycleKey: z.string(),
      type: z.string(),
      status: z.string(),
      dueDate: z.iso.date(),
      filedAt: z.iso.datetime().nullable(),
    }),
  ),
  letters: z.array(z.object({ reference: z.string(), documentId: z.uuid() })),
});
export type ReferralPackagePayload = z.infer<typeof referralPackagePayloadSchema>;

export function referralView(row: ReferralRow, evidence?: EvidencePreviewItem[]): ReferralView {
  return {
    id: row.id,
    caseId: row.caseId,
    cycleYear: row.cycleYear,
    grounds: row.grounds,
    proposerKind: row.proposerKind,
    proposer: officer(row.proposer, row.proposerName),
    proposedAt: row.proposedAt.toISOString(),
    status: row.status,
    approver: officer(row.approver, row.approverName),
    approvedAt: row.approvedAt?.toISOString() ?? null,
    declinedBy: officer(row.declinedBy, row.declinedByName),
    declinedAt: row.declinedAt?.toISOString() ?? null,
    declineNote: row.declineNote,
    reference: row.reference,
    sources: row.sources,
    narrative: row.narrative,
    package:
      row.packageDocumentId !== null &&
      row.packageVerificationId !== null &&
      row.packageManifest !== null
        ? {
            documentId: row.packageDocumentId,
            verificationId: row.packageVerificationId,
            manifest: row.packageManifest,
          }
        : null,
    sentAt: row.sentAt?.toISOString() ?? null,
    icmsCaseNumber: row.icmsCaseNumber,
    icmsRegisteredAt: row.icmsRegisteredAt?.toISOString() ?? null,
    declarantName: row.declarantName,
    personnelFileNumber: row.personnelFileNumber,
    ...(evidence === undefined ? {} : { evidence }),
  };
}

/** How the console and the package's cover sheet name each ground (FE label table). */
export const GROUNDS_LABELS: Record<ReferralGrounds, string> = {
  'undeclared-assets': 'Undeclared assets',
  'unexplained-assets': 'Unexplained assets',
  'two-missed-cycles': 'Two consecutive declarations not filed',
  'unanswered-clarification': 'Clarification not answered',
};
