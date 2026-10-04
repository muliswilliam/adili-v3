/**
 * The pattern candidates part of the reporting mock (`ncr-mock.server.ts` hands it
 * `GET /v1/eacc/national-reports/{fy}/candidates`, reporting.yaml `getNationalReportCandidates`):
 * the year's notable patterns computed from its report as last built (`ncr-mock.server.ts`) and a
 * fixture of the two years before, at the service's default thresholds, by its rules
 * (`services/reporting/src/national-reports/candidates.ts`):
 *
 * - `rate-change`: the nation's or a Commission's non-filer rate at least doubled or halved, and by
 *   2 points, since last year;
 * - `threshold-breach`: the nation's or a Commission's non-filer rate above 10%;
 * - `chronic-late-reporting`: a report late in each of the last three years;
 * - `clarification-ratio-outlier`: clarifications per declaration twice the national ratio;
 * - `size-band-outlier`: a non-filer rate twice that of the other Commissions of its size band
 *   (under 100, 100 to 999, 1,000 officers expected and over), with two peers at least;
 * - `non-reporting`: no report this year, with the years before without one.
 *
 * Ordered by kind, the largest first, then the nation, then slug. For FY 2025/2026, on the intake
 * mock's day (`mock.server.ts`), that is nine: the national non-filer rate up from 2.9% and
 * Nairobi City's up from 15.2%; Nairobi City above the threshold and its size band; the TSC late
 * three years running; the Judicial Service Commission without a report two years, Kisumu, Kisii
 * and the Public Service Commission (its Form M still a draft) this year. The intake mock carries
 * no clarification counts, so no clarification outlier. EACC analysts and supervisors only (403),
 * 404 before the year is built.
 * REPORTING_MOCK_CANDIDATES `none` answers no candidates, `error` a 503.
 */
import {
  aggregateKeyOf,
  type AggregateKey,
  commissionFigures,
  nationalFigures,
  rateOf,
  NATIONAL_SUBJECT,
} from './aggregate-keys';
import { type Env, envSchema } from '../env.server';
import { json, mockCallerOf, problem } from '../mock-http';
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

/** The two years before FY 2025/2026, by start year and Commission slug (the intake mock's). */
const PRIOR: Record<number, Record<string, PriorRow>> = {
  2024: {
    cpsb001: on(0.0362),
    cpsb012: on(0.0241),
    cpsb020: late(0.0505),
    cpsb022: on(0.0518),
    cpsb027: on(0.0288),
    cpsb032: on(0.0322),
    cpsb039: on(0.0301),
    cpsb042: on(0.061),
    cpsb045: on(0.0734),
    cpsb047: on(0.152),
    jsc: NOT_REPORTED,
    npsc: on(0.0298),
    parlsc: on(0.0105),
    psc: on(0.0312),
    tsc: late(0.0391),
  },
  2023: {
    cpsb047: on(0.1388),
    jsc: on(0.0377),
    tsc: late(0.0425),
  },
};

/** The nation's non-filer rate in the years before, by start year. */
const PRIOR_NATIONAL_NON_FILER_RATE: Record<number, number> = { 2024: 0.0294, 2023: 0.0311 };

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

/**
 * Answers the candidates of the report the NCR mock part (which hands this the request) has
 * built for the year: `aggregates`, or null before its first build.
 */
export async function mockCandidatesFetch(
  request: Request,
  aggregatesOf: (fy: number) => NationalAggregates | null,
): Promise<Response> {
  const caller = mockCallerOf(request);
  if (!caller.roles.includes('eacc-analyst') && !caller.roles.includes('eacc-supervisor')) {
    return problem(403, 'Only EACC analysts and supervisors see the pattern candidates.');
  }
  const fy = Number(CANDIDATES_PATH.exec(new URL(request.url).pathname)?.[1]);
  if (request.method !== 'GET') return problem(405, 'Method not allowed');
  await delay(700);
  if (seedOf() === 'error') return problem(503, 'The reporting service is unavailable');
  const aggregates = aggregatesOf(fy);
  if (!aggregates) {
    return problem(404, 'The national consolidated report for the year has not been built yet.');
  }
  return json(200, seedOf() === 'none' ? [] : patternCandidates(aggregates));
}

/**
 * The year's candidates as this mock answers them (none under `none`), for the narrative draft
 * part of the mock, whose findings narrate them.
 */
export function mockCandidatesOf(aggregates: NationalAggregates): PatternCandidate[] {
  return seedOf() === 'computed' ? patternCandidates(aggregates) : [];
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

  // The nation's non-filer rate and each Commission's, with the year before's and their keys.
  const nonFilerRates = [
    {
      subject: NATIONAL_SUBJECT,
      rate: national.nonFilerRate,
      before: PRIOR_NATIONAL_NON_FILER_RATE[fy - 1] ?? null,
      keyOf: (year: number) =>
        aggregateKeyOf({ fy: year, scope: 'national', name: 'nonFilerRate' }, fy),
    },
    ...rows.map(({ slug, figures }) => ({
      subject: slug,
      rate: figures.nonFilerRate,
      before: PRIOR[fy - 1]?.[slug]?.nonFilerRate ?? null,
      keyOf: (year: number) => key(slug, 'nonFilerRate', year),
    })),
  ];

  for (const { subject, rate: to, before: from, keyOf } of nonFilerRates) {
    if (from === null || to === null) continue;
    const change = round(to - from, 4);
    const [low, high] = from < to ? [from, to] : [to, from];
    if (Math.abs(change) < THRESHOLDS.minPoints) continue;
    if (low > 0 && high / low < THRESHOLDS.rateChangeFactor) continue;
    add(
      'rate-change',
      subject,
      'nonFilerRate',
      { from, to, change, factor: from > 0 ? round(to / from, 2) : null },
      [keyOf(fy - 1), keyOf(fy)],
      Math.abs(change),
    );
  }

  for (const { subject, rate, keyOf } of nonFilerRates) {
    if (rate === null || rate <= THRESHOLDS.maxNonFilerRate) continue;
    add(
      'threshold-breach',
      subject,
      'nonFilerRate',
      { nonFilerRate: rate, threshold: THRESHOLDS.maxNonFilerRate },
      [keyOf(fy)],
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
        // The nation before Commissions on a tie, then by slug.
        Number(b.candidate.subject === NATIONAL_SUBJECT) -
          Number(a.candidate.subject === NATIONAL_SUBJECT) ||
        (a.candidate.subject < b.candidate.subject ? -1 : 1),
    )
    .map(({ candidate }) => candidate);
}
