import type { FormMV1 } from '@adili/forms';
import type { Assert, MatchesNarrativeSections } from '@adili/ui';

import type { NationalAggregates } from './aggregates';
import type { components } from './api.gen';

export type {
  AccessAggregate,
  CommissionAggregate,
  NationalAggregates,
  SectionAggregate,
} from './aggregates';

type Schemas = components['schemas'];

export type ReportStatus = Schemas['ReportStatus'];
export type ReportCounts = Schemas['ReportCounts'];
/** reporting.yaml `ComplianceReportSummary`: one financial year of the period selector. */
export type ReportPeriod = Schemas['ComplianceReportSummary'];
export type Officer = Schemas['Officer'];
export type Narrative = Schemas['Narrative'];
export type NarrativeParagraph = Schemas['NarrativeParagraph'];
export type NarrativeSectionId = NarrativeParagraph['section'];

/** The kit's national report sections and limits are the contract's (`Narrative`). */
export type NarrativeMatchesContract = Assert<MatchesNarrativeSections<Narrative>>;

/** The narrative's sections in the order the report has them. */
export const NARRATIVE_SECTION_IDS = [
  'overview',
  'findings',
  'recommendations',
] as const satisfies readonly NarrativeSectionId[];

/** reporting.yaml `NarrativeDraft`: the latest AI narrative draft of a report (spec 09b). */
export type NarrativeDraft = Schemas['NarrativeDraft'];
/** What a narrative draft is asked for: one section or `all`. */
export type NarrativeDraftSection = NarrativeDraft['section'];

/** What a narrative draft may be asked for: each section, or `all`. */
export const NARRATIVE_DRAFT_SECTIONS = [
  ...NARRATIVE_SECTION_IDS,
  'all',
] as const satisfies readonly NarrativeDraftSection[];

/** The sections a draft of `section` writes. */
export function sectionsDrafted(section: NarrativeDraftSection): readonly NarrativeSectionId[] {
  return section === 'all' ? NARRATIVE_SECTION_IDS : [section];
}

/**
 * reporting.yaml `NationalReport`, with its aggregates read. `narrativeDraft` is spec 09b's
 * (#338): the service's contract gains it with #491, so until then it may be missing, read as null.
 */
export type NationalReport = Omit<Schemas['NationalReport'], 'aggregates'> & {
  aggregates: NationalAggregates;
  narrativeDraft?: NarrativeDraft | null;
};

/**
 * reporting.yaml `ComplianceReport`, with its document typed as the form-m.v1 document it is (the
 * contract names only its parts: a draft need not be complete against the schema yet).
 */
export type ComplianceReport = Omit<Schemas['ComplianceReport'], 'document'> & {
  document: FormMV1 | null;
};

/** The reporting service's problem details, with the registered `code` the console acts on. */
export interface ReportingProblem {
  type: string;
  title: string;
  status: number;
  detail?: string;
  /** A `PROBLEM_CODES` code (api-kit), e.g. `preview-not-available`, `report-submitted` or `separation-of-duties`. */
  code?: Schemas['ProblemDetails']['code'];
}

/** reporting.yaml `Intake`: every Commission's report status for a financial year (EACC). */
export type Intake = Schemas['Intake'];
/** One Commission on the intake. */
export type IntakeRow = Intake['commissions'][number];
export type IntakeStatus = Schemas['IntakeStatus'];
export type IntakeOutlier = IntakeRow['outliers'][number];
export type ReportSource = Schemas['ReportSource'];

/**
 * reporting.yaml `SubmittedComplianceReport` (the report viewer), with its document typed as the
 * frozen form-m.v1 it is.
 */
export type SubmittedReport = Omit<Schemas['SubmittedComplianceReport'], 'document'> & {
  document: FormMV1;
};

/** reporting.yaml `PatternCandidate`: a notable pattern the service computed for the year. */
export type PatternCandidate = Schemas['PatternCandidate'];
