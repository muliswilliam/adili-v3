import type { NationalAggregates, SectionAggregate } from '../../server/reporting/types';

/**
 * The NCR's figures by aggregate key, in the ai-gateway scheme pattern candidates and narrative
 * paragraphs cite them by (reporting.yaml `PatternCandidate.aggregateKeys`, built by the reporting
 * service's `narrative-input.ts`): `national.<name>` for a national total or rate,
 * `commission.<slug>.<name>` for a Commission's figure, prefixed `fy<year>.` for a prior year,
 * where the year is the calendar year the financial year ends in (FY 2024/2025 is `fy2025.`).
 * Rates are fractions to four places, null where nobody was expected.
 */

/** National figures, by name. */
export const NATIONAL_FIGURES = [
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
  'reportingRate',
  'filingRate',
  'nonFilerRate',
  'initialFilingRate',
  'biennialFilingRate',
  'finalFilingRate',
  'clarificationRatio',
] as const;

/** A Commission's figures, by name; all but `reported` are null until it reports. */
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

export type NationalFigure = (typeof NATIONAL_FIGURES)[number];
export type CommissionFigure = (typeof COMMISSION_FIGURES)[number];

/** An aggregate key read: whose figure, which, and of which year (`fy`, the start year). */
export type AggregateKey =
  | { fy: number; scope: 'national'; name: NationalFigure }
  | { fy: number; scope: 'commission'; slug: string; name: CommissionFigure };

const KEY = /^(?:fy(\d{4})\.)?(?:national\.([A-Za-z]+)|commission\.([a-z0-9-]+)\.([A-Za-z]+))$/;

function isOneOf<T extends string>(list: readonly T[], value: string): value is T {
  return (list as readonly string[]).includes(value);
}

/** Reads `key` as cited from the report for `fy` (a start year), or null for no figure. */
export function parseAggregateKey(key: string, fy: number): AggregateKey | null {
  const match = KEY.exec(key);
  if (!match) return null;
  const [, endYear, national, slug, name] = match;
  const year = endYear ? Number(endYear) - 1 : fy;
  if (national !== undefined) {
    return isOneOf(NATIONAL_FIGURES, national)
      ? { fy: year, scope: 'national', name: national }
      : null;
  }
  if (slug === undefined || name === undefined || !isOneOf(COMMISSION_FIGURES, name)) return null;
  return { fy: year, scope: 'commission', slug, name };
}

/** The key of a figure of `fy` cited from the report for `current`. */
export function aggregateKeyOf(key: AggregateKey, current: number): string {
  const prefix = key.fy === current ? '' : `fy${String(key.fy + 1)}.`;
  return key.scope === 'national'
    ? `${prefix}national.${key.name}`
    : `${prefix}commission.${key.slug}.${key.name}`;
}

/** Declared over expected, to four places, as the reporting service rounds rates. */
export function rateOf(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 10_000) / 10_000 : null;
}

interface Sections {
  initial: SectionAggregate;
  biennial: SectionAggregate;
  final: SectionAggregate;
}

function sectionFigures({ initial, biennial, final }: Sections) {
  const expected = initial.expected + biennial.expected + final.expected;
  const filed = initial.declared + biennial.declared + final.declared;
  const nonFilers = initial.notDeclared + biennial.notDeclared + final.notDeclared;
  return {
    expected,
    filed,
    nonFilers,
    initialExpected: initial.expected,
    initialFiled: initial.declared,
    initialNonFilers: initial.notDeclared,
    biennialExpected: biennial.expected,
    biennialFiled: biennial.declared,
    biennialNonFilers: biennial.notDeclared,
    finalExpected: final.expected,
    finalFiled: final.declared,
    finalNonFilers: final.notDeclared,
    filingRate: rateOf(filed, expected),
    nonFilerRate: rateOf(nonFilers, expected),
    initialFilingRate: rateOf(initial.declared, initial.expected),
    biennialFilingRate: rateOf(biennial.declared, biennial.expected),
    finalFilingRate: rateOf(final.declared, final.expected),
  };
}

/** The year's national figures, as the reporting service names them. */
export function nationalFigures(
  aggregates: NationalAggregates,
): Record<NationalFigure, number | null> {
  const { reporting, national } = aggregates;
  const sections = sectionFigures(national);
  return {
    commissions: reporting.commissions,
    commissionsReported: reporting.reported,
    commissionsOnTime: reporting.onTime,
    commissionsLate: reporting.late,
    commissionsNotReported: reporting.notReported,
    ...sections,
    clarifications: national.clarifications,
    reportingRate: reporting.rate,
    clarificationRatio: rateOf(national.clarifications, sections.filed),
  };
}

/** A Commission's figures for the year, or null when the report has no such Commission. */
export function commissionFigures(
  aggregates: NationalAggregates,
  slug: string,
): Record<CommissionFigure, number | null> | null {
  const row = aggregates.byCommission[slug];
  if (!row) return null;
  const { initial, biennial, final } = row;
  if (!initial || !biennial || !final) {
    const none = Object.fromEntries(COMMISSION_FIGURES.map((name) => [name, null]));
    return { ...(none as Record<CommissionFigure, null>), reported: 0 };
  }
  const sections = sectionFigures({ initial, biennial, final });
  const clarifications = row.clarifications ?? 0;
  return {
    reported: 1,
    reportedLate: row.status === 'submitted-late' ? 1 : 0,
    ...sections,
    clarifications,
    clarificationRatio: rateOf(clarifications, sections.filed),
  };
}

/** A figure of the report's own year, or null (a prior year's, or one it does not have). */
export function currentFigure(aggregates: NationalAggregates, key: AggregateKey): number | null {
  if (key.fy !== aggregates.fy) return null;
  if (key.scope === 'national') return nationalFigures(aggregates)[key.name];
  return commissionFigures(aggregates, key.slug)?.[key.name] ?? null;
}
