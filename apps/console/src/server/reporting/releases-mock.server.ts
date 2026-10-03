/**
 * The open-data releases part of the reporting mock (`mock.server.ts` hands it every
 * `/v1/eacc/open-data/releases` request): an in-memory stand-in for the reporting service's EACC
 * releases endpoints (reporting.yaml `listOpenDataReleasesEacc`, `buildOpenDataRelease`,
 * `getOpenDataReleaseEacc`), used when REPORTING_MOCK is set. It follows #491's rules
 * (`services/reporting/src/open-data`):
 *
 * - EACC analysts and supervisors only (403 for anyone else).
 * - A build makes the year's next version of its kind, as a `preview`, from the year's national
 *   consolidated report as last built (the NCR part of the mock), or, before it is built, from the
 *   live projections; its tables are suppressed as the service suppresses them
 *   (`releases-mock-tables.server.ts`). `fy-not-started` for a year after the current one; an
 *   annual build needs the approved NCR (`ncr-not-built`, `ncr-not-approved`) and no published
 *   annual release (`annual-release-published`). A retry with the same Idempotency-Key replays.
 * - When the year's NCR is approved, its annual release is published by the approver, as the
 *   release workflow does on `ncr.approved.v1`.
 *
 * REPORTING_MOCK_RELEASES picks the start: `history`, FY 2025/2026's mid-year snapshot v1
 * (published, then withdrawn by Esther Chebet) and v2 (published); `none`; `unavailable`, every
 * call 503; `reconciliation-failed`, the history with every build refused (409
 * `reconciliation-failed`, as a fault of the table builder would be).
 */
import { createHash } from 'node:crypto';

import { type Env, envSchema } from '../env.server';
import { isRecord, json, mockCallerOf, problem, readJson } from '../mock-http';
import { mockNcrCommissions, mockNcrSourceOf } from './ncr-mock.server';
import {
  buildReleaseTables,
  type ComplianceCounts,
  type TableFile,
  type TableFiles,
} from './releases-mock-tables.server';
import type {
  CommissionAggregate,
  NationalAggregates,
  OpenDataRelease,
  OpenDataReleaseDetail,
  Officer,
  SectionAggregate,
} from './types';

export type ReleasesMockSeed = Env['REPORTING_MOCK_RELEASES'];

const EACC_ROLES = ['eacc-analyst', 'eacc-supervisor'];
const PATH = '/v1/eacc/open-data/releases';
const FIRST_YEAR = 2025;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BRIAN: Officer = { subject: 'mock-brian-otieno', name: 'Brian Otieno' };
const ESTHER: Officer = { subject: 'mock-esther-chebet', name: 'Esther Chebet' };

type Source = OpenDataReleaseDetail['source'];

interface StoredRelease {
  release: OpenDataRelease;
  builtBy: Officer | null;
  source: Source;
  tables: TableFiles;
}

interface Store {
  seed: ReleasesMockSeed;
  releases: StoredRelease[];
  builds: Map<string, Response>;
  buildMs: number;
}

let store: Store | null = null;

/** Whether `pathname` is one of the endpoints this part of the mock answers. */
export function isReleasesPath(pathname: string): boolean {
  return pathname === PATH || pathname.startsWith(`${PATH}/`);
}

/** Starts the store over at `seed`; `buildMs` is how long a build takes outside tests. */
export function resetReleasesMock(
  seed: ReleasesMockSeed,
  { buildMs = 2500 }: { buildMs?: number } = {},
): void {
  store = { seed, releases: [], builds: new Map(), buildMs };
  if (seed === 'none') return;
  const midYear = midYearAggregates();
  const firstMidYear = midYearAggregates({ kirinyagaCountedTwice: true });
  if (!midYear || !firstMidYear) return;
  const source: Source = { kind: 'live-projections', nationalReportReference: null };
  store.releases.push(
    stored(
      {
        id: '0199c000-0000-7000-8000-000000000001',
        fy: 2025,
        kind: 'snapshot',
        version: 1,
        status: 'withdrawn',
        builtAt: '2026-02-16T07:02:00Z',
        publishedAt: '2026-02-16T07:05:00Z',
        publishedBy: ESTHER,
        withdrawnAt: '2026-02-19T09:30:00Z',
        withdrawnBy: ESTHER,
        withdrawnReason:
          "The Kirinyaga County Public Service Board's final declarations were counted twice. Version 2 corrects them.",
        manifestDocumentId: '0199c100-0000-7000-8000-000000000001',
        manifestVerificationId: 'ADL-7KQD-3TWM-6HXC-2RPA-9VNF-4E',
      },
      BRIAN,
      source,
      firstMidYear,
    ),
    stored(
      {
        id: '0199c000-0000-7000-8000-000000000002',
        fy: 2025,
        kind: 'snapshot',
        version: 2,
        status: 'published',
        builtAt: '2026-02-20T06:40:00Z',
        publishedAt: '2026-02-20T08:15:00Z',
        publishedBy: ESTHER,
        withdrawnAt: null,
        withdrawnBy: null,
        withdrawnReason: null,
        manifestDocumentId: '0199c100-0000-7000-8000-000000000002',
        manifestVerificationId: 'ADL-8KQD-3TWM-6HXC-2RPA-9VNF-4E',
      },
      BRIAN,
      source,
      midYear,
    ),
  );
}

function ensureSeeded(): Store {
  if (!store) resetReleasesMock(seedFromEnv());
  if (!store) throw new Error('The releases mock did not seed');
  return store;
}

function seedFromEnv(): ReleasesMockSeed {
  return envSchema.shape.REPORTING_MOCK_RELEASES.catch('history').parse(
    process.env.REPORTING_MOCK_RELEASES,
  );
}

/** Answers the reporting client's releases requests as the service would, from the store. */
export async function mockReleasesFetch(request: Request): Promise<Response> {
  const data = ensureSeeded();
  const url = new URL(request.url);
  const caller = mockCallerOf(request);
  if (!caller.roles.some((role) => EACC_ROLES.includes(role))) {
    return json(403, {
      type: 'about:blank',
      title: 'Forbidden',
      status: 403,
      detail: 'Only EACC analysts and supervisors work on open-data releases.',
    });
  }
  if (data.seed === 'unavailable') return problem(503, 'The reporting service is unavailable');
  publishAnnualOnApproval(data);

  if (url.pathname === PATH && request.method === 'GET') {
    return json(
      200,
      ordered(data.releases).map((each) => each.release),
    );
  }
  if (url.pathname === PATH && request.method === 'POST') {
    return build(data, request, {
      subject: caller.subject ?? 'unknown',
      name: caller.name ?? caller.subject ?? 'unknown',
    });
  }
  const match = /^\/v1\/eacc\/open-data\/releases\/([^/]+)$/.exec(url.pathname);
  if (match?.[1] && request.method === 'GET') {
    if (!UUID.test(match[1])) return problem(400, 'The release id is not a UUID');
    const found = data.releases.find((each) => each.release.id === match[1]);
    if (!found) return problem(404, 'Not found');
    const detail: OpenDataReleaseDetail = {
      release: found.release,
      builtBy: found.builtBy,
      source: found.source,
      tables: found.tables,
    };
    return json(200, detail);
  }
  return problem(404, 'Not found');
}

async function build(data: Store, request: Request, officer: Officer): Promise<Response> {
  const key = request.headers.get('idempotency-key');
  if (!key) return problem(400, 'Idempotency-Key missing');
  const replay = data.builds.get(key);
  if (replay) return replay.clone();
  const body = await readJson(request);
  const fy = isRecord(body) ? body.fy : undefined;
  const kind = isRecord(body) ? (body.kind ?? 'snapshot') : undefined;
  if (
    typeof fy !== 'number' ||
    !Number.isInteger(fy) ||
    fy < FIRST_YEAR ||
    (kind !== 'snapshot' && kind !== 'annual')
  ) {
    return json(400, { type: 'about:blank', title: 'Bad Request', status: 400 });
  }
  if (fy > financialYearNow()) {
    return conflict('fy-not-started', 'The financial year has not started.');
  }
  const ncr = mockNcrSourceOf(fy);
  let source: Source;
  let aggregates: NationalAggregates;
  if (kind === 'annual') {
    if (!ncr?.built) return conflict('ncr-not-built', 'The year has no national report yet.');
    if (!ncr.reference) {
      return conflict('ncr-not-approved', 'The national report is not approved yet.');
    }
    if (
      data.releases.some(
        (each) =>
          each.release.fy === fy &&
          each.release.kind === 'annual' &&
          each.release.status === 'published',
      )
    ) {
      return conflict(
        'annual-release-published',
        'An annual release of the year is published: withdraw it first.',
      );
    }
    source = { kind: 'national-report', nationalReportReference: ncr.reference };
    aggregates = ncr.aggregates;
  } else if (ncr?.built) {
    source = { kind: 'national-report', nationalReportReference: ncr.reference };
    aggregates = ncr.aggregates;
  } else {
    source = { kind: 'live-projections', nationalReportReference: null };
    aggregates = fy === FIRST_YEAR && ncr ? ncr.aggregates : liveAggregates(fy);
  }
  await delay(data.buildMs);
  if (data.seed === 'reconciliation-failed') {
    return json(409, {
      type: 'about:blank',
      title: 'Conflict',
      status: 409,
      code: 'reconciliation-failed',
      detail: 'The tables do not reconcile with their source.',
      mismatches: ['national.all.declared', 'national.final.declared'],
    });
  }
  const version =
    Math.max(
      0,
      ...data.releases
        .filter((each) => each.release.fy === fy && each.release.kind === kind)
        .map((each) => each.release.version),
    ) + 1;
  const release = stored(
    {
      id: crypto.randomUUID(),
      fy,
      kind,
      version,
      status: 'preview',
      builtAt: new Date().toISOString(),
      publishedAt: null,
      publishedBy: null,
      withdrawnAt: null,
      withdrawnBy: null,
      withdrawnReason: null,
      manifestDocumentId: null,
      manifestVerificationId: null,
    },
    officer,
    source,
    aggregates,
  );
  data.releases.push(release);
  const response = json(202, release.release);
  data.builds.set(key, response.clone());
  return response;
}

/** The release workflow on `ncr.approved.v1`: the year's annual release, published. */
function publishAnnualOnApproval(data: Store): void {
  const ncr = mockNcrSourceOf(FIRST_YEAR);
  if (!ncr?.reference || !ncr.approvedAt) return;
  if (
    data.releases.some((each) => each.release.fy === FIRST_YEAR && each.release.kind === 'annual')
  ) {
    return;
  }
  data.releases.push(
    stored(
      {
        id: '0199c000-0000-7000-8000-000000000003',
        fy: FIRST_YEAR,
        kind: 'annual',
        version: 1,
        status: 'published',
        builtAt: ncr.approvedAt,
        publishedAt: ncr.approvedAt,
        publishedBy: ncr.approver,
        withdrawnAt: null,
        withdrawnBy: null,
        withdrawnReason: null,
        manifestDocumentId: '0199c100-0000-7000-8000-000000000003',
        manifestVerificationId: 'ADL-9KQD-3TWM-6HXC-2RPA-9VNF-4E',
      },
      null,
      { kind: 'national-report', nationalReportReference: ncr.reference },
      ncr.aggregates,
    ),
  );
}

/** The latest year first, then by kind, the latest version first (as the service lists them). */
function ordered(releases: readonly StoredRelease[]): StoredRelease[] {
  return [...releases].sort(
    (a, b) =>
      b.release.fy - a.release.fy ||
      a.release.kind.localeCompare(b.release.kind) ||
      b.release.version - a.release.version,
  );
}

function stored(
  release: Omit<OpenDataRelease, 'tables'>,
  builtBy: Officer | null,
  source: Source,
  aggregates: NationalAggregates,
): StoredRelease {
  const { tables } = buildReleaseTables(aggregates, complianceOf(aggregates));
  return {
    release: {
      ...release,
      tables: Object.values(tables).map((table) => ({
        table: table.table,
        rows: table.rows.length,
        sha256Json: sha256(JSON.stringify(table)),
        sha256Csv: sha256(csvOf(table)),
      })),
    },
    builtBy,
    source,
    tables,
  };
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function csvOf(table: TableFile): string {
  const columns = table.columns.map((c) => (c === 'suppressed' ? '_suppressed' : c));
  const lines = table.rows.map((row) =>
    table.columns.map((column) => (row[column] === null ? '' : String(row[column]))).join(','),
  );
  return [columns.join(','), ...lines].join('\r\n');
}

/** Projection counts per Commission, in proportion to what it filed. */
function complianceOf(aggregates: NationalAggregates): Record<string, ComplianceCounts> {
  return Object.fromEntries(
    Object.entries(aggregates.byCommission).flatMap(([slug, row]) => {
      if (!row.initial || !row.biennial || !row.final) return [];
      const declared = row.initial.declared + row.biennial.declared + row.final.declared;
      const missing = row.initial.notDeclared + row.biennial.notDeclared + row.final.notDeclared;
      const share = (count: number, part: number) => Math.round(count * part);
      return [
        [
          slug,
          {
            determinationsCompliant: share(declared, 0.31),
            determinationsNonCompliant: share(declared, 0.012),
            determinationsFurtherAction: share(declared, 0.006),
            clarificationsResolved: share(row.clarifications ?? 0, 0.82),
            actionsNoticeToComply: share(missing, 0.6),
            actionsWarning: share(missing, 0.22),
            actionsSalaryStoppage: share(missing, 0.05),
            actionsDisciplinaryReferral: share(missing, 0.02),
            referrals: share(missing, 0.01),
          },
        ],
      ];
    }),
  );
}

const section = (expected: number, declared: number): SectionAggregate => ({
  expected,
  declared,
  notDeclared: Math.max(0, expected - declared),
  rate: expected > 0 ? Math.round((declared / expected) * 10_000) / 10_000 : null,
});

/**
 * FY 2025/2026 as it stood in February 2026: every Commission's counts so far, none reported.
 * `kirinyagaCountedTwice` is version 1's fault: the Kirinyaga board's final declarations counted
 * twice.
 */
function midYearAggregates({ kirinyagaCountedTwice = false } = {}): NationalAggregates | null {
  const year = mockNcrSourceOf(FIRST_YEAR)?.aggregates;
  if (!year) return null;
  const midYear = (counts: SectionAggregate | null) =>
    counts ? section(counts.expected, Math.round(counts.declared * 0.61)) : null;
  // The Commissions that had not reported by the NCR's build count from their own rosters.
  const unreported: Record<string, LiveCounts> = {
    cpsb045: {
      initial: section(402, 233),
      biennial: section(5530, 3152),
      final: section(7, 4),
      clarifications: 1,
    },
    cpsb042: {
      initial: section(512, 301),
      biennial: section(6400, 3720),
      final: section(9, 6),
      clarifications: 2,
    },
    jsc: {
      initial: section(310, 181),
      biennial: section(5800, 3410),
      final: section(90, 52),
      clarifications: 3,
    },
    psc: {
      initial: section(214, 126),
      biennial: section(2890, 1702),
      final: section(96, 55),
      clarifications: 2,
    },
  };
  return aggregatesOf(
    FIRST_YEAR,
    Object.fromEntries(
      Object.entries(year.byCommission).map(([slug, row]) => {
        const own = unreported[slug];
        const initial = midYear(row.initial);
        const biennial = midYear(row.biennial);
        const counted = midYear(row.final);
        // Version 1 counted the Kirinyaga board's final declarations twice.
        const final =
          kirinyagaCountedTwice && slug === 'cpsb020' && counted
            ? section(counted.expected, Math.min(counted.expected, counted.declared * 2))
            : counted;
        return [
          slug,
          own ?? {
            initial: initial ?? section(0, 0),
            biennial: biennial ?? section(0, 0),
            final: final ?? section(0, 0),
            clarifications: row.clarifications ?? 0,
          },
        ];
      }),
    ),
  );
}

/**
 * The current year's live projections: the Form M counts each Commission would compile now,
 * three months in. No biennial cycle falls in an odd year's first months, and small boards
 * have only a handful of officers in a cycle, so their figures are suppressed.
 */
const LIVE_2026: Record<string, [initial: [number, number], final: [number, number], number]> = {
  tsc: [[3120, 2711], [2404, 2210], 96],
  psc: [[72, 61], [31, 29], 5],
  parlsc: [[33, 30], [12, 12], 1],
  npsc: [[2015, 1822], [790, 701], 31],
  jsc: [[388, 361], [70, 66], 4],
  cpsb047: [[604, 498], [136, 102], 22],
  cpsb001: [[205, 188], [16, 15], 3],
  cpsb032: [[170, 158], [44, 41], 2],
  cpsb022: [[151, 140], [49, 33], 4],
  cpsb039: [[128, 117], [7, 6], 1],
  cpsb027: [[133, 125], [40, 38], 2],
  cpsb020: [[84, 79], [4, 4], 1],
  cpsb045: [[61, 49], [3, 2], 0],
  cpsb042: [[8, 7], [22, 19], 0],
  cpsb012: [[118, 109], [29, 27], 2],
};

function liveAggregates(fy: number): NationalAggregates {
  return aggregatesOf(
    fy,
    Object.fromEntries(
      Object.entries(LIVE_2026).map(([slug, [initial, final, clarifications]]) => [
        slug,
        {
          initial: section(...initial),
          biennial: section(0, 0),
          final: section(...final),
          clarifications,
        },
      ]),
    ),
  );
}

interface LiveCounts {
  initial: SectionAggregate;
  biennial: SectionAggregate;
  final: SectionAggregate;
  clarifications: number;
}

/** Aggregates in the NCR's shape from live counts: every Commission counted, none reported. */
function aggregatesOf(fy: number, counts: Record<string, LiveCounts>): NationalAggregates {
  const byCommission: Record<string, CommissionAggregate> = {};
  const totals = { initial: section(0, 0), biennial: section(0, 0), final: section(0, 0) };
  let clarifications = 0;
  for (const { slug, name } of mockNcrCommissions(fy)) {
    const row = counts[slug];
    if (!row) continue;
    for (const key of ['initial', 'biennial', 'final'] as const) {
      totals[key] = section(
        totals[key].expected + row[key].expected,
        totals[key].declared + row[key].declared,
      );
    }
    clarifications += row.clarifications;
    byCommission[slug] = {
      name,
      status: 'not-reported',
      reportId: null,
      reference: null,
      submittedAt: null,
      initial: row.initial,
      biennial: { ...row.biennial, noCycleInPeriod: row.biennial.expected === 0 },
      final: row.final,
      clarifications: row.clarifications,
      accessRequests: null,
    };
  }
  const commissions = mockNcrCommissions(fy).length;
  return {
    fy,
    reporting: { commissions, reported: 0, onTime: 0, late: 0, notReported: commissions, rate: 0 },
    national: {
      ...totals,
      all: section(
        totals.initial.expected + totals.biennial.expected + totals.final.expected,
        totals.initial.declared + totals.biennial.declared + totals.final.declared,
      ),
      clarifications,
      accessRequests: { received: 0, granted: 0, declined: 0 },
    },
    byCommission,
  };
}

/** The financial year (by its start year) today falls in, in Nairobi (UTC+3). */
function financialYearNow(): number {
  const nairobi = new Date(Date.now() + 3 * 60 * 60 * 1000);
  return nairobi.getUTCMonth() >= 6 ? nairobi.getUTCFullYear() : nairobi.getUTCFullYear() - 1;
}

function conflict(code: string, detail: string) {
  return json(409, { type: 'about:blank', title: 'Conflict', status: 409, detail, code });
}

function delay(ms: number): Promise<void> {
  return process.env.VITEST ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}
