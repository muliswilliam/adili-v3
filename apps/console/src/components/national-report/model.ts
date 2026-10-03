import {
  NATIONAL_REPORT_NARRATIVE_SECTIONS,
  narrativeSections,
  type NarrativeValue,
} from '@adili/ui';
import { EACC_SUPERVISOR } from '@adili/roles';
import { z } from 'zod';

import { FIRST_FINANCIAL_YEAR } from '../form-m/financial-year';
import {
  NARRATIVE_SECTION_IDS,
  type Narrative,
  type NarrativeParagraph,
  type NationalReport,
} from '../../server/reporting/types';

/** "2025/2026", as the national report's copy says it. */
export function fyLabel(fy: number): string {
  return `${String(fy)}/${String(fy + 1)}`;
}

/** The page's address: the year shown (else the last that ended) and the per-Commission page. */
export const ncrSearchSchema = z.object({
  // As `financialYear` (server/form-m), which a browser module cannot import.
  fy: z.int().min(FIRST_FINANCIAL_YEAR).max(9999).optional().catch(undefined),
  page: z.int().min(1).optional().catch(undefined),
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
 * the report does not say (#558); the approve dialog shows that refusal.
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

/** What a panel inserting a paragraph gives: its text and what it cites. */
export type NewParagraph = Pick<NarrativeParagraph, 'text'> &
  Partial<Pick<NarrativeParagraph, 'aiDraft' | 'aggregateRefs' | 'candidateIds'>>;

/**
 * The narrative with `paragraph` added at the end of `section` (empty fields dropped first), e.g.
 * #331's "Cite in findings". Pass it to the extension context's `editNarrative`.
 */
export function appendParagraph(
  value: NarrativeEditorValue,
  section: NarrativeParagraph['section'],
  paragraph: NewParagraph,
): NarrativeEditorValue {
  const kept = (value[section] ?? []).filter((each) => each.text.trim() !== '');
  return {
    ...value,
    [section]: [
      ...kept,
      {
        id: crypto.randomUUID(),
        section,
        position: kept.length,
        aiDraft: false,
        aggregateRefs: [],
        candidateIds: [],
        ...paragraph,
      },
    ],
  };
}
