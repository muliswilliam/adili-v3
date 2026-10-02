import { DECLARATION_TYPES } from '@adili/forms';
import { z } from 'zod';

import type { PersonVersion } from '../declarations/declarations-client.js';
import type { CertifiedCopyRow } from './certified-copy-issuance.js';
import { certifiedCopySchema, toCertifiedCopy } from './representation.js';
import {
  DELIVERY_METHODS,
  SELF_ACCESS_STATUSES,
  type SelfAccessStatus,
  type selfAccessApplications,
} from './schema.js';

/**
 * What the access officer works with recording a declarant's written self-access application
 * (spec 10, Administrative Mechanism 32): the declarant found on the roster, the versions a
 * certified copy can be of, the application, and its copy until collected or dispatched.
 */

export type SelfAccessApplicationRow = typeof selfAccessApplications.$inferSelect;

/** access.yaml `DeclarantVersion`: a submitted version of the declarant a copy can be of. */
export const declarantVersionSchema = z.object({
  declarationId: z.uuid(),
  version: z.int().min(1),
  reference: z.string().meta({ description: "The declaration's reference (ADR-011)" }),
  type: z.enum(DECLARATION_TYPES),
  statementDate: z.iso.date(),
  submittedAt: z.iso.datetime({ offset: true }),
  superseded: z.boolean().meta({ description: 'A later version of the declaration replaced it' }),
});

export type DeclarantVersion = z.infer<typeof declarantVersionSchema>;

/** access.yaml `DeclarantVersions`: a roster record's declarant and their submitted versions. */
export const declarantVersionsSchema = z.object({
  declarant: z.object({
    rosterRecordId: z.uuid(),
    personnelFileNumber: z.string(),
    fullName: z.string(),
    /** The officer has a declarant account; without one there are no versions to copy. */
    onboarded: z.boolean(),
  }),
  versions: z
    .array(declarantVersionSchema)
    .meta({ description: 'Latest submitted first; empty for a declarant with none here' }),
});

export type DeclarantVersions = z.infer<typeof declarantVersionsSchema>;

export function toDeclarantVersion(version: PersonVersion): DeclarantVersion {
  return {
    declarationId: version.declarationId,
    version: version.version,
    reference: version.reference,
    type: version.type,
    statementDate: version.statementDate,
    submittedAt: version.submittedAt,
    superseded: version.superseded,
  };
}

/** The upload ids of a representative's proofs; clean uploads of purpose `access-representation`. */
const representativeInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(200).meta({ description: 'As on their ID' }),
  idNumber: z
    .string()
    .trim()
    .min(1)
    .max(50)
    .meta({ description: 'National ID or passport number; stored encrypted' }),
  authorityUploadId: z.uuid().meta({
    description:
      "The written authority to act for the declarant: the caller's clean upload of purpose `access-representation`",
  }),
  idUploadId: z.uuid().meta({
    description:
      "A copy of the representative's ID: the caller's clean upload of purpose `access-representation`",
  }),
});

/** Body of `recordSelfAccessApplication` (access.yaml `SelfAccessApplicationInput`). */
export const selfAccessApplicationInputSchema = z
  .strictObject({
    rosterRecordId: z.uuid().meta({
      description: "The declarant's roster record at the Commission (an onboarded one)",
    }),
    declarationId: z.uuid(),
    version: z.int().min(1).meta({ description: 'The submitted version the copy is of' }),
    identityNote: z.string().trim().min(1).max(1000).meta({
      description:
        "What the access officer checked of the applicant's identity (the declarant's, or the representative's and their authority); no document numbers",
    }),
    representative: representativeInputSchema.nullable().meta({
      description: "Who applied on the declarant's behalf; null when the declarant applied",
    }),
    deliveryMethod: z.enum(DELIVERY_METHODS).meta({
      description: 'Whether the copy is to be collected at the Commission or dispatched',
    }),
  })
  .refine(
    (input) =>
      input.representative === null ||
      input.representative.authorityUploadId !== input.representative.idUploadId,
    {
      path: ['representative', 'idUploadId'],
      message: 'must be another upload than the authority',
    },
  );

export type SelfAccessApplicationInput = z.infer<typeof selfAccessApplicationInputSchema>;

/** Query of `listSelfAccessApplications`. */
export const selfAccessListQuery = z.object({
  status: z
    .enum(SELF_ACCESS_STATUSES)
    .optional()
    .meta({ description: 'Only applications in this status' }),
  cursor: z
    .string()
    .max(500)
    .optional()
    .meta({ description: '`nextCursor` of the previous page; omit for the first page' }),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type SelfAccessListQuery = z.infer<typeof selfAccessListQuery>;

const uploadRefSchema = z.object({ uploadId: z.uuid(), fileName: z.string() });

/** A representative as the application lists them; the ID number only in the officer's detail. */
const representativeSchema = z.object({
  name: z.string(),
  authority: uploadRefSchema,
  identification: uploadRefSchema,
});

/** access.yaml `SelfAccessApplication`: an application in the Commission's list. */
export const selfAccessApplicationSchema = z.object({
  id: z.uuid(),
  status: z.enum(SELF_ACCESS_STATUSES),
  declarant: z.object({
    rosterRecordId: z.uuid(),
    fullName: z.string(),
    personnelFileNumber: z.string(),
  }),
  declarationId: z.uuid(),
  version: z.int().min(1),
  declarationReference: z.string(),
  identityNote: z.string(),
  representative: representativeSchema
    .nullable()
    .meta({ description: 'Null when the declarant applied in person' }),
  deliveryMethod: z.enum(DELIVERY_METHODS),
  receivedAt: z.iso.datetime({ offset: true }),
  deadlineAt: z.iso.datetime({ offset: true }).meta({
    description: 'Receipt + 14 days: when the certified copy is due',
  }),
  late: z.boolean().meta({
    description: 'The certified copy was not issued by the deadline (now, or when it was issued)',
  }),
  deliveredAt: z.iso
    .datetime({ offset: true })
    .nullable()
    .meta({ description: 'When it was marked collected or dispatched' }),
  recordedBy: z.string().meta({ description: 'The access officer who recorded it' }),
  certifiedCopy: certifiedCopySchema,
});

export type SelfAccessApplication = z.infer<typeof selfAccessApplicationSchema>;

/** access.yaml `SelfAccessApplicationDetail`: one application, with the representative's ID number. */
export const selfAccessApplicationDetailSchema = selfAccessApplicationSchema.extend({
  representative: representativeSchema
    .extend({ idNumber: z.string() })
    .nullable()
    .meta({ description: 'Null when the declarant applied in person' }),
  recordedByCaller: z.boolean().meta({
    description:
      'The caller recorded the application. Documents names that officer on the issued copy, so they (and no other officer) may download it with `certifiedCopy.documentId` to print it for collection or dispatch',
  }),
});

export type SelfAccessApplicationDetail = z.infer<typeof selfAccessApplicationDetailSchema>;

export const selfAccessPageSchema = z.object({
  items: z.array(selfAccessApplicationSchema),
  nextCursor: z
    .string()
    .nullable()
    .meta({ description: 'Pass as `cursor` for the next page; null on the last page' }),
});

export type SelfAccessPage = z.infer<typeof selfAccessPageSchema>;

/** Not issued by the deadline: by now while pending (or failed), or when it was issued. */
export function isLate(deadlineAt: Date, copy: CertifiedCopyRow, now: Date): boolean {
  return (copy.issuedAt ?? now).getTime() > deadlineAt.getTime();
}

export function toSelfAccessApplication(
  row: SelfAccessApplicationRow,
  copy: CertifiedCopyRow,
  now: Date,
): SelfAccessApplication {
  const { representative } = row;
  return {
    id: row.id,
    status: row.status satisfies SelfAccessStatus,
    declarant: {
      rosterRecordId: row.rosterRecordId,
      fullName: row.declarantName,
      personnelFileNumber: row.personnelFileNumber,
    },
    declarationId: row.declarationId,
    version: row.version,
    declarationReference: row.declarationReference,
    identityNote: row.identityNote,
    representative:
      representative === null
        ? null
        : {
            name: representative.name,
            authority: {
              uploadId: representative.authorityUploadId,
              fileName: representative.authorityFileName,
            },
            identification: {
              uploadId: representative.idUploadId,
              fileName: representative.idFileName,
            },
          },
    deliveryMethod: row.deliveryMethod,
    receivedAt: row.receivedAt.toISOString(),
    deadlineAt: row.deadlineAt.toISOString(),
    late: isLate(row.deadlineAt, copy, now),
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    recordedBy: row.recordedByName,
    certifiedCopy: toCertifiedCopy(copy),
  };
}

export function toSelfAccessApplicationDetail(
  row: SelfAccessApplicationRow,
  copy: CertifiedCopyRow,
  representativeIdNumber: string | null,
  callerSubject: string,
  now: Date,
): SelfAccessApplicationDetail {
  const application = toSelfAccessApplication(row, copy, now);
  return {
    ...application,
    representative:
      application.representative === null
        ? null
        : { ...application.representative, idNumber: representativeIdNumber ?? '' },
    recordedByCaller: row.recordedBy === callerSubject,
  };
}
