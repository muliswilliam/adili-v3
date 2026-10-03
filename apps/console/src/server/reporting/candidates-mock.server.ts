/**
 * The pattern candidates part of the reporting mock (`mock.server.ts` hands it
 * `GET /v1/eacc/national-reports/{fy}/candidates`, reporting.yaml `getNationalReportCandidates`):
 * the year's notable patterns computed from its report as last built (`ncr-mock.server.ts`) and a
 * fixture of the two years before, at the service's default thresholds, by its rules
 * (`services/reporting/src/national-reports/candidates.ts`):
 *
 * - `rate-change`: a non-filer rate at least doubled or halved, and by 2 points, since last year;
 * - `threshold-breach`: a non-filer rate above 10%;
 * - `chronic-late-reporting`: a report late in each of the last three years;
 * - `clarification-ratio-outlier`: clarifications per declaration twice the national ratio;
 * - `size-band-outlier`: a non-filer rate twice that of the other Commissions of its size band
 *   (under 100, 100 to 999, 1,000 officers expected and over), with two peers at least;
 * - `non-reporting`: no report this year, with the years before without one.
 *
 * Ordered by kind, the largest first, then the nation, then slug. For FY 2025/2026 that is ten:
 * Nairobi City's non-filer rate up from 15.2%, above the threshold and its size band; the TSC late
 * three years running; three clarification outliers; Mandera without a report two years, Kwale
 * and Turkana this year. EACC analysts and supervisors only (403), 404 before the year is built.
 * REPORTING_MOCK_CANDIDATES `none` answers no candidates, `error` a 503.
 */
import {
  aggregateKeyOf,
  type AggregateKey,
  commissionFigures,
  nationalFigures,
  rateOf,
} from '../../components/national-report/figures';
import { type Env, envSchema } from '../env.server';
import { json, mockCallerOf, problem } from '../mock-http';
import { ncrMockAggregates } from './ncr-mock.server';
import type { NationalAggregates, PatternCandidate } from './types';

export type CandidatesMockSeed = Env['REPORTING_MOCK_CANDIDATES'];

const THRESHOLDS = {
  minPoints: 0.02,
  rateChangeFactor: 2,
  maxNonFilerRate: 0.1,
  chronicLateYears: 3,
  clarificationRatioFactor: 2,
  sizeBands: [0, 100, 1000],
  sizeBandFactor: 2,
};

const MIN_BAND_PEERS = 2;

/** What the mock knows of a Commission in a year before the report's. */
interface PriorRow {
  reported: boolean;
  late: boolean;
  nonFilerRate: number | null;
}

const on = (nonFilerRate: number): PriorRow => ({ reported: true, late: false, nonFilerRate });
const late = (nonFilerRate: number): PriorRow => ({ reported: true, late: true, nonFilerRate });
const NOT_REPORTED: PriorRow = { reported: false, late: false, nonFilerRate: null };

/** The two years before FY 2025/2026, by start year and Commission slug. */
const PRIOR: Record<number, Record<string, PriorRow>> = {
  2024: {
    tsc: late(0.0391),
    psc: on(0.0312),
    parlsc: on(0.0105),
    npsc: on(0.0298),
    jsc: on(0.0377),
    cpsbnairobicity: on(0.152),
    cpsbmombasa: on(0.0351),
    cpsbnakuru: on(0.0322),
    cpsbkiambu: on(0.0518),
    cpsbmachakos: late(0.0402),
    cpsbuasingishu: on(0.0288),
    cpsbkwale: on(0.061),
    cpsbmandera: NOT_REPORTED,
    cpsbturkana: on(0.0734),
  },
  2023: {
    tsc: late(0.0425),
    cpsbnairobicity: on(0.1388),
    cpsbmandera: on(0.0912),
  },
};

let seed: CandidatesMockSeed | null = null;

/** Starts the mock over: `computed` candidates, `none`, or an `error` for every request. */
export function resetCandidatesMock(next: CandidatesMockSeed): void {
  seed = next;
}

function seedOf(): CandidatesMockSeed {
  seed ??= envSchema.shape.REPORTING_MOCK_CANDIDATES.catch('computed').parse(
    process.env.REPORTING_MOCK_CANDIDATES,
  );
  return seed;
}

const CANDIDATES_PATH = /^\/v1\/eacc\/national-reports\/(\d{4})\/candidates$/;

/** Whether `pathname` is the candidates endpoint this part of the mock answers. */
export function isCandidatesPath(pathname: string): boolean {
  return CANDIDATES_PATH.test(pathname);
}

export async function mockCandidatesFetch(request: Request): Promise<Response> {
  const caller = mockCallerOf(request);
  if (!caller.roles.includes('eacc-analyst') && !caller.roles.includes('eacc-supervisor')) {
    return problem(403, 'Only EACC analysts and supervisors see the pattern candidates.');
  }
  const fy = Number(CANDIDATES_PATH.exec(new URL(request.url).pathname)?.[1]);
  if (request.method !== 'GET') return problem(405, 'Method not allowed');
  await delay(700);
  if (seedOf() === 'error') return problem(503, 'The reporting service is unavailable');
  const aggregates = ncrMockAggregates(fy);
  if (!aggregates) {
    return problem(404, 'The national consolidated report for the year has not been built yet.');
  }
  return json(200, seedOf() === 'none' ? [] : patternCandidates(aggregates));
}

function delay(ms: number): Promise<void> {
  return process.env.VITEST ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}

const round = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places;

/** The candidates of the year's aggregates and the fixture's years before. */
function patternCandidates(aggregates: NationalAggregates): PatternCandidate[] {
  const fy = aggregates.fy;
  const key = (
    slug: string,
    name: 'nonFilerRate' | 'reportedLate' | 'reported' | 'expected' | 'clarificationRatio',
    year = fy,
  ) => aggregateKeyOf({ fy: year, scope: 'commission', slug, name } satisfies AggregateKey, fy);
  const rows = Object.keys(aggregates.byCommission)
    .sort()
    .map((slug) => ({ slug, figures: commissionFigures(aggregates, slug) }))
    .flatMap(({ slug, figures }) => (figures ? [{ slug, figures }] : []));
  const national = nationalFigures(aggregates);
  const candidates: { candidate: PatternCandidate; magnitude: number }[] = [];
  const add = (
    kind: PatternCandidate['kind'],
    slug: string,
    figure: string,
    values: PatternCandidate['values'],
    aggregateKeys: string[],
    magnitude: number,
  ) => {
    candidates.push({
      candidate: { id: `${kind}:${slug}:${figure}`, kind, subject: slug, values, aggregateKeys },
      magnitude,
    });
  };

  for (const { slug, figures } of rows) {
    const from = PRIOR[fy - 1]?.[slug]?.nonFilerRate ?? null;
    const to = figures.nonFilerRate;
    if (from === null || to === null) continue;
    const change = round(to - from, 4);
    const [low, high] = from < to ? [from, to] : [to, from];
    if (Math.abs(change) < THRESHOLDS.minPoints) continue;
    if (low > 0 && high / low < THRESHOLDS.rateChangeFactor) continue;
    add(
      'rate-change',
      slug,
      'nonFilerRate',
      { from, to, change, factor: from > 0 ? round(to / from, 2) : null },
      [key(slug, 'nonFilerRate', fy - 1), key(slug, 'nonFilerRate')],
      Math.abs(change),
    );
  }

  for (const { slug, figures } of rows) {
    const rate = figures.nonFilerRate;
    if (rate === null || rate <= THRESHOLDS.maxNonFilerRate) continue;
    add(
      'threshold-breach',
      slug,
      'nonFilerRate',
      { nonFilerRate: rate, threshold: THRESHOLDS.maxNonFilerRate },
      [key(slug, 'nonFilerRate')],
      rate,
    );
  }

  /** The years, from this one back, the Commission's row passes `test`. */
  const streak = (slug: string, now: boolean, test: (row: PriorRow) => boolean) => {
    if (!now) return [];
    const years = [fy];
    for (let year = fy - 1; ; year -= 1) {
      const row = PRIOR[year]?.[slug];
      if (!row || !test(row)) return years;
      years.push(year);
    }
  };

  for (const { slug, figures } of rows) {
    const years = streak(slug, figures.reportedLate === 1, (row) => row.late);
    if (years.length < THRESHOLDS.chronicLateYears) continue;
    add(
      'chronic-late-reporting',
      slug,
      'reportedLate',
      { years: years.length },
      years.map((year) => key(slug, 'reportedLate', year)),
      years.length,
    );
  }

  const nationalRatio = national.clarificationRatio;
  if (nationalRatio) {
    for (const { slug, figures } of rows) {
      const ratio = figures.clarificationRatio;
      if (ratio === null || ratio < nationalRatio * THRESHOLDS.clarificationRatioFactor) continue;
      const factor = round(ratio / nationalRatio, 2);
      add(
        'clarification-ratio-outlier',
        slug,
        'clarificationRatio',
        { clarificationRatio: ratio, nationalRatio, factor },
        [key(slug, 'clarificationRatio'), 'national.clarificationRatio'],
        factor,
      );
    }
  }

  const bandOf = (expected: number) =>
    THRESHOLDS.sizeBands.findLastIndex((from) => expected >= from);
  const reported = rows.filter((row) => row.figures.expected !== null);
  for (const { slug, figures } of reported) {
    const rate = figures.nonFilerRate;
    const band = bandOf(figures.expected ?? 0);
    const peers = reported.filter(
      (other) => other.slug !== slug && bandOf(other.figures.expected ?? 0) === band,
    );
    if (rate === null || peers.length < MIN_BAND_PEERS) continue;
    const peerRate = rateOf(
      peers.reduce((sum, peer) => sum + (peer.figures.nonFilers ?? 0), 0),
      peers.reduce((sum, peer) => sum + (peer.figures.expected ?? 0), 0),
    );
    if (peerRate === null || rate - peerRate < THRESHOLDS.minPoints) continue;
    if (peerRate > 0 && rate / peerRate < THRESHOLDS.sizeBandFactor) continue;
    const next = THRESHOLDS.sizeBands[band + 1];
    add(
      'size-band-outlier',
      slug,
      'nonFilerRate',
      {
        nonFilerRate: rate,
        peerNonFilerRate: peerRate,
        peers: peers.length,
        bandFrom: THRESHOLDS.sizeBands[band] ?? 0,
        bandTo: next === undefined ? null : next - 1,
      },
      [key(slug, 'nonFilerRate'), key(slug, 'expected')],
      rate - peerRate,
    );
  }

  for (const { slug, figures } of rows) {
    const years = streak(slug, figures.reported === 0, (row) => !row.reported);
    if (years.length === 0) continue;
    add(
      'non-reporting',
      slug,
      'reported',
      { years: years.length },
      years.map((year) => key(slug, 'reported', year)),
      years.length,
    );
  }

  const kinds: readonly string[] = [
    'rate-change',
    'threshold-breach',
    'chronic-late-reporting',
    'clarification-ratio-outlier',
    'size-band-outlier',
    'non-reporting',
  ];
  return candidates
    .sort(
      (a, b) =>
        kinds.indexOf(a.candidate.kind) - kinds.indexOf(b.candidate.kind) ||
        b.magnitude - a.magnitude ||
        (a.candidate.subject < b.candidate.subject ? -1 : 1),
    )
    .map(({ candidate }) => candidate);
}
