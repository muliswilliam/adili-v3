import { rateOf } from '../compliance-reports/intake.js';
import { referencePeriodOf } from '../financial-year.js';
import type { NationalAggregates, SectionAggregate } from './aggregates.js';

/**
 * The NCR aggregates as the ai-gateway's `narrate-compliance-report` task takes them (spec 09b):
 * a year's named national totals and rates and a row of named figures per Commission, for this
 * year and the prior years. Pattern candidates (`candidates.ts`) and the narrative task input are
 * both built from this, so every aggregate key a candidate cites names a figure the task is sent.
 *
 * Aggregate keys follow the gateway scheme: `national.<name>` for a total or rate,
 * `commission.<code>.<name>` for a Commission's figure, each prefixed `fy<fy>.` for a prior year.
 * The gateway's `fy` is the calendar year a financial year ends in (`referencePeriodOf`), so FY
 * 2027/2028 is sent as 2028 and its figures, cited from FY 2028/2029, read `fy2028.national...`.
 *
 * Access requests are left out: they are zeros until spec 10 projects them, and a narrative must
 * not state "no access requests" from a count that is not collected yet.
 */

/** National counts, by name. */
export const NATIONAL_TOTALS = [
  'commissions',
  'commissionsReported',
  'commissionsOnTime',
  'commissionsLate',
  'commissionsNotReported',
  'expected',
  'filed',
  'nonFilers',
  'initialExpected',
  'initialFiled',
  'initialNonFilers',
  'biennialExpected',
  'biennialFiled',
  'biennialNonFilers',
  'finalExpected',
  'finalFiled',
  'finalNonFilers',
  'clarifications',
] as const;

/** National rates, as fractions to four places; null where the denominator is 0. */
export const NATIONAL_RATES = [
  'reportingRate',
  'filingRate',
  'nonFilerRate',
  'initialFilingRate',
  'biennialFilingRate',
  'finalFilingRate',
  'clarificationRatio',
] as const;

/**
 * A Commission's figures. `reported` is 1 once its report is submitted, else 0; `reportedLate` is
 * 1 for a report submitted after the deadline (the report, not its officers). Every other figure
 * is null until the Commission reports.
 */
export const COMMISSION_FIGURES = [
  'reported',
  'reportedLate',
  'expected',
  'filed',
  'nonFilers',
  'initialExpected',
  'initialFiled',
  'initialNonFilers',
  'biennialExpected',
  'biennialFiled',
  'biennialNonFilers',
  'finalExpected',
  'finalFiled',
  'finalNonFilers',
  'clarifications',
  'filingRate',
  'nonFilerRate',
  'initialFilingRate',
  'biennialFilingRate',
  'finalFilingRate',
  'clarificationRatio',
] as const;

export type NationalTotal = (typeof NATIONAL_TOTALS)[number];
export type NationalRate = (typeof NATIONAL_RATES)[number];
export type NationalFigure = NationalTotal | NationalRate;
export type CommissionFigure = (typeof COMMISSION_FIGURES)[number];

/** ai-gateway `NarrateComplianceReportInput.commissionTable[]`. */
export interface NarrativeCommissionRow {
  /** The Commission's slug. */
  code: string;
  commissionName: string;
  figures: Record<CommissionFigure, number | null>;
}

/** One year of ai-gateway `NarrateComplianceReportInput`: `fy` is the year it ends in. */
export interface NarrativeYear {
  fy: number;
  totals: Record<NationalTotal, number>;
  rates: Record<NationalRate, number | null>;
  /** Sorted by code. */
  commissionTable: NarrativeCommissionRow[];
}

/** The figures of ai-gateway `NarrateComplianceReportInput`: this year and the prior years. */
export interface NarrativeFigures extends NarrativeYear {
  /** Most recent first. */
  priorYears: NarrativeYear[];
}

/**
 * The year's figures in the gateway's shape from its aggregates and those of prior years (any
 * order; a year not before `current` is ignored). A year with no NCR built has no aggregates and
 * is simply absent.
 */
export function narrativeFigures(
  current: NationalAggregates,
  prior: readonly NationalAggregates[],
): NarrativeFigures {
  const priorYears = prior
    .filter((year) => year.fy < current.fy)
    .sort((a, b) => b.fy - a.fy)
    .map(narrativeYear);
  return { ...narrativeYear(current), priorYears };
}

/** One year's aggregates in the gateway's shape. */
export function narrativeYear(aggregates: NationalAggregates): NarrativeYear {
  const { national, reporting } = aggregates;
  const totals: Record<NationalTotal, number> = {
    commissions: reporting.commissions,
    commissionsReported: reporting.reported,
    commissionsOnTime: reporting.onTime,
    commissionsLate: reporting.late,
    commissionsNotReported: reporting.notReported,
    ...sectionCounts(national),
    clarifications: national.clarifications,
  };
  const rates: Record<NationalRate, number | null> = {
    reportingRate: reporting.rate,
    ...sectionRates(national),
    clarificationRatio: rateOf(national.clarifications, national.all.declared),
  };
  const commissionTable = Object.entries(aggregates.byCommission)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([code, row]): NarrativeCommissionRow => {
      const { initial, biennial, final } = row;
      if (initial === null || biennial === null || final === null) {
        return { code, commissionName: row.name, figures: notReported() };
      }
      const all = sumOf(initial, biennial, final);
      const sections = { initial, biennial, final, all };
      const { clarifications } = row;
      return {
        code,
        commissionName: row.name,
        figures: {
          reported: 1,
          reportedLate: row.status === 'submitted-late' ? 1 : 0,
          ...sectionCounts(sections),
          clarifications,
          ...sectionRates(sections),
          clarificationRatio: clarifications === null ? null : rateOf(clarifications, all.declared),
        },
      };
    });
  return { fy: referencePeriodOf(aggregates.fy), totals, rates, commissionTable };
}

/** The key of a national figure of `year`, one of `figures`' years. */
export function nationalKey(
  figures: NarrativeFigures,
  year: NarrativeYear,
  name: NationalFigure,
): string {
  return `${prefixOf(figures, year)}national.${name}`;
}

/** The key of a Commission's figure in `year`, one of `figures`' years. */
export function commissionKey(
  figures: NarrativeFigures,
  year: NarrativeYear,
  code: string,
  name: CommissionFigure,
): string {
  return `${prefixOf(figures, year)}commission.${code}.${name}`;
}

/**
 * Every aggregate key of `figures`, as the ai-gateway derives them from the task input
 * (`narrative-validation.ts` `aggregateKeys`): what a paragraph or candidate may cite.
 */
export function aggregateKeys(figures: NarrativeFigures): Set<string> {
  return new Set(
    [figures, ...figures.priorYears].flatMap((year) => [
      ...[...Object.keys(year.totals), ...Object.keys(year.rates)].map((name) =>
        nationalKey(figures, year, name as NationalFigure),
      ),
      ...year.commissionTable.flatMap(({ code, figures: own }) =>
        Object.keys(own).map((name) =>
          commissionKey(figures, year, code, name as CommissionFigure),
        ),
      ),
    ]),
  );
}

function prefixOf(figures: NarrativeFigures, year: NarrativeYear): string {
  return year.fy === figures.fy ? '' : `fy${String(year.fy)}.`;
}

interface Sections {
  initial: SectionAggregate;
  biennial: SectionAggregate;
  final: SectionAggregate;
  all: SectionAggregate;
}

function sectionCounts(sections: Sections) {
  return {
    expected: sections.all.expected,
    filed: sections.all.declared,
    nonFilers: sections.all.notDeclared,
    initialExpected: sections.initial.expected,
    initialFiled: sections.initial.declared,
    initialNonFilers: sections.initial.notDeclared,
    biennialExpected: sections.biennial.expected,
    biennialFiled: sections.biennial.declared,
    biennialNonFilers: sections.biennial.notDeclared,
    finalExpected: sections.final.expected,
    finalFiled: sections.final.declared,
    finalNonFilers: sections.final.notDeclared,
  };
}

function sectionRates(sections: Sections) {
  return {
    filingRate: rateOf(sections.all.declared, sections.all.expected),
    nonFilerRate: rateOf(sections.all.notDeclared, sections.all.expected),
    initialFilingRate: rateOf(sections.initial.declared, sections.initial.expected),
    biennialFilingRate: rateOf(sections.biennial.declared, sections.biennial.expected),
    finalFilingRate: rateOf(sections.final.declared, sections.final.expected),
  };
}

function sumOf(...sections: SectionAggregate[]): SectionAggregate {
  const expected = sections.reduce((total, each) => total + each.expected, 0);
  const declared = sections.reduce((total, each) => total + each.declared, 0);
  const notDeclared = sections.reduce((total, each) => total + each.notDeclared, 0);
  return { expected, declared, notDeclared, rate: rateOf(declared, expected) };
}

function notReported(): Record<CommissionFigure, number | null> {
  const figures = Object.fromEntries(COMMISSION_FIGURES.map((name) => [name, null])) as Record<
    CommissionFigure,
    number | null
  >;
  return { ...figures, reported: 0 };
}
