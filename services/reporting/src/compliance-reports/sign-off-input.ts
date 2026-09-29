import { z } from 'zod';

/**
 * Bodies of the Form M review and sign-off endpoints (reporting.yaml), validated at the edge with
 * the limits `form-m.v1` sets on the fields they fill.
 */

/** `updateReportRemarks`: remarks by obligation id; blank returns the row to its default. */
export const remarksBody = z.object({
  remarks: z
    .array(z.object({ obligationId: z.uuid(), remark: z.string().max(500) }).strict())
    .min(1)
    .max(1_000),
});
export type RemarksBody = z.infer<typeof remarksBody>;

const complaint = z
  .object({
    name: z.string().max(200),
    designation: z.string().max(100),
    identifier: z.string().max(100),
    nature: z.string().max(300),
    status: z.string().max(100),
  })
  .strict();

/** `updateReportManualFields` (reporting.yaml `ManualFields`): each field given replaces the draft's. */
export const manualFieldsBody = z
  .object({
    contactDetails: z.string().max(200).nullable().optional(),
    physicalAddress: z.string().max(200).nullable().optional(),
    emailAddress: z.email().max(254).nullable().optional(),
    complaintsRegisterMaintained: z.boolean().nullable().optional(),
    complaints: z.array(complaint).max(500).optional(),
  })
  .strict();
export type ManualFieldsBody = z.infer<typeof manualFieldsBody>;

/** `markReportReviewed`: the supervisor's designation for Part III "Compiled by". */
export const reviewedBody = z.object({ designation: z.string().trim().min(1).max(100) }).strict();
export type ReviewedBody = z.infer<typeof reviewedBody>;

/** `confirmComplianceReport`: the commission-admin's designation for Part III "Confirmed by". */
export const confirmBody = z
  .object({ designation: z.string().trim().min(1).max(100).optional() })
  .strict()
  .default({});
export type ConfirmBody = z.infer<typeof confirmBody>;
