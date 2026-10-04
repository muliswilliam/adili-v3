import { between, eq } from 'drizzle-orm';

import { config } from '../config.js';
import type { ReportingTransaction } from '../compliance-reports/reports.js';
import { notFound, problem } from '../problems.js';
import {
  type CandidateThresholds,
  historyYears,
  type PatternCandidate,
  patternCandidates,
} from './candidates.js';
import type { Paragraph } from './narrative.js';
import { type NarrativeFigures, narrativeFigures } from './narrative-input.js';
import {
  type NarrativeDraftRow,
  type NationalReportRow,
  type NationalReportView,
  nationalReportView,
  paragraphOf,
} from './representation.js';
import {
  nationalReportAggregates,
  nationalReportNarrativeDrafts,
  nationalReportParagraphs,
  nationalReports,
} from './schema.js';

/**
 * The national consolidated report's rows as its services read and write them, in the caller's
 * transaction (EACC's row-level security tenant): the year's report, locked or not, its
 * paragraphs and narrative draft, its next version, its view, and the figures and pattern
 * candidates a narrative is written from. HTTP problems for a report that is not built (404) or
 * no longer changes (409 `ncr-approved`).
 */

/** The configured thresholds of the pattern candidates. */
export const CANDIDATE_THRESHOLDS: CandidateThresholds = {
  minPoints: config.CANDIDATE_MIN_POINTS,
  rateChangeFactor: config.CANDIDATE_RATE_CHANGE_FACTOR,
  maxNonFilerRate: config.CANDIDATE_MAX_NON_FILER_RATE,
  chronicLateYears: config.CANDIDATE_CHRONIC_LATE_YEARS,
  clarificationRatioFactor: config.CANDIDATE_CLARIFICATION_RATIO_FACTOR,
  sizeBands: config.CANDIDATE_SIZE_BANDS,
  sizeBandFactor: config.CANDIDATE_SIZE_BAND_FACTOR,
};

const NOT_BUILT = 'The national consolidated report for the year has not been built yet.';

/** The year's report; 404 for none. */
export async function reportOf(tx: ReportingTransaction, fy: number): Promise<NationalReportRow> {
  const [report] = await tx.select().from(nationalReports).where(eq(nationalReports.fy, fy));
  if (!report) throw notFound(NOT_BUILT);
  return report;
}

/** The year's report locked against concurrent changes; 404 for none. */
export async function lockedReport(
  tx: ReportingTransaction,
  fy: number,
): Promise<NationalReportRow> {
  const [report] = await tx
    .select()
    .from(nationalReports)
    .where(eq(nationalReports.fy, fy))
    .for('update');
  if (!report) throw notFound(NOT_BUILT);
  return report;
}

/**
 * The year's report, not approved yet, locked for a change: 404 for none, 409 `ncr-approved`
 * once approved.
 */
export async function lockedUnapprovedReport(
  tx: ReportingTransaction,
  fy: number,
): Promise<NationalReportRow> {
  const report = await lockedReport(tx, fy);
  if (report.status === 'approved') throw approvedConflict();
  return report;
}

export function approvedConflict() {
  return problem('ncr-approved', 'The report is approved and can no longer change.');
}

/** The report's latest narrative draft, if any. */
export async function draftOf(
  tx: ReportingTransaction,
  nationalReportId: string,
): Promise<NarrativeDraftRow | undefined> {
  const [draft] = await tx
    .select()
    .from(nationalReportNarrativeDrafts)
    .where(eq(nationalReportNarrativeDrafts.nationalReportId, nationalReportId));
  return draft;
}

/** The report's paragraphs as stored. */
export async function paragraphsOf(
  tx: ReportingTransaction,
  nationalReportId: string,
): Promise<Paragraph[]> {
  const rows = await tx
    .select()
    .from(nationalReportParagraphs)
    .where(eq(nationalReportParagraphs.nationalReportId, nationalReportId));
  return rows.map(paragraphOf);
}

/** The report as reporting.yaml `NationalReport` gives it. */
export async function reportView(
  tx: ReportingTransaction,
  report: NationalReportRow,
): Promise<NationalReportView> {
  const [aggregates] = await tx
    .select()
    .from(nationalReportAggregates)
    .where(eq(nationalReportAggregates.nationalReportId, report.id));
  const paragraphs = await paragraphsOf(tx, report.id);
  const draft = await draftOf(tx, report.id);
  return nationalReportView(report, aggregates, paragraphs, draft);
}

/** The next version of the report, with `subject` among its contributors. */
export async function touch(
  tx: ReportingTransaction,
  report: NationalReportRow,
  subject: string,
): Promise<NationalReportRow> {
  const contributors = report.contributors.includes(subject)
    ? report.contributors
    : [...report.contributors, subject];
  const [updated] = await tx
    .update(nationalReports)
    .set({ version: report.version + 1, contributors })
    .where(eq(nationalReports.id, report.id))
    .returning();
  if (!updated) throw new Error(`National report ${report.id} vanished while it was saved`);
  return updated;
}

/**
 * Stores the narrative's paragraphs as `saved`: unchanged paragraphs are left alone (their editor
 * and time kept), changed and new ones written by `subject`, and those no longer there removed.
 */
export async function replaceParagraphs(
  tx: ReportingTransaction,
  nationalReportId: string,
  stored: readonly Paragraph[],
  saved: readonly Paragraph[],
  subject: string,
): Promise<void> {
  const before = new Map(stored.map((paragraph) => [paragraph.id, paragraph]));
  const kept = new Set(saved.map((paragraph) => paragraph.id));
  for (const paragraph of stored) {
    if (kept.has(paragraph.id)) continue;
    await tx.delete(nationalReportParagraphs).where(eq(nationalReportParagraphs.id, paragraph.id));
  }
  for (const paragraph of saved) {
    const previous = before.get(paragraph.id);
    if (previous && sameParagraph(previous, paragraph)) continue;
    const values = {
      section: paragraph.section,
      position: paragraph.position,
      text: paragraph.text,
      aiDraft: paragraph.aiDraft,
      aggregateRefs: paragraph.aggregateRefs,
      candidateIds: paragraph.candidateIds,
    };
    // A paragraph only moved keeps its editor; a new or edited one is the caller's.
    const updatedBy = previous?.text === paragraph.text ? undefined : subject;
    await tx
      .insert(nationalReportParagraphs)
      .values({ id: paragraph.id, nationalReportId, ...values, updatedBy: updatedBy ?? subject })
      .onConflictDoUpdate({
        target: nationalReportParagraphs.id,
        set: updatedBy === undefined ? values : { ...values, updatedBy },
      });
  }
}

/**
 * The year's figures in the ai-gateway's shape, with the prior years the candidates look back
 * on, and its pattern candidates: what a narrative draft is written from, as at the build of
 * `builtAt`. 404 until built.
 */
export async function narrativeInputOf(
  tx: ReportingTransaction,
  fy: number,
): Promise<{ figures: NarrativeFigures; candidates: PatternCandidate[]; builtAt: Date }> {
  const rows = await tx
    .select({
      fy: nationalReportAggregates.fy,
      builtAt: nationalReportAggregates.builtAt,
      aggregates: nationalReportAggregates.aggregates,
    })
    .from(nationalReportAggregates)
    .where(between(nationalReportAggregates.fy, fy - historyYears(CANDIDATE_THRESHOLDS), fy));
  const current = rows.find((row) => row.fy === fy);
  if (!current) throw notFound(NOT_BUILT);
  const figures = narrativeFigures(
    current.aggregates,
    rows.filter((row) => row.fy !== fy).map((row) => row.aggregates),
  );
  return {
    figures,
    candidates: patternCandidates(figures, CANDIDATE_THRESHOLDS),
    builtAt: current.builtAt,
  };
}

function sameParagraph(a: Paragraph, b: Paragraph): boolean {
  return a.section === b.section && a.position === b.position && a.text === b.text;
}
