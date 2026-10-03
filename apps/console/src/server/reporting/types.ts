import type { IntakeStatus } from '@adili/ui';

import type { components } from './api.gen';

type Schemas = components['schemas'];

export type Officer = Schemas['Officer'];
export type Narrative = Schemas['Narrative'];
export type NarrativeParagraph = Schemas['NarrativeParagraph'];
export type NarrativeSectionId = NarrativeParagraph['section'];
export type Intake = Schemas['Intake'];

/** The narrative's sections in the order the report has them. */
export const NARRATIVE_SECTION_IDS = [
  'overview',
  'findings',
  'recommendations',
] as const satisfies readonly NarrativeSectionId[];

/** A Form M section's counts in the national report, with its declared rate (null: none expected). */
export interface SectionAggregate {
  expected: number;
  declared: number;
  notDeclared: number;
  rate: number | null;
}

export interface AccessAggregate {
  received: number;
  granted: number;
  declined: number;
}

/** A Commission's row: its report's status and, once it reported, its numbers. */
export interface CommissionAggregate {
  name: string;
  status: IntakeStatus;
  reportId: string | null;
  reference: string | null;
  submittedAt: string | null;
  initial: SectionAggregate | null;
  biennial: (SectionAggregate & { noCycleInPeriod: boolean }) | null;
  final: SectionAggregate | null;
  clarifications: number | null;
  accessRequests: AccessAggregate | null;
}

/**
 * The national report's `aggregates` as the reporting service builds them
 * (`services/reporting/src/national-reports/aggregates.ts`): reporting.yaml leaves the object
 * open, so the console reads it with `nationalAggregatesSchema` (`../national-report.server`).
 */
export interface NationalAggregates {
  fy: number;
  reporting: {
    commissions: number;
    reported: number;
    onTime: number;
    late: number;
    notReported: number;
    rate: number | null;
  };
  national: {
    initial: SectionAggregate;
    biennial: SectionAggregate;
    final: SectionAggregate;
    all: SectionAggregate;
    clarifications: number;
    accessRequests: AccessAggregate;
  };
  byCommission: Record<string, CommissionAggregate>;
}

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
