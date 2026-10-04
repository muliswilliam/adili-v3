import { z } from 'zod';

import { intakeStatusSchema } from '../compliance-reports/intake.js';
import {
  accessRequestCountsSchema,
  countSchema as count,
} from '../compliance-reports/representation.js';
import { officerSchema, storedOfficer } from '../officer.js';
import { narrativeOf, narrativeSchema, type Paragraph, paragraphSchema } from './narrative.js';
import {
  DRAFT_SCOPES,
  NARRATIVE_DRAFT_STATUSES,
  NATIONAL_REPORT_STATUSES,
  type nationalReportAggregates,
  type nationalReportNarrativeDrafts,
  type nationalReportParagraphs,
  type nationalReports,
} from './schema.js';

export type NationalReportRow = typeof nationalReports.$inferSelect;
export type AggregatesRow = typeof nationalReportAggregates.$inferSelect;
export type ParagraphRow = typeof nationalReportParagraphs.$inferSelect;
export type NarrativeDraftRow = typeof nationalReportNarrativeDrafts.$inferSelect;

/** reporting.yaml `NarrativeDraft`: the report's latest AI narrative draft (spec 09b). */
export const narrativeDraftSchema = z.object({
  jobs: z
    .array(z.object({ section: z.enum(DRAFT_SCOPES), jobId: z.uuid() }))
    .min(1)
    .meta({
      description:
        "The ai-gateway jobs writing the draft, each with the section it asks for: one, or for `all` in a year with no pattern candidates, the overview's and the recommendations'",
    }),
  section: z.enum(DRAFT_SCOPES),
  replaceAll: z.boolean(),
  status: z.enum(NARRATIVE_DRAFT_STATUSES).meta({
    description:
      '`drafting` until the job ends; then its paragraphs are `inserted`, or the draft `failed` and nothing was inserted',
  }),
  failureReason: z.string().nullable().meta({
    description:
      "Why a failed draft was discarded: the ai-gateway job's reason (`validation`, `policy`, `budget`, `provider`, ...), or `missing` (the gateway no longer has the job), `invalid-output`, `aggregates-rebuilt` or `ncr-approved`",
  }),
  requestedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
});
export type NarrativeDraftView = z.infer<typeof narrativeDraftSchema>;

const rate = z.number().nullable();
const sectionAggregateSchema = z.object({
  expected: count,
  declared: count,
  notDeclared: count,
  rate: rate.meta({ description: 'declared / expected; null when none expected' }),
});

export const nationalAggregatesSchema = z
  .object({
    fy: z.number().int(),
    reporting: z.object({
      commissions: count,
      reported: count,
      onTime: count,
      late: count,
      notReported: count,
      rate: rate.meta({ description: 'Reported over Commissions; null when there are none' }),
    }),
    national: z.object({
      initial: sectionAggregateSchema,
      biennial: sectionAggregateSchema,
      final: sectionAggregateSchema,
      all: sectionAggregateSchema.meta({ description: 'The three sections together' }),
      clarifications: count,
      accessRequests: accessRequestCountsSchema,
    }),
    byCommission: z
      .record(
        z.string(),
        z.object({
          name: z.string(),
          status: intakeStatusSchema,
          reportId: z.uuid().nullable(),
          reference: z.string().nullable(),
          submittedAt: z.iso.datetime().nullable(),
          initial: sectionAggregateSchema.nullable(),
          biennial: sectionAggregateSchema.extend({ noCycleInPeriod: z.boolean() }).nullable(),
          final: sectionAggregateSchema.nullable(),
          clarifications: count.nullable(),
          accessRequests: accessRequestCountsSchema.nullable(),
        }),
      )
      .meta({ description: 'Per Commission slug; its numbers are null until it reports' }),
  })
  .meta({ description: 'Counts and rates only, never an officer' });

/** reporting.yaml `NationalReport`. */
export const nationalReportSchema = z.object({
  id: z.uuid(),
  fy: z.number().int(),
  version: z.number().int().min(1).meta({
    description: "The report's revision; goes up with every build, narrative save and the approval",
  }),
  status: z.enum(NATIONAL_REPORT_STATUSES),
  builtAt: z.iso.datetime().nullable(),
  reportsIncluded: count,
  aggregates: z
    .union([nationalAggregatesSchema, z.strictObject({})])
    .meta({ description: 'Empty until the first build' }),
  narrative: narrativeSchema,
  narrativeParagraphs: z.array(paragraphSchema).meta({
    description:
      'The paragraphs behind the narrative sections, per section in position order; AI drafts (spec 09b) labelled until edited',
  }),
  narrativeDraft: narrativeDraftSchema.nullable().meta({
    description: 'The latest AI narrative draft (spec 09b); null until one is asked for',
  }),
  author: officerSchema.nullable(),
  approver: officerSchema.nullable(),
  approvedAt: z.iso.datetime().nullable(),
  reference: z
    .string()
    .nullable()
    .meta({ description: '`NCR-EACC-<FY end>-<seq>-<check>`, allocated at approval' }),
  documentId: z.uuid().nullable().meta({ description: 'The Restricted NCR PDF, once issued' }),
});
export type NationalReportView = z.infer<typeof nationalReportSchema>;

/** A stored paragraph as the narrative module works with it. */
export function paragraphOf(row: ParagraphRow): Paragraph {
  return {
    id: row.id,
    section: row.section,
    position: row.position,
    text: row.text,
    aiDraft: row.aiDraft,
    aggregateRefs: row.aggregateRefs,
    candidateIds: row.candidateIds,
  };
}

/** The report as EACC's analysts and supervisors see it. */
export function nationalReportView(
  report: NationalReportRow,
  aggregates: AggregatesRow | undefined,
  paragraphs: readonly Paragraph[],
  draft: NarrativeDraftRow | undefined,
): NationalReportView {
  const ordered = [...paragraphs].sort(
    (a, b) => sectionOrder(a) - sectionOrder(b) || a.position - b.position,
  );
  return {
    id: report.id,
    fy: report.fy,
    version: report.version,
    status: report.status,
    builtAt: aggregates?.builtAt.toISOString() ?? null,
    reportsIncluded: aggregates?.reportsIncluded ?? 0,
    aggregates: aggregates?.aggregates ?? {},
    narrative: narrativeOf(ordered),
    narrativeParagraphs: ordered,
    narrativeDraft: draft ? narrativeDraftView(draft) : null,
    author: { subject: report.authorSubject, name: report.authorName },
    approver: storedOfficer(report.approverSubject, report.approverName),
    approvedAt: report.approvedAt?.toISOString() ?? null,
    reference: report.reference,
    documentId: report.documentId,
  };
}

function narrativeDraftView(draft: NarrativeDraftRow): NarrativeDraftView {
  return {
    jobs: draft.jobs.map((job) => ({ ...job })),
    section: draft.section,
    replaceAll: draft.replaceAll,
    status: draft.status,
    failureReason: draft.failureReason,
    requestedAt: draft.requestedAt.toISOString(),
    finishedAt: draft.finishedAt?.toISOString() ?? null,
  };
}

const SECTION_ORDER = { overview: 0, findings: 1, recommendations: 2 } as const;

function sectionOrder(paragraph: Paragraph): number {
  return SECTION_ORDER[paragraph.section];
}
