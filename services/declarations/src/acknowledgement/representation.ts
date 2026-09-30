import { z } from 'zod';

import { obligationTypeSchema } from '../obligations/representation.js';
import { declarationReferenceSchema } from '../submission/reference.js';

/**
 * Bodies of the acknowledgement API (spec 06). They are the contract: the OpenAPI document,
 * packages/schemas/internal/declarations.yaml, is generated from them (`pnpm contracts`).
 */

/**
 * What the acknowledgement slip prints of a submitted version, exactly the fields of the
 * documents service's `acknowledgement-slip` v1 payload (`AcknowledgementSlipPayload` in
 * documents.yaml) and nothing more: no contents, amounts or contacts.
 */
export const acknowledgementSlipSchema = z
  .object({
    declarantName: z
      .string()
      .min(1)
      .max(200)
      .meta({ description: 'As declared in the version (first, other and surname)' }),
    commissionName: z.string().min(1).max(200),
    issuerCode: z
      .string()
      .regex(/^[A-Z0-9]{2,20}$/)
      .meta({ description: "The Commission's issuer code, as in the reference number" }),
    declarationType: obligationTypeSchema,
    statementDate: z.iso.date(),
    dueDate: z.iso
      .date()
      .nullable()
      .meta({ description: "The filing obligation's due date; null when it has none" }),
    reference: declarationReferenceSchema,
    version: z.int().min(1),
    submittedAt: z.iso.datetime(),
    late: z.boolean().meta({ description: "Submitted after the obligation's due date" }),
    statementCount: z
      .int()
      .min(0)
      .meta({ description: 'Statements in the version: the declarant, spouses and children' }),
    itemCount: z
      .int()
      .min(0)
      .meta({ description: 'Income, assets and liabilities across its statements' }),
  })
  .meta({ description: 'The fields the acknowledgement slip prints, and nothing more' });
export type AcknowledgementSlip = z.infer<typeof acknowledgementSlipSchema>;

export const acknowledgementPayloadSchema = z.object({
  declarantPersonId: z.uuid().meta({
    description:
      'The declarant: the documents service issues the slip for them, the only person who may download it',
  }),
  slip: acknowledgementSlipSchema,
});
export type AcknowledgementPayload = z.infer<typeof acknowledgementPayloadSchema>;
