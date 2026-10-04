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
import type { DraftFailureReason } from './narrative-draft.js';

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

/** reporting.yaml `draftNationalReportNarrative` `section`: one section, or the whole narrative. */
export const DRAFT_SCOPES = [...NARRATIVE_SECTIONS, 'all'] as const;
export type DraftScope = (typeof DRAFT_SCOPES)[number];

/** reporting.yaml `NarrativeDraft.jobs[]`: an ai-gateway job and the section(s) it drafts. */
export interface DraftJob {
  section: DraftScope;
  jobId: string;
}

/** reporting.yaml `NarrativeDraft.status`. */
export const NARRATIVE_DRAFT_STATUSES = ['drafting', 'inserted', 'failed'] as const;
export type NarrativeDraftStatus = (typeof NARRATIVE_DRAFT_STATUSES)[number];

/**
 * The report's latest AI narrative draft (spec 09b): the ai-gateway job writing it and what to do
 * with its paragraphs once it ends, so a draft not ready within the request's wait is completed
 * when the report is read again. One per report; a new draft request replaces it, and the job of
 * a replaced draft is never inserted. `aggregatesBuiltAt` is the build the task input came from:
 * a draft that ends after a rebuild is discarded (`aggregates-rebuilt`), as its figures are old.
 * No text or figures: the paragraphs go into `national_report_paragraphs` once inserted.
 */
export const nationalReportNarrativeDrafts = pgTable('national_report_narrative_drafts', {
  nationalReportId: uuid()
    .primaryKey()
    .references(() => nationalReports.id, { onDelete: 'cascade' }),
  /**
   * The ai-gateway jobs writing it, each with the section it drafts: one, or for `all` in a year
   * with no pattern candidates, the overview's and the recommendations' (the task drafts findings
   * only from a candidate).
   */
  jobs: jsonb().$type<DraftJob[]>().notNull(),
  section: text().$type<DraftScope>().notNull(),
  /** Replace every paragraph of the section(s), not only those still AI drafts. */
  replaceAll: boolean().notNull(),
  status: text().$type<NarrativeDraftStatus>().notNull(),
  /** Why a failed draft was discarded: the gateway's job reason, or the service's own. */
  failureReason: text().$type<DraftFailureReason>(),
  aggregatesBuiltAt: timestamp({ withTimezone: true }).notNull(),
  /** Who asked for the draft: the paragraphs are theirs, and they become a contributor. */
  requestedBy: text().notNull(),
  requestedAt: timestamp({ withTimezone: true }).notNull(),
  finishedAt: timestamp({ withTimezone: true }),
});

export const nationalReportsSchema = {
  nationalReports,
  nationalReportAggregates,
  nationalReportParagraphs,
  nationalReportNarrativeDrafts,
};
