import { z } from 'zod';

/**
 * Shapes of a Commission's policy versions (spec 04). They are the contract: the OpenAPI document
 * is generated from them.
 */

const monthDaySchema = z.string().regex(/^\d{2}-\d{2}$/);

export const tenantPolicyVersionSchema = z.object({
  id: z.uuid(),
  version: z
    .int()
    .meta({ description: '1 when the Commission is provisioned, then one per change' }),
  effectiveFrom: z.iso.datetime().meta({ description: 'In force from its creation' }),
  obligationsStartDate: z.iso.date().meta({
    description:
      "Obligations of every type (initial, biennial, final) are created only for statement dates on or after this date; earlier ones are assumed declared outside Adili. Version 1's is the date the Commission was created (Africa/Nairobi).",
  }),
  initialDueAfterAppointmentDays: z.int().meta({
    description: 'Initial declaration due this many days after appointment (Act s.34(1))',
  }),
  biennial: z
    .object({
      statementDate: monthDaySchema.meta({ description: 'Month-day', examples: ['11-01'] }),
      dueDate: monthDaySchema.meta({ description: 'Month-day', examples: ['12-31'] }),
    })
    .meta({ description: 'Biennial declaration statement and due dates (Act s.34(2))' }),
  finalDueAfterExitDays: z.int().meta({
    description: 'Final declaration due this many days after leaving office (Act s.34(3))',
  }),
  reminderOffsetsDays: z.array(z.int()).meta({
    description: 'Reminders go this many days before a due date',
    examples: [[30, 14, 7]],
  }),
  clarification: z.object({ issueWindowMonths: z.int(), replyWindowDays: z.int() }).meta({
    description: "Clarification issue window and the declarant's reply window (Act s.35)",
  }),
  formMDue: monthDaySchema.meta({
    description: 'Form M compliance report due, month-day (Regs r.25(2))',
    examples: ['07-31'],
  }),
  createdBy: z.string().meta({ description: '`sub` of who created the version' }),
  createdByName: z
    .string()
    .nullable()
    .meta({ description: 'Their display name at the time; null when unknown' }),
  createdAt: z.iso.datetime(),
});
export type TenantPolicyVersion = z.infer<typeof tenantPolicyVersionSchema>;

export const tenantPolicyHistorySchema = z.object({
  current: tenantPolicyVersionSchema.meta({ description: 'The version in force' }),
  previous: z
    .array(tenantPolicyVersionSchema)
    .meta({ description: 'Earlier versions, newest first' }),
});
export type TenantPolicyHistory = z.infer<typeof tenantPolicyHistorySchema>;

/** Body of `POST /v1/commissions/{slug}/policy/versions` (`CreateTenantPolicyVersion`). */
export const createTenantPolicyVersionBody = z.strictObject({
  obligationsStartDate: z.iso.date().meta({
    description:
      'Obligations of every type are created only for statement dates on or after this date (appointments, biennial statement dates and exits). Earlier ones are assumed declared outside Adili.',
  }),
});
export type CreateTenantPolicyVersionBody = z.infer<typeof createTenantPolicyVersionBody>;
