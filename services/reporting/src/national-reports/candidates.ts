import { z } from 'zod';

import { rateOf } from '../compliance-reports/intake.js';
import {
  commissionKey,
  type NarrativeCommissionRow,
  type NarrativeFigures,
  type NarrativeYear,
  nationalKey,
} from './narrative-input.js';

/**
 * Pattern candidates (spec 09b S1, ADR-007): the notable patterns in this and prior years' NCR
 * aggregates, computed by code before AI sees anything. The narrative narrates them; it never
 * finds its own. Each names its kind, its subject (a Commission's slug or `national`), the figures
 * it rests on (`values`, which the narrative may state) and the aggregate keys of those figures.
 * Pure: the same figures and thresholds give the same candidates, in the same order: by kind,
 * then the largest first (`magnitudeOf`), then the nation before Commissions, then by slug.
 *
 * - `rate-change`: a non-filer rate (non-filers over officers expected) that moved year on year by
 *   at least a factor (doubled, or halved) and a number of points. The filing rate is its
 *   complement (filed = expected - non-filers), so the same change; the NCR aggregates carry no
 *   other non-compliance rate (compliance determinations are not in Form M).
 * - `threshold-breach`: a non-filer rate above the threshold.
 * - `chronic-late-reporting`: a Commission whose report was submitted late in each of the last
 *   years (the report, not its officers: the NCR aggregates carry only the report's lateness).
 * - `clarification-ratio-outlier`: clarifications per declaration filed at least a factor above
 *   the national ratio.
 * - `size-band-outlier`: a non-filer rate at least a factor above that of the other Commissions
 *   of its size band, by officers expected (no reporting-entity types exist to band by).
 * - `non-reporting`: a Commission that has not submitted its report for the year.
 */

/** reporting.yaml `PatternCandidate.kind`, in the order candidates are listed. */
export const CANDIDATE_KINDS = [
  'rate-change',
  'threshold-breach',
  'chronic-late-reporting',
  'clarification-ratio-outlier',
  'size-band-outlier',
  'non-reporting',
] as const;

export type CandidateKind = (typeof CANDIDATE_KINDS)[number];

/** reporting.yaml `PatternCandidate`; ai-gateway `NarrateComplianceReportInput.candidates[]`. */
export const patternCandidateSchema = z.object({
  id: z
    .string()
    .meta({ description: '`<kind>:<subject>:<figure>`, stable across builds of the year' }),
  kind: z.enum(CANDIDATE_KINDS),
  subject: z.string().meta({ description: 'Commission slug, entity type, or `national`' }),
  values: z.record(z.string(), z.union([z.number(), z.string(), z.null()])).meta({
    description:
      'The figures the candidate rests on, by name: numbers, strings or null, no nested values, as `NarrateComplianceReportInput` takes them. A derived figure the narrative may state (a change, a count of years) is carried here.',
  }),
  aggregateKeys: z.array(z.string()).min(1).meta({
    description:
      'Keys of the figures the candidate rests on, in the ai-gateway scheme (`NarrateComplianceReportInput`): `national.<name>`, `commission.<code>.<name>`, prefixed `fy<fy>.` for a prior year',
  }),
});
export type PatternCandidate = z.infer<typeof patternCandidateSchema>;

/** What makes a pattern notable; configuration (`CANDIDATE_*`), defaults in `config.ts`. */
export interface CandidateThresholds {
  /** A difference between two rates smaller than this (a fraction: 0.02 is 2 points) is no pattern. */
  minPoints: number;
  /** `rate-change`: the factor a non-filer rate moved by, up or down (2: doubled or halved). */
  rateChangeFactor: number;
  /** `threshold-breach`: the non-filer rate above which a Commission or the nation is flagged. */
  maxNonFilerRate: number;
  /** `chronic-late-reporting`: consecutive years, this one included, of late reports. */
  chronicLateYears: number;
  /** `clarification-ratio-outlier`: the factor over the national clarification ratio. */
  clarificationRatioFactor: number;
  /**
   * `size-band-outlier`: the officers expected at which each band above the smallest starts,
   * ascending (`[100, 1000]`: under 100, 100 to 999, 1000 and over).
   */
  sizeBands: readonly number[];
  /** `size-band-outlier`: the factor over the band's other Commissions' non-filer rate. */
  sizeBandFactor: number;
}

/** A size band needs this many other reporting Commissions for its rate to compare against. */
const MIN_BAND_PEERS = 2;

/** The prior years of aggregates the candidates look back on, given the thresholds. */
export function historyYears(thresholds: CandidateThresholds): number {
  return Math.max(1, thresholds.chronicLateYears - 1);
}

/** The year's pattern candidates from its figures and the prior years'. */
export function patternCandidates(
  figures: NarrativeFigures,
  thresholds: CandidateThresholds,
): PatternCandidate[] {
  const candidates = [
    ...rateChanges(figures, thresholds),
    ...thresholdBreaches(figures, thresholds),
    ...chronicLateReporting(figures, thresholds),
    ...clarificationOutliers(figures, thresholds),
    ...sizeBandOutliers(figures, thresholds),
    ...nonReporting(figures),
  ];
  const kinds: readonly string[] = CANDIDATE_KINDS;
  return candidates.sort(
    (a, b) =>
      kinds.indexOf(a.kind) - kinds.indexOf(b.kind) ||
      magnitudeOf(b) - magnitudeOf(a) ||
      Number(b.subject === NATIONAL) - Number(a.subject === NATIONAL) ||
      compare(a.subject, b.subject),
  );
}

/**
 * How notable a candidate is within its kind, larger first: a rate change's points either way, a
 * breaching rate, the years of a streak, the factor over the national clarification ratio, the
 * points above the size band's peers.
 */
function magnitudeOf(candidate: PatternCandidate): number {
  const value = (name: string): number => {
    const found = candidate.values[name];
    return typeof found === 'number' ? found : 0;
  };
  switch (candidate.kind) {
    case 'rate-change':
      return Math.abs(value('change'));
    case 'threshold-breach':
      return value('nonFilerRate');
    case 'chronic-late-reporting':
    case 'non-reporting':
      return value('years');
    case 'clarification-ratio-outlier':
      return value('factor');
    case 'size-band-outlier':
      return value('nonFilerRate') - value('peerNonFilerRate');
  }
}

const NATIONAL = 'national';

function rateChanges(figures: NarrativeFigures, thresholds: CandidateThresholds) {
  const last = previousYear(figures);
  if (!last) return [];
  const candidates: PatternCandidate[] = [];
  const national = changeOf(last.rates.nonFilerRate, figures.rates.nonFilerRate, thresholds);
  if (national) {
    candidates.push({
      id: idOf('rate-change', NATIONAL, 'nonFilerRate'),
      kind: 'rate-change',
      subject: NATIONAL,
      values: national,
      aggregateKeys: [
        nationalKey(figures, last, 'nonFilerRate'),
        nationalKey(figures, figures, 'nonFilerRate'),
      ],
    });
  }
  const before = rowsByCode(last);
  for (const row of figures.commissionTable) {
    const earlier = before.get(row.code);
    if (!earlier) continue;
    const change = changeOf(earlier.figures.nonFilerRate, row.figures.nonFilerRate, thresholds);
    if (!change) continue;
    candidates.push({
      id: idOf('rate-change', row.code, 'nonFilerRate'),
      kind: 'rate-change',
      subject: row.code,
      values: change,
      aggregateKeys: [
        commissionKey(figures, last, row.code, 'nonFilerRate'),
        commissionKey(figures, figures, row.code, 'nonFilerRate'),
      ],
    });
  }
  return candidates;
}

/** The change from `from` to `to` when it is notable: at least the factor and the points. */
function changeOf(
  from: number | null,
  to: number | null,
  thresholds: CandidateThresholds,
): PatternCandidate['values'] | null {
  if (from === null || to === null) return null;
  const change = round(to - from, 4);
  if (Math.abs(change) < thresholds.minPoints) return null;
  const [low, high] = from < to ? [from, to] : [to, from];
  if (low > 0 && high / low < thresholds.rateChangeFactor) return null;
  return { from, to, change, factor: from > 0 ? round(to / from, 2) : null };
}

function thresholdBreaches(figures: NarrativeFigures, thresholds: CandidateThresholds) {
  const threshold = thresholds.maxNonFilerRate;
  const breached = (rate: number | null): rate is number => rate !== null && rate > threshold;
  const candidates: PatternCandidate[] = [];
  if (breached(figures.rates.nonFilerRate)) {
    candidates.push({
      id: idOf('threshold-breach', NATIONAL, 'nonFilerRate'),
      kind: 'threshold-breach',
      subject: NATIONAL,
      values: { nonFilerRate: figures.rates.nonFilerRate, threshold },
      aggregateKeys: [nationalKey(figures, figures, 'nonFilerRate')],
    });
  }
  for (const row of figures.commissionTable) {
    const rate = row.figures.nonFilerRate;
    if (!breached(rate)) continue;
    candidates.push({
      id: idOf('threshold-breach', row.code, 'nonFilerRate'),
      kind: 'threshold-breach',
      subject: row.code,
      values: { nonFilerRate: rate, threshold },
      aggregateKeys: [commissionKey(figures, figures, row.code, 'nonFilerRate')],
    });
  }
  return candidates;
}

function chronicLateReporting(figures: NarrativeFigures, thresholds: CandidateThresholds) {
  return figures.commissionTable.flatMap((row): PatternCandidate[] => {
    const years = streak(figures, row.code, (own) => own?.figures.reportedLate === 1);
    if (years.length < thresholds.chronicLateYears) return [];
    return [
      {
        id: idOf('chronic-late-reporting', row.code, 'reportedLate'),
        kind: 'chronic-late-reporting',
        subject: row.code,
        values: { years: years.length },
        aggregateKeys: years.map((year) => commissionKey(figures, year, row.code, 'reportedLate')),
      },
    ];
  });
}

function clarificationOutliers(figures: NarrativeFigures, thresholds: CandidateThresholds) {
  const nationalRatio = figures.rates.clarificationRatio;
  if (nationalRatio === null || nationalRatio === 0) return [];
  return figures.commissionTable.flatMap((row): PatternCandidate[] => {
    const ratio = row.figures.clarificationRatio;
    if (ratio === null || ratio < nationalRatio * thresholds.clarificationRatioFactor) return [];
    return [
      {
        id: idOf('clarification-ratio-outlier', row.code, 'clarificationRatio'),
        kind: 'clarification-ratio-outlier',
        subject: row.code,
        values: {
          clarificationRatio: ratio,
          nationalRatio,
          factor: round(ratio / nationalRatio, 2),
        },
        aggregateKeys: [
          commissionKey(figures, figures, row.code, 'clarificationRatio'),
          nationalKey(figures, figures, 'clarificationRatio'),
        ],
      },
    ];
  });
}

function sizeBandOutliers(figures: NarrativeFigures, thresholds: CandidateThresholds) {
  const bounds = [0, ...[...thresholds.sizeBands].sort((a, b) => a - b)];
  const bandOf = (expected: number) => bounds.findLastIndex((from) => expected >= from);
  const reported = figures.commissionTable.filter(
    (row) => row.figures.expected !== null && row.figures.nonFilers !== null,
  );
  return reported.flatMap((row): PatternCandidate[] => {
    const rate = row.figures.nonFilerRate;
    const expected = row.figures.expected ?? 0;
    if (rate === null) return [];
    const band = bandOf(expected);
    const peers = reported.filter(
      (other) => other.code !== row.code && bandOf(other.figures.expected ?? 0) === band,
    );
    if (peers.length < MIN_BAND_PEERS) return [];
    const peerRate = rateOf(
      sum(peers, (peer) => peer.figures.nonFilers),
      sum(peers, (peer) => peer.figures.expected),
    );
    if (peerRate === null) return [];
    if (rate - peerRate < thresholds.minPoints) return [];
    if (peerRate > 0 && rate / peerRate < thresholds.sizeBandFactor) return [];
    const next = bounds[band + 1];
    return [
      {
        id: idOf('size-band-outlier', row.code, 'nonFilerRate'),
        kind: 'size-band-outlier',
        subject: row.code,
        values: {
          nonFilerRate: rate,
          peerNonFilerRate: peerRate,
          peers: peers.length,
          bandFrom: bounds[band] ?? 0,
          bandTo: next === undefined ? null : next - 1,
        },
        aggregateKeys: [
          commissionKey(figures, figures, row.code, 'nonFilerRate'),
          commissionKey(figures, figures, row.code, 'expected'),
        ],
      },
    ];
  });
}

function nonReporting(figures: NarrativeFigures) {
  return figures.commissionTable.flatMap((row): PatternCandidate[] => {
    const years = streak(figures, row.code, (own) => own?.figures.reported === 0);
    if (years.length === 0) return [];
    return [
      {
        id: idOf('non-reporting', row.code, 'reported'),
        kind: 'non-reporting',
        subject: row.code,
        values: { years: years.length },
        aggregateKeys: years.map((year) => commissionKey(figures, year, row.code, 'reported')),
      },
    ];
  });
}

/**
 * The run of consecutive years, from this one back, in which the Commission's row passes `test`;
 * a year without aggregates ends the run.
 */
function streak(
  figures: NarrativeFigures,
  code: string,
  test: (row: NarrativeCommissionRow | undefined) => boolean,
): NarrativeYear[] {
  const years: NarrativeYear[] = [];
  for (const [back, year] of [figures, ...figures.priorYears].entries()) {
    if (year.fy !== figures.fy - back) break;
    if (!test(year.commissionTable.find((row) => row.code === code))) break;
    years.push(year);
  }
  return years;
}

/** The year before, when its aggregates were built. */
function previousYear(figures: NarrativeFigures): NarrativeYear | undefined {
  const [last] = figures.priorYears;
  return last?.fy === figures.fy - 1 ? last : undefined;
}

function rowsByCode(year: NarrativeYear): Map<string, NarrativeCommissionRow> {
  return new Map(year.commissionTable.map((row) => [row.code, row]));
}

function idOf(kind: CandidateKind, subject: string, figure: string): string {
  return `${kind}:${subject}:${figure}`;
}

function sum(
  rows: readonly NarrativeCommissionRow[],
  of: (row: NarrativeCommissionRow) => number | null,
): number {
  return rows.reduce((total, row) => total + (of(row) ?? 0), 0);
}

function round(value: number, places: number): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
