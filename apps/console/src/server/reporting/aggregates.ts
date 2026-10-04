import { z } from 'zod';

/**
 * The national report's `aggregates` as the reporting service builds them
 * (`services/reporting/src/national-reports/aggregates.ts`): reporting.yaml leaves the object
 * open, so the console reads it with this schema and the types follow from it.
 */

const sectionAggregateSchema = z.object({
  expected: z.number(),
  declared: z.number(),
  notDeclared: z.number(),
  /** Declared over expected; null when nobody was expected. */
  rate: z.number().nullable(),
});

const accessAggregateSchema = z.object({
  received: z.number(),
  granted: z.number(),
  declined: z.number(),
});

/** A Commission's row: its report's status and, once it reported, its numbers. */
const commissionAggregateSchema = z.object({
  name: z.string(),
  status: z.enum(['not-reported', 'submitted-on-time', 'submitted-late']),
  reportId: z.string().nullable(),
  reference: z.string().nullable(),
  submittedAt: z.string().nullable(),
  initial: sectionAggregateSchema.nullable(),
  biennial: sectionAggregateSchema.extend({ noCycleInPeriod: z.boolean() }).nullable(),
  final: sectionAggregateSchema.nullable(),
  clarifications: z.number().nullable(),
  accessRequests: accessAggregateSchema.nullable(),
});

export const nationalAggregatesSchema = z.object({
  fy: z.number(),
  reporting: z.object({
    commissions: z.number(),
    reported: z.number(),
    onTime: z.number(),
    late: z.number(),
    notReported: z.number(),
    rate: z.number().nullable(),
  }),
  national: z.object({
    initial: sectionAggregateSchema,
    biennial: sectionAggregateSchema,
    final: sectionAggregateSchema,
    all: sectionAggregateSchema,
    clarifications: z.number(),
    accessRequests: accessAggregateSchema,
  }),
  byCommission: z.record(z.string(), commissionAggregateSchema),
});

export type SectionAggregate = z.infer<typeof sectionAggregateSchema>;
export type AccessAggregate = z.infer<typeof accessAggregateSchema>;
export type CommissionAggregate = z.infer<typeof commissionAggregateSchema>;
export type NationalAggregates = z.infer<typeof nationalAggregatesSchema>;
