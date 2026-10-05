import {
  type FigureFormatter,
  formatNumber,
  formatPercent,
  type PatternCardProps,
} from '@adili/ui';

import type {
  NarrativeParagraph,
  NationalAggregates,
  PatternCandidate,
} from '../../server/reporting/types';
import {
  aggregateKeyOf,
  type AggregateKey,
  type CommissionFigure,
  currentFigure,
  type NationalFigure,
  parseAggregateKey,
  NATIONAL_SUBJECT,
} from '../../server/reporting/aggregate-keys';

/**
 * The Notable patterns panel's reading of the reporting service's pattern candidates (spec 09b
 * S1, #331): each candidate as a card's words, the figures a citation carries as chip labels and
 * values, and where in the tables a figure is.
 */

/** "2025/2026": a financial year by its start year, as figures and comparisons name it. */
export const fyLabel = (fy: number) => `${String(fy)}/${String(fy + 1)}`;

/** `0.0412` → `4.1%`. */
const percent = (fraction: number) => formatPercent(fraction * 100);

const PER_THOUSAND = new Intl.NumberFormat('en-KE', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** Clarifications per declaration filed (`0.0426`) per 1,000 declarations: `42.6`. */
const perThousand = (ratio: number) => PER_THOUSAND.format(ratio * 1000);

/** "2.3 times", or for a rate that fell, "2.5 times lower" (a factor of 0.4). */
const factorOf = (factor: number) =>
  factor >= 1 ? `${factor.toFixed(1)} times` : `${(1 / factor).toFixed(1)} times lower`;

function numberIn(values: PatternCandidate['values'], name: string): number | null {
  const value = values[name];
  return typeof value === 'number' ? value : null;
}

/** "Nairobi City County Public Service Board", "National", or the slug for a name not known. */
export function subjectName(subject: string, aggregates: NationalAggregates): string {
  if (subject === NATIONAL_SUBJECT) return 'National';
  return aggregates.byCommission[subject]?.name ?? subject;
}

/** "2023/2024, 2024/2025 and 2025/2026": the `years` up to the report's, oldest first. */
function yearsUpTo(fy: number, years: number): string {
  const labels = Array.from({ length: Math.max(1, years) }, (_, back) =>
    fyLabel(fy - back),
  ).reverse();
  const last = labels.pop() ?? '';
  return labels.length > 0 ? `${labels.join(', ')} and ${last}` : last;
}

const yearsOf = (years: number) => `${formatNumber(years)} year${years === 1 ? '' : 's'}`;

export type CandidateCard = Pick<
  PatternCardProps,
  'kind' | 'subject' | 'value' | 'valueLabel' | 'comparison'
> & { value: string; valueLabel: string; comparison: string };

/** Said for a figure the candidate does not carry, rather than a misleading 0. */
const NOT_AVAILABLE = 'not available';

/** What a pattern card says of `candidate`, from its values (reporting.yaml, by kind). */
export function candidateCard(
  candidate: PatternCandidate,
  aggregates: NationalAggregates,
): CandidateCard {
  const { kind, values } = candidate;
  const subject = subjectName(candidate.subject, aggregates);
  const fy = aggregates.fy;
  const shown = (name: string, format: (value: number) => string) => {
    const value = numberIn(values, name);
    return value === null ? NOT_AVAILABLE : format(value);
  };
  const pct = (name: string) => shown(name, percent);
  const count = (name: string) => shown(name, formatNumber);
  const run = () => {
    const years = numberIn(values, 'years');
    return {
      value: years === null ? NOT_AVAILABLE : yearsOf(years),
      comparison: years === null ? '' : yearsUpTo(fy, years),
    };
  };
  switch (kind) {
    case 'rate-change': {
      const factor = numberIn(values, 'factor');
      return {
        kind,
        subject,
        value: pct('to'),
        valueLabel: 'non-filer rate',
        comparison: `from ${pct('from')} in ${fyLabel(fy - 1)}${factor === null ? '' : `, ${factorOf(factor)}`}`,
      };
    }
    case 'threshold-breach':
      return {
        kind,
        subject,
        value: pct('nonFilerRate'),
        valueLabel: 'non-filer rate',
        comparison: `threshold ${pct('threshold')}`,
      };
    case 'chronic-late-reporting':
      return { kind, subject, ...run(), valueLabel: 'reported late running' };
    case 'clarification-ratio-outlier': {
      const factor = numberIn(values, 'factor');
      return {
        kind,
        subject,
        value: shown('clarificationRatio', perThousand),
        valueLabel: 'clarifications per 1,000 declarations',
        comparison: `national ${shown('nationalRatio', perThousand)}${factor === null ? '' : `, ${factorOf(factor)}`}`,
      };
    }
    case 'size-band-outlier': {
      const bandTo = numberIn(values, 'bandTo');
      const band =
        bandTo === null
          ? `${count('bandFrom')} officers or more`
          : `${count('bandFrom')} to ${formatNumber(bandTo)} officers`;
      return {
        kind,
        subject,
        value: pct('nonFilerRate'),
        valueLabel: 'non-filer rate',
        comparison: `${pct('peerNonFilerRate')} for the ${count('peers')} others with ${band}`,
      };
    }
    case 'non-reporting':
      return { kind, subject, ...run(), valueLabel: 'without a Form M' };
  }
}

type FigureName = NationalFigure | CommissionFigure;

interface FigureCopy {
  /** What the figure is, after whose it is: "biennial filing rate". */
  label: string;
  format: 'count' | 'rate' | 'ratio' | 'flag';
  /** The national totals' row a national figure is in; null for none on the page. */
  row: 'initial' | 'biennial' | 'final' | 'all' | null;
  /** A national count of Commissions, labelled on its own: "Commissions reported late". */
  alone?: true;
}

const count = (label: string, row: FigureCopy['row'] = null): FigureCopy => ({
  label,
  format: 'count',
  row,
});
const rate = (label: string, row: FigureCopy['row'] = null): FigureCopy => ({
  label,
  format: 'rate',
  row,
});
const commissions = (label: string): FigureCopy => ({
  label,
  format: 'count',
  row: null,
  alone: true,
});

/** Every figure the gateway scheme names, national and per Commission: label, format and row. */
const FIGURES: Record<FigureName, FigureCopy> = {
  commissions: commissions('Commissions'),
  commissionsReported: commissions('Commissions reported'),
  commissionsOnTime: commissions('Commissions reported on time'),
  commissionsLate: commissions('Commissions reported late'),
  commissionsNotReported: commissions('Commissions not reported'),
  reported: { label: 'reported', format: 'flag', row: null },
  reportedLate: { label: 'reported late', format: 'flag', row: null },
  expected: count('declarations expected', 'all'),
  filed: count('declarations filed', 'all'),
  nonFilers: count('non-filers', 'all'),
  initialExpected: count('initial declarations expected', 'initial'),
  initialFiled: count('initial declarations filed', 'initial'),
  initialNonFilers: count('initial non-filers', 'initial'),
  biennialExpected: count('biennial declarations expected', 'biennial'),
  biennialFiled: count('biennial declarations filed', 'biennial'),
  biennialNonFilers: count('biennial non-filers', 'biennial'),
  finalExpected: count('final declarations expected', 'final'),
  finalFiled: count('final declarations filed', 'final'),
  finalNonFilers: count('final non-filers', 'final'),
  clarifications: count('clarifications'),
  accessRequestsReceived: count('access requests received'),
  accessRequestsGranted: count('access requests granted'),
  accessRequestsDeclined: count('access requests declined'),
  reportingRate: rate('reporting rate'),
  filingRate: rate('filing rate', 'all'),
  nonFilerRate: rate('non-filer rate', 'all'),
  initialFilingRate: rate('initial filing rate', 'initial'),
  biennialFilingRate: rate('biennial filing rate', 'biennial'),
  finalFilingRate: rate('final filing rate', 'final'),
  clarificationRatio: {
    label: 'clarifications per 1,000 declarations',
    format: 'ratio',
    row: null,
  },
};

function formatFigure(name: FigureName, value: number): string {
  switch (FIGURES[name].format) {
    case 'ratio':
      return perThousand(value);
    case 'rate':
      return percent(value);
    case 'flag':
      return value === 1 ? 'Yes' : 'No';
    case 'count':
      return formatNumber(value);
  }
}

/**
 * The prior years' figures the candidates carry, by key: a rate change's `from` and `to`, a
 * late-reporting run's years (each late), a non-reporting run's (each not reported). The report
 * holds only its own year; these are the earlier figures a citation can show.
 */
function candidateFigures(candidates: readonly PatternCandidate[]): Map<string, number> {
  const figures = new Map<string, number>();
  for (const candidate of candidates) {
    const keys = candidate.aggregateKeys;
    if (candidate.kind === 'rate-change') {
      const from = numberIn(candidate.values, 'from');
      const to = numberIn(candidate.values, 'to');
      if (keys[0] && from !== null) figures.set(keys[0], from);
      if (keys[1] && to !== null) figures.set(keys[1], to);
    }
    if (candidate.kind === 'chronic-late-reporting') for (const key of keys) figures.set(key, 1);
    if (candidate.kind === 'non-reporting') for (const key of keys) figures.set(key, 0);
  }
  return figures;
}

/**
 * Resolves the aggregate keys a narrative paragraph cites to "{label}: {value}", e.g. "Nairobi
 * City County Public Service Board non-filer rate 2024/2025: 4.1%": this year's from the report,
 * earlier ones from the candidates citing them; null for a figure neither has. A figure of this
 * year the report holds as null (a Commission yet to report, a count its report did not give, a
 * rate of nobody expected) is in the task input all the same, so it reads "not available".
 */
export function figureFormatter(
  aggregates: NationalAggregates,
  candidates: readonly PatternCandidate[],
): FigureFormatter {
  const earlier = candidateFigures(candidates);
  return (aggregateKey) => {
    const key = parseAggregateKey(aggregateKey, aggregates.fy);
    if (!key) return null;
    if (key.scope === 'commission' && !aggregates.byCommission[key.slug]) return null;
    const current = key.fy === aggregates.fy;
    const value = current
      ? currentFigure(aggregates, key)
      : (earlier.get(aggregateKeyOf(key, aggregates.fy)) ?? null);
    if (value === null && !current) return null;
    return {
      label: `${labelOf(key, aggregates)} ${fyLabel(key.fy)}`,
      value: value === null ? NOT_AVAILABLE : formatFigure(key.name, value),
    };
  };
}

function labelOf(key: AggregateKey, aggregates: NationalAggregates): string {
  const copy = FIGURES[key.name];
  if (key.scope === 'commission') return `${subjectName(key.slug, aggregates)} ${copy.label}`;
  return copy.alone ? copy.label : `National ${copy.label}`;
}

/** Where a figure is shown: its Commission's row, or a row of the national totals. */
export type FigureTarget =
  { commission: string } | { national: 'initial' | 'biennial' | 'final' | 'all' };

/**
 * Where this year's figure is on the page: its Commission's row, or a row of the national totals;
 * null for a prior year's (the page shows only the report's year) or one with no row.
 */
export function figureTarget(aggregateKey: string, fy: number): FigureTarget | null {
  const key = parseAggregateKey(aggregateKey, fy);
  if (key?.fy !== fy) return null;
  if (key.scope === 'commission') return { commission: key.slug };
  const row = FIGURES[key.name].row;
  return row ? { national: row } : null;
}

/**
 * A cited pattern's paragraph as it starts, from its card's words, for the analyst to rewrite:
 * "Teachers Service Commission: 3 years reported late running (2023/2024, 2024/2025 and
 * 2025/2026)."
 */
export function citationText(card: CandidateCard): string {
  return `${card.subject}: ${card.value} ${card.valueLabel} (${card.comparison}).`;
}

/** The candidates the narrative's paragraphs cite, by id. */
export function citedCandidateIds(paragraphs: readonly NarrativeParagraph[]): Set<string> {
  return new Set(paragraphs.flatMap((paragraph) => paragraph.candidateIds));
}
