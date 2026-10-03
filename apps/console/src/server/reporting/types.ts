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

/** The reporting service's problem details, with the registered `code` the console acts on. */
export interface ReportingProblem {
  type: string;
  title: string;
  status: number;
  detail?: string;
  /** `no-submitted-reports`, `ncr-approved`, `separation-of-duties`... */
  code?: string;
}
