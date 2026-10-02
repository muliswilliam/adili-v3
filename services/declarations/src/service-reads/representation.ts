import { z } from 'zod';

import { declarationReferenceSchema } from '../declaration/reference.js';
import { obligationStatusSchema, obligationTypeSchema } from '../obligations/representation.js';

/**
 * What other services read of declarations through its internal API (ADR-013 §8.6, §8.7): the
 * review service a submitted version and the person's obligations (specs 07a, 08), the reporting
 * service the officers behind a Commission's obligations (spec 09).
 */

/** An attachment of a filed item: the upload and the item it supports. */
export const internalVersionAttachmentSchema = z.object({
  uploadId: z.uuid(),
  itemId: z.uuid(),
  personKey: z.string(),
  fileName: z.string(),
  sha256: z.string(),
});

/** A submitted version as filed, for the review service (`internalGetVersionDocument`). */
export const internalVersionDocumentSchema = z.object({
  declarationId: z.uuid(),
  versionId: z.uuid(),
  version: z.int(),
  personId: z.uuid().meta({
    description: 'The declarant; the review service looks up their previous version with it',
  }),
  rosterRecordId: z.uuid().meta({
    description: "The declarant's roster record at the Commission, as the declaration was started",
  }),
  reportingEntityId: z
    .uuid()
    .nullable()
    .meta({ description: "The roster record's reporting entity; null when it has none" }),
  reference: declarationReferenceSchema,
  type: obligationTypeSchema,
  statementDate: z.iso.date(),
  submittedAt: z.iso.datetime(),
  late: z.boolean(),
  dueDate: z.iso.date(),
  declarantName: z.string(),
  personnelFileNumber: z.string(),
  document: z
    .record(z.string(), z.unknown())
    .meta({ description: 'The immutable declaration.v1 document, decrypted' }),
  attachments: z.array(internalVersionAttachmentSchema),
});
export type InternalVersionDocument = z.infer<typeof internalVersionDocumentSchema>;

/** The person's latest earlier submitted version at the Commission (`internalFindPreviousVersion`). */
export const internalPreviousVersionSchema = z.object({
  declarationId: z.uuid(),
  versionId: z.uuid(),
  version: z.int(),
  statementDate: z.iso.date(),
  submittedAt: z.iso.datetime(),
});
export type InternalPreviousVersion = z.infer<typeof internalPreviousVersionSchema>;

/**
 * One of a person's submitted versions at the Commission, as the access officer chooses the
 * version a written self-access application asks a certified copy of (`internalListPersonVersions`,
 * spec 10). Identifiers, dates and the reference only: no content.
 */
export const internalPersonVersionSchema = z.object({
  declarationId: z.uuid(),
  version: z.int().min(1),
  reference: declarationReferenceSchema,
  type: obligationTypeSchema,
  statementDate: z.iso.date(),
  submittedAt: z.iso.datetime(),
  superseded: z.boolean().meta({ description: 'A later version of the declaration replaced it' }),
});
export type InternalPersonVersion = z.infer<typeof internalPersonVersionSchema>;

export const previousVersionQuery = z.object({
  personId: z.uuid(),
  beforeVersionId: z.uuid(),
});
export type PreviousVersionQuery = z.infer<typeof previousVersionQuery>;

/** One filing obligation, for the enforcement ladder (`internalGetObligation`). */
export const internalObligationSchema = z.object({
  obligationId: z.uuid(),
  rosterRecordId: z.uuid(),
  personId: z.uuid().nullable().meta({ description: 'Null until the declarant onboards' }),
  type: obligationTypeSchema,
  cycleKey: z.string(),
  dueDate: z.iso.date(),
  status: obligationStatusSchema,
  declarantName: z.string(),
  personnelFileNumber: z.string(),
});
export type InternalObligation = z.infer<typeof internalObligationSchema>;

/** One obligation of a person's history, for the referral sweep (`internalListPersonObligations`). */
export const internalPersonObligationSchema = z.object({
  obligationId: z.uuid(),
  type: obligationTypeSchema,
  cycleKey: z.string(),
  status: obligationStatusSchema,
  dueDate: z.iso.date(),
  filedAt: z.iso.datetime().nullable(),
  late: z.boolean(),
});
export type InternalPersonObligation = z.infer<typeof internalPersonObligationSchema>;

/** The most obligation ids one details request carries (reporting pages by it). */
export const OBLIGATION_DETAILS_PAGE = 1_000;

export const obligationDetailsRequest = z.object({
  obligationIds: z.array(z.uuid()).min(1).max(OBLIGATION_DETAILS_PAGE),
});
export type ObligationDetailsRequest = z.infer<typeof obligationDetailsRequest>;

/** The officer behind an obligation, as Form M names a non-filer (`internalObligationDetails`). */
export const internalOfficerDetailsSchema = z.object({
  obligationId: z.uuid(),
  name: z.string(),
  designation: z.string().meta({ description: 'Empty when the roster gives none' }),
  fileNumber: z.string().meta({
    description: 'Personnel file number, or another staff, ID or passport number',
  }),
  appointmentDate: z.iso.date().nullable(),
  exitDate: z.iso.date().nullable(),
});

export const internalObligationDetailsSchema = z.object({
  items: z.array(internalOfficerDetailsSchema),
});
export type InternalObligationDetails = z.infer<typeof internalObligationDetailsSchema>;
