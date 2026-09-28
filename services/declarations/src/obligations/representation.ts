import { z } from 'zod';

import {
  CANCEL_REASON_VALUES,
  OBLIGATION_STATUS_VALUES,
  OBLIGATION_TYPE_VALUES,
  REMINDER_CHANNEL_VALUES,
  REMINDER_OUTCOME_VALUES,
} from './schema.js';

/**
 * Response bodies of the obligations API (spec 04). They are the contract: the OpenAPI document,
 * packages/schemas/internal/declarations.yaml, is generated from them (`pnpm contracts`).
 */

export const obligationTypeSchema = z.enum(OBLIGATION_TYPE_VALUES);

export const obligationStatusSchema = z.enum(OBLIGATION_STATUS_VALUES);

export const cancelReasonSchema = z.enum(CANCEL_REASON_VALUES);

export const reminderOutcomeSchema = z.enum(REMINDER_OUTCOME_VALUES);

export const reminderChannelSchema = z.enum(REMINDER_CHANNEL_VALUES);

export const commissionRefSchema = z.object({
  slug: z.string(),
  issuerCode: z.string(),
  name: z.string(),
});
export type CommissionRef = z.infer<typeof commissionRefSchema>;

export const obligationSchema = z.object({
  id: z.uuid(),
  commission: commissionRefSchema,
  type: obligationTypeSchema,
  cycleKey: z.string().meta({
    description: 'Unique per declarant among live obligations',
    examples: ['biennial:2027', 'initial:2027-03-10', 'final:2027-09-15'],
  }),
  statementDate: z.iso.date().meta({ description: 'The date the declaration is made as at' }),
  dueDate: z.iso.date(),
  status: obligationStatusSchema,
  cancelReason: cancelReasonSchema.nullable().meta({ description: 'Set when cancelled' }),
  remindersSent: z.int().meta({ description: 'Reminders sent so far' }),
  policyVersion: z
    .int()
    .meta({ description: "The Commission's policy version the obligation was created under" }),
  createdAt: z.iso.datetime(),
});
export type Obligation = z.infer<typeof obligationSchema>;

export const reminderSchema = z.object({
  offsetDays: z.int().meta({ description: 'Days before the due date' }),
  scheduledAt: z.iso.datetime(),
  sentAt: z.iso.datetime().nullable().meta({ description: 'Null unless sent' }),
  channels: z.array(reminderChannelSchema).meta({ description: 'The channels it went by' }),
  outcome: reminderOutcomeSchema,
});
export type Reminder = z.infer<typeof reminderSchema>;

export const declarantRefSchema = z.object({
  rosterRecordId: z.uuid(),
  personnelFileNumber: z.string(),
  fullName: z.string(),
  onboarded: z.boolean(),
  ofr: z.string().nullable(),
});
export type DeclarantRef = z.infer<typeof declarantRefSchema>;

export const obligationDetailSchema = obligationSchema.extend({
  reminders: z.array(reminderSchema).meta({ description: 'Reminder history, by scheduled time' }),
  declarant: declarantRefSchema
    .nullable()
    .meta({ description: "Present for staff callers; null for the declarant's own view" }),
});
export type ObligationDetail = z.infer<typeof obligationDetailSchema>;

export const myObligationsSchema = z.object({
  groups: z
    .array(
      z.object({
        commission: commissionRefSchema,
        obligations: z
          .array(obligationSchema)
          .meta({ description: 'Overdue first, then by due date; cancelled ones left out' }),
      }),
    )
    .meta({ description: 'One group per Commission, by name' }),
});
export type MyObligations = z.infer<typeof myObligationsSchema>;

export const obligationListItemSchema = obligationSchema.extend({
  declarant: declarantRefSchema,
  lastReminder: reminderSchema.nullable().meta({
    description: "The obligation's latest reminder (by scheduled time); null before any",
  }),
});
export type ObligationListItem = z.infer<typeof obligationListItemSchema>;

export const obligationPageSchema = z.object({
  items: z.array(obligationListItemSchema),
  nextCursor: z
    .string()
    .nullable()
    .meta({ description: 'Pass as `cursor` for the next page; null on the last' }),
});
export type ObligationPage = z.infer<typeof obligationPageSchema>;

/** Obligations by status; cancelled ones are never counted. */
export const statusCountsSchema = z.object({
  upcoming: z.int(),
  due: z.int(),
  overdue: z.int(),
  filed: z.int(),
});
export type StatusCounts = z.infer<typeof statusCountsSchema>;

/** A biennial cycle with its dates under a policy, and whether it has opened. */
export const summaryCycleSchema = z.object({
  key: z.string().meta({ examples: ['biennial:2027'] }),
  statementDate: z.iso.date(),
  dueDate: z.iso.date(),
  opensOn: z.iso.date().meta({
    description:
      "The day the cycle's biennial obligations are created: the statement date less the calendar's opening lead",
  }),
  opened: z.boolean().meta({
    description:
      'Whether the cycle has opened: its opening day has come (Africa/Nairobi), or its biennials were already created',
  }),
});
export type SummaryCycle = z.infer<typeof summaryCycleSchema>;

export const commissionSummarySchema = z.object({
  commission: commissionRefSchema,
  cycle: summaryCycleSchema.meta({
    description:
      'The cycle counted: the one asked for, or the current one (the latest opened, or the first while none has)',
  }),
  cycles: z.array(summaryCycleSchema).meta({
    description: "Every cycle of the calendar under the Commission's policy, oldest first",
  }),
  total: statusCountsSchema,
  byType: z.object({
    initial: statusCountsSchema,
    biennial: statusCountsSchema,
    final: statusCountsSchema,
  }),
  notOnboarded: z.object({ due: z.int(), overdue: z.int() }).meta({
    description:
      'Declarants with a due or overdue obligation who have not onboarded, each counted once under their worst status',
  }),
});
export type CommissionSummary = z.infer<typeof commissionSummarySchema>;

export const nationalSummarySchema = z.object({
  cycle: summaryCycleSchema.meta({
    description:
      'The cycle counted, under the statutory dates: the one asked for, or the current one',
  }),
  commissions: z
    .array(
      z.object({
        commission: commissionRefSchema,
        total: statusCountsSchema,
        notOnboarded: z.int().meta({
          description: 'Declarants with a due or overdue obligation who have not onboarded',
        }),
        lastRosterImportAt: z.iso.datetime().nullable().meta({
          description: "When the Commission's latest roster import completed; null before any",
        }),
      }),
    )
    .meta({ description: 'Every Commission the service has had a roster event for, by name' }),
  totals: statusCountsSchema,
});
export type NationalSummary = z.infer<typeof nationalSummarySchema>;
