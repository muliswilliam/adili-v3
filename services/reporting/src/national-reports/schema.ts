import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import type { NationalAggregates } from './aggregates.js';

/**
 * EACC's national consolidated report (NCR, spec 09): one per financial year, built by an EACC
 * analyst from the Commissions' submitted reports and approved by an EACC supervisor who wrote no
 * part of it. Three tables, so later slices extend one without rewriting another:
 *
 * - `national_reports`: the report's identity, status, version, people and reference;
 * - `national_report_aggregates`: the numbers as at the latest build (counts and rates only),
 *   which the pattern candidates and open-data releases of spec 09b read by year;
 * - `national_report_paragraphs`: the narrative as paragraphs per section, which the analyst
 *   types here and spec 09b's AI draft inserts (`aiDraft`, `aggregateRefs`, `candidateIds`).
 *
 * EACC data, not a Commission's: row-level security admits `app.tenant` `eacc` and `platform`.
 */

const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/** reporting.yaml `NationalReport.status`. */
export type NationalReportStatus = 'draft' | 'approved';

/** The narrative's sections, in the order the report prints them. */
export const NARRATIVE_SECTIONS = ['overview', 'findings', 'recommendations'] as const;
export type NarrativeSection = (typeof NARRATIVE_SECTIONS)[number];

export const nationalReports = pgTable(
  'national_reports',
  {
    id: uuid().primaryKey(),
    /** Financial year start year: 2027 is 1 July 2027 to 30 June 2028. */
    fy: integer().notNull(),
    status: text().$type<NationalReportStatus>().notNull(),
    /** Goes up by one with every change (build, narrative, approval): the report's revision. */
    version: integer().notNull(),
    /** Who first built the report. */
    authorSubject: text().notNull(),
    authorName: text().notNull(),
    /**
     * Everyone who built the report or wrote its narrative (subjects), the author included: none
     * of them may approve it.
     */
    contributors: jsonb().$type<string[]>().notNull(),
    approverSubject: text(),
    approverName: text(),
    /** `NCR-EACC-<FY end>-<seq>-<check>`, allocated at approval. */
    reference: text(),
    /** The Restricted NCR PDF, once the approval workflow issued it. */
    documentId: uuid(),
    approvedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (table) => [uniqueIndex('national_reports_fy_key').on(table.fy)],
);

/**
 * The national consolidated report's numbers as at its latest build: aggregates over the
 * Commissions' submitted reports (national totals per section, a row per Commission, rates) and
 * the reports they cover. Counts, rates, Commission slugs and names only; rebuilt in place while
 * the report is a draft, frozen once approved.
 */
export const nationalReportAggregates = pgTable('national_report_aggregates', {
  nationalReportId: uuid()
    .primaryKey()
    .references(() => nationalReports.id, { onDelete: 'cascade' }),
  fy: integer().notNull(),
  builtAt: timestamp({ withTimezone: true }).notNull(),
  /** How many submitted reports the aggregates cover. */
  reportsIncluded: integer().notNull(),
  /** The submitted reports the aggregates cover, by id. */
  reportIds: jsonb().$type<string[]>().notNull(),
  aggregates: jsonb().$type<NationalAggregates>().notNull(),
});

/**
 * The narrative, paragraph by paragraph. A paragraph keeps its id while its text stays; editing
 * it clears `aiDraft` (spec 09b labels AI-drafted paragraphs until an analyst edits them).
 * `aggregateRefs` are aggregate keys in the ai-gateway scheme (`national.<name>`,
 * `commission.<code>.<name>`, prefixed `fy<fy>.` for a prior year), not dot paths into the
 * aggregates; building those keys from the aggregates is #326 and #334's work. `candidateIds` are
 * spec 09b's pattern candidates. Both are empty for what an analyst types.
 */
export const nationalReportParagraphs = pgTable(
  'national_report_paragraphs',
  {
    id: uuid().primaryKey(),
    nationalReportId: uuid()
      .notNull()
      .references(() => nationalReports.id, { onDelete: 'cascade' }),
    section: text().$type<NarrativeSection>().notNull(),
    /** Order within the section, from 0. */
    position: integer().notNull(),
    text: text().notNull(),
    aiDraft: boolean().notNull().default(false),
    aggregateRefs: jsonb().$type<string[]>().notNull().default([]),
    candidateIds: jsonb().$type<string[]>().notNull().default([]),
    updatedBy: text().notNull(),
    ...timestamps,
  },
  (table) => [
    index('national_report_paragraphs_report_idx').on(
      table.nationalReportId,
      table.section,
      table.position,
    ),
  ],
);

export const nationalReportsSchema = {
  nationalReports,
  nationalReportAggregates,
  nationalReportParagraphs,
};
