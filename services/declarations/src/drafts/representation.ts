import { z } from 'zod';

import { commissionRefSchema, obligationTypeSchema } from '../obligations/representation.js';
import { acknowledgementStatusSchema } from '../submission/acknowledgement-status.js';
import { declarationReferenceSchema } from '../submission/reference.js';
import {
  DECLARATION_STATUS_VALUES,
  INCOME_PERIOD_SOURCE_VALUES,
  SCHEMA_VERSION,
  SECTION_COMPLETENESS_VALUES,
} from './schema.js';
import type { SubmitProblemCode } from '../submission/representation.js';
import { SECTION_KEY } from './sections.js';

/**
 * Bodies of the declaration drafts API (spec 05). They are the contract: the OpenAPI document,
 * packages/schemas/internal/declarations.yaml, is generated from them (`pnpm contracts`).
 */

export const sectionKeySchema = z
  .string()
  .regex(SECTION_KEY)
  .meta({ description: 'bio, household, other, or statement:<personKey>' });

export const completenessSchema = z.enum(SECTION_COMPLETENESS_VALUES);

export const declarationStatusSchema = z.enum(DECLARATION_STATUS_VALUES);

export const declarationSchema = z.object({
  id: z.uuid(),
  obligationId: z.uuid(),
  commission: commissionRefSchema,
  type: obligationTypeSchema,
  statementDate: z.iso.date(),
  dueDate: z.iso.date().meta({
    description: "The obligation's due date: filed after it is late, and amendments close on it",
  }),
  incomePeriod: z.object({
    from: z.iso.date().meta({ description: 'Exclusive: the income period is (from, to]' }),
    to: z.iso.date(),
    fromSource: z.enum(INCOME_PERIOD_SOURCE_VALUES).meta({
      description:
        '`declared`: from is the statement date of a declaration on Adili; `assumed`: there is none, so it was derived from the type',
    }),
  }),
  status: declarationStatusSchema,
  schemaVersion: z.literal(SCHEMA_VERSION),
  draftVersion: z
    .int()
    .meta({ description: 'Also the ETag; send it as If-Match on section saves' }),
  sections: z
    .array(
      z.object({
        key: sectionKeySchema,
        completeness: completenessSchema,
        updatedAt: z.iso
          .datetime()
          .nullable()
          .meta({ description: 'Null until the declarant first saves the section' }),
        personName: z
          .string()
          .nullable()
          .meta({ description: 'Whose financial statement it is, for statement sections' }),
        counts: z
          .record(z.string(), z.int())
          .optional()
          .meta({ description: 'Items by category, e.g. income, assets, liabilities' }),
      }),
    )
    .meta({
      description:
        'Sections in First Schedule order; archived statements listed with completeness archived',
    }),
  lastSection: sectionKeySchema.nullable(),
  reference: declarationReferenceSchema
    .nullable()
    .meta({ description: 'Allocated at the first submission; null before' }),
  currentVersion: z
    .int()
    .min(1)
    .nullable()
    .meta({ description: 'The submitted version in force; null before the first submission' }),
  amendingFromVersion: z.int().min(1).nullable().meta({
    description: 'The version an amendment in progress started from; null unless amending',
  }),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Declaration = z.infer<typeof declarationSchema>;

export const sectionContentsSchema = z.record(z.string(), z.unknown()).meta({
  description:
    'The section body; shape per key follows forms/declaration.v1.json: bio → officer, household → { spouses, children }, statement:* → Statement, other → otherInformation',
});

export const completenessIssueSchema = z.object({
  sectionKey: sectionKeySchema,
  path: z.string().meta({ description: 'JSON pointer within the section contents' }),
  code: z.string(),
  message: z.string(),
});
export type CompletenessIssue = z.infer<typeof completenessIssueSchema>;

export const notIncludedSchema = z
  .array(
    z.object({
      personKey: z.string().regex(/^child:[0-9a-f-]{36}$/),
      reason: z.enum(['over-18-at-statement-date']),
    }),
  )
  .meta({
    description:
      'Household only: children listed who get no financial statement, with the reason (eighteen or older on the statement date)',
  });

export const sectionEnvelopeSchema = z.object({
  key: sectionKeySchema,
  completeness: completenessSchema,
  contents: sectionContentsSchema,
  issues: z.array(completenessIssueSchema),
  notIncluded: notIncludedSchema.optional(),
  draftVersion: z.int(),
});
export type SectionEnvelope = z.infer<typeof sectionEnvelopeSchema>;

export const sectionSaveResultSchema = z.object({
  key: sectionKeySchema,
  completeness: completenessSchema,
  draftVersion: z.int(),
  issues: z.array(completenessIssueSchema),
  notIncluded: notIncludedSchema.optional(),
  sectionsChanged: z
    .array(
      z.object({
        key: sectionKeySchema,
        action: z.enum(['created', 'archived', 'restored']),
      }),
    )
    .meta({
      description:
        'Statement sections created, archived or restored by a household save; an archived statement is kept until the draft is discarded',
    }),
});
export type SectionSaveResult = z.infer<typeof sectionSaveResultSchema>;

export const attachmentLinkSchema = z.object({
  sectionKey: sectionKeySchema.meta({ description: 'The statement section holding the item' }),
  itemId: z.uuid(),
  uploadId: z.uuid().meta({
    description: 'A clean upload of the Commission with purpose declaration-attachment',
  }),
});
export type AttachmentLink = z.infer<typeof attachmentLinkSchema>;

export const declarationAttachmentSchema = z.object({
  id: z.uuid(),
  sectionKey: sectionKeySchema,
  itemId: z.uuid(),
  uploadId: z.uuid(),
  fileName: z.string(),
  sha256: z.string().meta({ description: 'Hex SHA-256 of the clean object' }),
  size: z.int().meta({ description: 'Bytes' }),
  linkedAt: z.iso.datetime(),
});
export type DeclarationAttachment = z.infer<typeof declarationAttachmentSchema>;

/**
 * Why the declaration cannot be submitted now, as submitting would answer: the problem code of
 * the refusal (`incomplete` when the document does not validate).
 */
export const CANNOT_SUBMIT_REASON_VALUES = [
  'not-a-draft',
  'obligation-cancelled',
  'before-statement-date',
  'amendment-window-closed',
  'incomplete',
] as const satisfies readonly SubmitProblemCode[];
export type CannotSubmitReason = (typeof CANNOT_SUBMIT_REASON_VALUES)[number];

export const declarationSummarySchema = z.object({
  declaration: declarationSchema,
  document: z.record(z.string(), z.unknown()).meta({
    description:
      'The declaration.v1 document assembled from the live sections (decrypted for the declarant): archived statements left out, paragraph 9 material changes composed from the flagged items and the marital-status change',
  }),
  valid: z.boolean().meta({
    description:
      'The document validates against declaration.v1 and every live section has been saved at least once',
  }),
  blocking: z.array(completenessIssueSchema).meta({
    description:
      'What to complete before submitting, by section and field: the schema issues and the rules it cannot state, each once',
  }),
  canSubmit: z.boolean().meta({
    description:
      'Whether submitting now would pass every check but the step-up: a valid document, a draft or amendment in progress, and an obligation open for it',
  }),
  cannotSubmitReason: z.enum(CANNOT_SUBMIT_REASON_VALUES).nullable().meta({
    description:
      'Null when canSubmit; else the first reason in this order: `not-a-draft` (already submitted), `obligation-cancelled`, `before-statement-date` (the statement date, Africa/Nairobi, has not come), `amendment-window-closed` (an amendment after the due date), `incomplete` (see blocking)',
  }),
  late: z.boolean().meta({
    description:
      'Submitting now would be recorded as filed late: today (Africa/Nairobi) is after the due date',
  }),
  attestationText: z.string().meta({ description: 'The solemn declaration the declarant makes' }),
});
export type DeclarationSummary = z.infer<typeof declarationSummarySchema>;

export const declarationListItemSchema = z.object({
  id: z.uuid(),
  obligationId: z.uuid(),
  commission: commissionRefSchema,
  type: obligationTypeSchema,
  statementDate: z.iso.date(),
  status: declarationStatusSchema,
  completenessPercent: z.int().min(0).max(100).meta({
    description:
      'Complete sections out of the live ones (archived statements left out), rounded down',
  }),
  dueDate: z.iso.date().meta({
    description: "The obligation's due date: filed after it is late, and amendments close on it",
  }),
  reference: declarationReferenceSchema
    .nullable()
    .meta({ description: 'Allocated at the first submission; null before' }),
  currentVersion: z
    .int()
    .min(1)
    .nullable()
    .meta({ description: 'The submitted version in force; null before the first submission' }),
  amendingFromVersion: z.int().min(1).nullable().meta({
    description: 'The version an amendment in progress started from; null unless amending',
  }),
  submittedAt: z.iso
    .datetime()
    .nullable()
    .meta({ description: 'When the version in force was submitted; null before' }),
  late: z
    .boolean()
    .nullable()
    .meta({ description: 'The version in force was filed after the due date; null before' }),
  amendable: z.boolean().meta({
    description:
      'Amend is open now: submitted (no amendment in progress) and today, Africa/Nairobi by the service clock, is on or before the due date. False otherwise; when submitted and false, amendments are closed',
  }),
  acknowledgement: z
    .object({
      status: acknowledgementStatusSchema,
      documentId: z
        .uuid()
        .nullable()
        .meta({ description: 'The issued slip, for its download; null until issued' }),
      verifiedCount: z.int().meta({ description: 'Lookups of the slip on the verify app' }),
    })
    .nullable()
    .meta({
      description:
        "The version in force's acknowledgement slip (as getAcknowledgement answers it); null before the first submission",
    }),
  updatedAt: z.iso.datetime(),
});
export type DeclarationListItem = z.infer<typeof declarationListItemSchema>;
