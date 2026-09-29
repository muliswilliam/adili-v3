import type { NationalAggregates } from './aggregates.js';
import { type Narrative, narrativeOf, type Paragraph } from './narrative.js';
import type {
  nationalReportAggregates,
  nationalReportParagraphs,
  nationalReports,
  NationalReportStatus,
} from './schema.js';

export type NationalReportRow = typeof nationalReports.$inferSelect;
export type AggregatesRow = typeof nationalReportAggregates.$inferSelect;
export type ParagraphRow = typeof nationalReportParagraphs.$inferSelect;

/** reporting.yaml `Officer`. */
interface OfficerView {
  subject: string;
  name: string;
}

/** reporting.yaml `NationalReport`. */
export interface NationalReportView {
  id: string;
  fy: number;
  version: number;
  status: NationalReportStatus;
  builtAt: string | null;
  reportsIncluded: number;
  aggregates: NationalAggregates | Record<string, never>;
  narrative: Narrative;
  narrativeParagraphs: Paragraph[];
  author: OfficerView | null;
  approver: OfficerView | null;
  approvedAt: string | null;
  reference: string | null;
  documentId: string | null;
}

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
    author: { subject: report.authorSubject, name: report.authorName },
    approver:
      report.approverSubject === null
        ? null
        : { subject: report.approverSubject, name: report.approverName ?? report.approverSubject },
    approvedAt: report.approvedAt?.toISOString() ?? null,
    reference: report.reference,
    documentId: report.documentId,
  };
}

const SECTION_ORDER = { overview: 0, findings: 1, recommendations: 2 } as const;

function sectionOrder(paragraph: Paragraph): number {
  return SECTION_ORDER[paragraph.section];
}
