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
export type Intake = Schemas['Intake'];

/** The kit's national report sections and limits are the contract's (`Narrative`). */
export type NarrativeMatchesContract = Assert<MatchesNarrativeSections<Narrative>>;

/** The narrative's sections in the order the report has them. */
export const NARRATIVE_SECTION_IDS = [
  'overview',
  'findings',
  'recommendations',
] as const satisfies readonly NarrativeSectionId[];

/** reporting.yaml `NationalReport`, with its aggregates read. */
export type NationalReport = Omit<Schemas['NationalReport'], 'aggregates'> & {
  aggregates: NationalAggregates;
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

/** reporting.yaml `PatternCandidate`: a notable pattern the service computed for the year. */
export type PatternCandidate = Schemas['PatternCandidate'];
