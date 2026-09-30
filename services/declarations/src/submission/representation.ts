import { type ProblemCode, problemDetailsSchema } from '@adili/api-kit';
import { z } from 'zod';

import { completenessIssueSchema, declarationSchema } from '../drafts/representation.js';
import { obligationStatusSchema } from '../obligations/representation.js';
import { declarationVersionSchema } from '../declaration/representation.js';

/**
 * Bodies of the submission API (spec 06). They are the contract: the OpenAPI document,
 * packages/schemas/internal/declarations.yaml, is generated from them (`pnpm contracts`).
 */

export const submissionResultSchema = z.object({
  declaration: declarationSchema,
  version: declarationVersionSchema,
  obligationStatus: obligationStatusSchema,
});
export type SubmissionResult = z.infer<typeof submissionResultSchema>;

/** The problem codes the submission and amendment routes answer with. */
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
