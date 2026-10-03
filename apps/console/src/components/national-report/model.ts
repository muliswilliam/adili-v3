import {
  NATIONAL_REPORT_NARRATIVE_SECTIONS,
  narrativeSections,
  type NarrativeValue,
} from '@adili/ui';
import { EACC_SUPERVISOR } from '@adili/roles';
import { z } from 'zod';

import {
  NARRATIVE_SECTION_IDS,
  type Narrative,
  type NarrativeParagraph,
  type NationalReport,
} from '../../server/reporting/types';

/** The first financial year reports exist for (reporting.yaml `FinancialYear` minimum). */
export const FIRST_REPORT_YEAR = 2025;

/** Nairobi is UTC+3 all year. */
const NAIROBI_OFFSET_MS = 3 * 60 * 60 * 1000;

/** The financial year (1 July to 30 June, by its start year) `now` falls in, in Nairobi. */
export function financialYearAt(now: Date): number {
  const nairobi = new Date(now.getTime() + NAIROBI_OFFSET_MS);
  const year = nairobi.getUTCFullYear();
  return nairobi.getUTCMonth() >= 6 ? year : year - 1;
}

/** Every financial year from the first to the current one, latest first. */
export function reportYears(now: Date): number[] {
  const current = Math.max(FIRST_REPORT_YEAR, financialYearAt(now));
  return Array.from({ length: current - FIRST_REPORT_YEAR + 1 }, (_, i) => current - i);
}

/**
 * The year the page opens on: the one before the current year, whose Form M reports fall due on
 * 31 July and which the national report consolidates.
 */
export function defaultReportYear(now: Date): number {
  return Math.max(FIRST_REPORT_YEAR, financialYearAt(now) - 1);
}

/** "2025/2026". */
export function fyLabel(fy: number): string {
  return `${String(fy)}/${String(fy + 1)}`;
}

/** The date Form M for the year is due at EACC (Regs r.25(2)). */
export function dueDateOf(fy: number): string {
  return `${String(fy + 1)}-07-31`;
}

/** reporting.yaml `FinancialYear`: a start year reports exist for. */
export const financialYearSchema = z.number().int().min(FIRST_REPORT_YEAR).max(2100);

/** The page's address: the year shown and the page of the per-Commission table. */
export const ncrSearchSchema = z.object({
  fy: financialYearSchema.optional().catch(undefined),
  page: z.number().int().min(1).optional().catch(undefined),
});

export type NcrSearch = z.infer<typeof ncrSearchSchema>;

export type NarrativeEditorValue = NarrativeValue<NarrativeParagraph>;

/** The editor's value: each section's paragraphs, in position order. */
export function editorValueOf(paragraphs: readonly NarrativeParagraph[]): NarrativeEditorValue {
  return Object.fromEntries(
    NARRATIVE_SECTION_IDS.map((section) => [
      section,
      paragraphs
        .filter((paragraph) => paragraph.section === section)
        .sort((a, b) => a.position - b.position),
    ]),
  );
}

/** What the contract saves: each section's paragraphs joined by a blank line. */
export function narrativeTextOf(value: NarrativeEditorValue): Narrative {
  return narrativeSections(value, NATIONAL_REPORT_NARRATIVE_SECTIONS);
}

export interface NcrViewer {
  subject: string;
  roles: readonly string[];
}

/**
 * Whether the viewer may approve the draft: an EACC supervisor who is not its author. The service
 * also refuses a supervisor who rebuilt it or saved its narrative (`separation-of-duties`), which
 * the report does not say; the approve dialog shows that refusal.
 */
export type Approval = 'approved' | 'can-approve' | 'author' | 'not-supervisor';

export function approvalOf(
  report: Pick<NationalReport, 'status' | 'author'>,
  viewer: NcrViewer,
): Approval {
  if (report.status === 'approved') return 'approved';
  if (!viewer.roles.includes(EACC_SUPERVISOR)) return 'not-supervisor';
  if (report.author?.subject === viewer.subject) return 'author';
  return 'can-approve';
}

/** Reports received since the draft was built, which a rebuild takes in. */
export function newReportsSince(page: {
  reported: number;
  report: Pick<NationalReport, 'status' | 'reportsIncluded'>;
}): number {
  if (page.report.status === 'approved') return 0;
  return Math.max(0, page.reported - page.report.reportsIncluded);
}
