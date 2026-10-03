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
} from './figures';
import { fyLabel } from './model';

/**
 * The Notable patterns panel's reading of the reporting service's pattern candidates (spec 09b
 * S1, #331): each candidate as a card's words, the figures a citation carries as chip labels and
 * values, and where in the tables a figure is.
 */

const NATIONAL = 'national';

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
  if (subject === NATIONAL) return 'National';
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

/** What a pattern card says of `candidate`, from its values (reporting.yaml, by kind). */
export function candidateCard(
  candidate: PatternCandidate,
  aggregates: NationalAggregates,
): CandidateCard {
  const { kind, values } = candidate;
  const subject = subjectName(candidate.subject, aggregates);
  const n = (name: string) => numberIn(values, name) ?? 0;
  const fy = aggregates.fy;
  switch (kind) {
    case 'rate-change': {
      const factor = numberIn(values, 'factor');
      return {
        kind,
        subject,
        value: percent(n('to')),
        valueLabel: 'non-filer rate',
        comparison: `from ${percent(n('from'))} in ${fyLabel(fy - 1)}${factor === null ? '' : `, ${factorOf(factor)}`}`,
      };
    }
    case 'threshold-breach':
      return {
        kind,
        subject,
        value: percent(n('nonFilerRate')),
        valueLabel: 'non-filer rate',
        comparison: `threshold ${percent(n('threshold'))}`,
      };
    case 'chronic-late-reporting':
      return {
        kind,
        subject,
        value: yearsOf(n('years')),
        valueLabel: 'reported late running',
        comparison: yearsUpTo(fy, n('years')),
      };
    case 'clarification-ratio-outlier':
      return {
        kind,
        subject,
        value: perThousand(n('clarificationRatio')),
        valueLabel: 'clarifications per 1,000 declarations',
        comparison: `national ${perThousand(n('nationalRatio'))}, ${factorOf(n('factor'))}`,
      };
    case 'size-band-outlier': {
      const bandTo = numberIn(values, 'bandTo');
      const band =
        bandTo === null
          ? `${formatNumber(n('bandFrom'))} officers or more`
          : `${formatNumber(n('bandFrom'))} to ${formatNumber(bandTo)} officers`;
      return {
        kind,
        subject,
        value: percent(n('nonFilerRate')),
        valueLabel: 'non-filer rate',
        comparison: `${percent(n('peerNonFilerRate'))} for the ${formatNumber(n('peers'))} others with ${band}`,
      };
    }
    case 'non-reporting':
      return {
        kind,
        subject,
        value: yearsOf(n('years')),
        valueLabel: 'without a Form M',
        comparison: yearsUpTo(fy, n('years')),
      };
  }
}

const SECTION_FIGURE_LABELS = {
  Expected: 'declarations expected',
  Filed: 'declarations filed',
  NonFilers: 'non-filers',
  FilingRate: 'filing rate',
} as const;

const FIGURE_LABELS: Partial<Record<NationalFigure | CommissionFigure, string>> = {
  expected: 'declarations expected',
  filed: 'declarations filed',
  nonFilers: 'non-filers',
  filingRate: 'filing rate',
  nonFilerRate: 'non-filer rate',
  clarifications: 'clarifications',
  clarificationRatio: 'clarifications per 1,000 declarations',
  reported: 'reported',
  reportedLate: 'reported late',
  reportingRate: 'reporting rate',
};

/** National counts of Commissions, labelled on their own: "Commissions reported late". */
const COMMISSION_COUNT_LABELS: Partial<Record<NationalFigure, string>> = {
  commissions: 'Commissions',
  commissionsReported: 'Commissions reported',
  commissionsOnTime: 'Commissions reported on time',
  commissionsLate: 'Commissions reported late',
  commissionsNotReported: 'Commissions not reported',
};

/** "biennial declarations expected", "non-filer rate". */
function figureLabel(name: NationalFigure | CommissionFigure): string {
  const own = FIGURE_LABELS[name];
  if (own) return own;
  const section = /^(initial|biennial|final)(Expected|Filed|NonFilers|FilingRate)$/.exec(name);
  if (section?.[1] && section[2]) {
    return `${section[1]} ${SECTION_FIGURE_LABELS[section[2] as keyof typeof SECTION_FIGURE_LABELS]}`;
  }
  return name;
}

function formatFigure(name: NationalFigure | CommissionFigure, value: number): string {
  if (name === 'clarificationRatio') return perThousand(value);
  if (name.endsWith('Rate')) return percent(value);
  if (name === 'reported' || name === 'reportedLate') return value === 1 ? 'Yes' : 'No';
  return formatNumber(value);
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
 * earlier ones from the candidates citing them; null for a figure neither has.
 */
export function figureFormatter(
  aggregates: NationalAggregates,
  candidates: readonly PatternCandidate[],
): FigureFormatter {
  const earlier = candidateFigures(candidates);
  return (aggregateKey) => {
    const key = parseAggregateKey(aggregateKey, aggregates.fy);
    if (!key) return null;
    const value =
      key.fy === aggregates.fy
        ? currentFigure(aggregates, key)
        : (earlier.get(aggregateKeyOf(key, aggregates.fy)) ?? null);
    if (value === null) return null;
    if (key.scope === 'commission' && !aggregates.byCommission[key.slug]) return null;
    return {
      label: `${labelOf(key, aggregates)} ${fyLabel(key.fy)}`,
      value: formatFigure(key.name, value),
    };
  };
}

function labelOf(key: AggregateKey, aggregates: NationalAggregates): string {
  if (key.scope === 'commission') {
    return `${subjectName(key.slug, aggregates)} ${figureLabel(key.name)}`;
  }
  return COMMISSION_COUNT_LABELS[key.name] ?? `National ${figureLabel(key.name)}`;
}

/** Where a figure is shown: its Commission's row, or a row of the national totals. */
export type FigureTarget =
  { commission: string } | { national: 'initial' | 'biennial' | 'final' | 'all' };

export function figureTarget(aggregateKey: string): FigureTarget | null {
  // The year does not matter for where the figure's row is.
  const key = parseAggregateKey(aggregateKey, 0);
  if (!key) return null;
  if (key.scope === 'commission') return { commission: key.slug };
  const section = /^(initial|biennial|final)/.exec(key.name)?.[1];
  if (section === 'initial' || section === 'biennial' || section === 'final') {
    return { national: section };
  }
  // The national totals' All sections row: the three sections' counts and rates together.
  const allSections: readonly string[] = [
    'expected',
    'filed',
    'nonFilers',
    'filingRate',
    'nonFilerRate',
  ];
  // Commissions reporting and clarifications have no row of their own on the page.
  return allSections.includes(key.name) ? { national: 'all' } : null;
}

/** The candidates the narrative's paragraphs cite, by id. */
export function citedCandidateIds(paragraphs: readonly NarrativeParagraph[]): Set<string> {
  return new Set(paragraphs.flatMap((paragraph) => paragraph.candidateIds));
}
