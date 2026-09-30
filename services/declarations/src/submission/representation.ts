import { type ProblemCode, problemDetailsSchema } from '@adili/api-kit';
import { z } from 'zod';

import { completenessIssueSchema, declarationSchema } from '../drafts/representation.js';
import { obligationStatusSchema } from '../obligations/representation.js';
import { declarationReferenceSchema } from './reference.js';
import { ACKNOWLEDGEMENT_STATUS_VALUES } from './schema.js';

/**
 * Bodies of the submission API (spec 06). They are the contract: the OpenAPI document,
 * packages/schemas/internal/declarations.yaml, is generated from them (`pnpm contracts`).
 */

export const acknowledgementStatusSchema = z.enum(ACKNOWLEDGEMENT_STATUS_VALUES);

export const acknowledgementSchema = z.object({
  status: acknowledgementStatusSchema.meta({
    description:
      '`pending` until the documents service has issued the slip, `failed` when issuance gave up',
  }),
  documentId: z.uuid().nullable().meta({ description: 'The issued slip; null until issued' }),
  verificationId: z
    .string()
    .nullable()
    .meta({ description: 'Verification code printed under the QR; null until issued' }),
  issuedAt: z.iso.datetime().nullable(),
  verifiedCount: z.int().meta({ description: 'Lookups of the slip on the verify app' }),
  downloadUrl: z.url().nullable().meta({
    description: 'Short-lived presigned URL; fetched fresh on each call; null until issued',
  }),
});
export type Acknowledgement = z.infer<typeof acknowledgementSchema>;

export const declarationVersionSchema = z.object({
  version: z.int().min(1),
  reference: declarationReferenceSchema,
  submittedAt: z.iso.datetime(),
  late: z.boolean().meta({ description: "Submitted after the obligation's due date" }),
  canonicalSha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .meta({ description: "Hex SHA-256 of the document's RFC 8785 canonical JSON" }),
  supersededAt: z.iso
    .datetime()
    .nullable()
    .meta({ description: 'When a later version replaced it; null while in force' }),
  acknowledgement: acknowledgementSchema,
});
export type DeclarationVersion = z.infer<typeof declarationVersionSchema>;

export const submissionResultSchema = z.object({
  declaration: declarationSchema,
  version: declarationVersionSchema,
  obligationStatus: obligationStatusSchema,
});
export type SubmissionResult = z.infer<typeof submissionResultSchema>;

/** The problem codes the submission routes answer with (and amendment, in the next ticket). */
export const SUBMIT_PROBLEM_CODES = [
  'step-up-required',
  'incomplete',
  'before-statement-date',
  'amendment-window-closed',
  'not-a-draft',
  'not-submitted',
  'obligation-cancelled',
] as const satisfies readonly ProblemCode[];
export type SubmitProblemCode = (typeof SUBMIT_PROBLEM_CODES)[number];

export const submitProblemSchema = problemDetailsSchema.extend({
  code: z
    .enum(SUBMIT_PROBLEM_CODES)
    .optional()
    .meta({ description: 'Absent only for problems of the Idempotency-Key header' }),
  stepUpUrl: z.url().optional().meta({
    description: 'Present for step-up-required: starts a step-up returning to the summary',
  }),
  blocking: z
    .array(completenessIssueSchema)
    .optional()
    .meta({ description: 'Present for incomplete: what to complete, as the summary lists it' }),
});
