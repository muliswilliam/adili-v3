import { COMMISSION_ADMIN, FORM_M_ROLES } from '@adili/roles';

import { type Env, env } from '../env.server';
import { json, mockCallerOf, problem } from '../mock-http';
import { ACCESS_REQUEST_FIGURES, COMPLIANCE_FIGURES } from '../open-data-figures';
import type { components } from './api.gen';
import { MOCK_PSC } from './mock-commissions';

type OpenDataRelease = components['schemas']['OpenDataRelease'];

/**
 * The reporting service's Commission open-data preview (spec 09b S6,
 * `getCommissionOpenDataPreview`), in memory, as one part of the reporting mock
 * (`mock.server.ts`): a release's Commission tables as the service stores them, for four
 * Commissions, filtered to the caller's as the service does. Its rules follow #491: 404 to anyone
 * but the Commission's Form M roles (supervisor, commission-admin, reporting officer), 403 to
 * those but its commission-admin, 404 while no release is built, 503 when object storage is down.
 * Which release it answers with is `REPORTING_MOCK_OPEN_DATA`, or what `resetReportingMock` sets.
 */

export type OpenDataMockScenario = Env['REPORTING_MOCK_OPEN_DATA'];

let scenario: OpenDataMockScenario | null = null;

/** What the mock answers; null for `REPORTING_MOCK_OPEN_DATA`. `resetReportingMock` sets it. */
export function setOpenDataMockScenario(next: OpenDataMockScenario | null): void {
  scenario = next;
}

function current(): OpenDataMockScenario {
  return scenario ?? env().REPORTING_MOCK_OPEN_DATA;
}

type Row = Record<string, string | number | boolean | null>;
type Section = 'initial' | 'biennial' | 'final';
const SECTIONS: readonly Section[] = ['initial', 'biennial', 'final'];

const NAMES: Record<string, string> = {
  [MOCK_PSC.slug]: MOCK_PSC.name,
  tsc: 'Teachers Service Commission',
  jsc: 'Judicial Service Commission',
  nlc: 'National Land Commission',
};

const nameOf = (commission: string) => NAMES[commission] ?? commission;

/** Figures over fewer officers than this are suppressed (ADR 0009). */
const THRESHOLD = 10;

const rate = (filed: number, expected: number) =>
  expected > 0 ? Math.round((filed / expected) * 10_000) / 10_000 : null;

/** One Commission's filing for the year: each cycle's [expected, filed]; none if not reported. */
interface Filing {
  commission: string;
  reportStatus: 'not-reported' | 'submitted-on-time' | 'submitted-late';
  /** A cycle left out had nothing expected of it. */
  cycles: Partial<Record<Section, [number, number]>>;
}

interface Figure {
  value: number;
  officers: number;
  /** Cells are hidden before row and column totals, those before the grand total. */
  rank: 0 | 1 | 2;
  order: number;
  suppressed: boolean;
}

/**
 * The filing table (Commission x cycle) suppressed as #491's `suppressTable` does: a figure over
 * fewer than 10 officers is hidden, and while any row or column (totals included) holds exactly
 * one hidden figure, the next one by preference (cells before totals, then the smallest value,
 * then the fewest officers) is hidden too, so no hidden figure can be worked out by subtraction.
 * A figure over no officers is never hidden. Totals are true sums. Commissions that have not
 * reported count nowhere. Returns, per reported Commission, its hidden cycles (`all`: its total).
 */
function suppressFiling(filings: readonly Filing[]): Map<string, Set<Section | 'all'>> {
  const reported = filings.filter((filing) => filing.reportStatus !== 'not-reported');
  let order = 0;
  const figure = (value: number, officers: number, rank: Figure['rank']): Figure => ({
    value,
    officers,
    rank,
    order: (order += 1),
    suppressed: officers > 0 && officers < THRESHOLD,
  });
  const sum = (members: readonly Figure[], rank: Figure['rank']) =>
    figure(
      members.reduce((total, f) => total + f.value, 0),
      members.reduce((total, f) => total + f.officers, 0),
      rank,
    );
  const cells = reported.map((filing) =>
    SECTIONS.map((section) => {
      const [expected, filed] = filing.cycles[section] ?? [0, 0];
      return figure(filed, expected, 0);
    }),
  );
  const rows = cells.map((row) => ({ members: row, total: sum(row, 1) }));
  const columns = SECTIONS.map((_, c) => {
    const members = cells.flatMap((row) => row.slice(c, c + 1));
    return { members, total: sum(members, 1) };
  });
  const rowTotals = rows.map((row) => row.total);
  const columnTotals = columns.map((column) => column.total);
  const grand = sum(rowTotals, 2);
  const lines: Figure[][] = [
    ...[...rows, ...columns].map((line) => [...line.members, line.total]),
    [...columnTotals, grand],
    [...rowTotals, grand],
  ];
  for (;;) {
    const next = lines
      .find((line) => line.filter((f) => f.suppressed).length === 1)
      ?.filter((f) => !f.suppressed && f.officers > 0)
      .sort(
        (a, b) =>
          a.rank - b.rank || a.value - b.value || a.officers - b.officers || a.order - b.order,
      )[0];
    if (next === undefined) break;
    next.suppressed = true;
  }
  return new Map(
    reported.map((filing, r) => [
      filing.commission,
      new Set<Section | 'all'>([
        ...SECTIONS.filter((_, c) => cells[r]?.[c]?.suppressed),
        ...(rowTotals[r]?.suppressed ? (['all'] as const) : []),
      ]),
    ]),
  );
}

/** `filing-by-commission`'s rows: each Commission's cycles and its `all` total, as released. */
function filingRows(filings: readonly Filing[]): Row[] {
  const hidden = suppressFiling(filings);
  return filings.flatMap(({ commission, reportStatus, cycles }) => {
    const base = { commission, commissionName: nameOf(commission), reportStatus };
    const row = (cycle: Section | 'all', [expected, filed]: [number, number]): Row => {
      const suppressed = hidden.get(commission)?.has(cycle) ?? false;
      return reportStatus === 'not-reported' || suppressed
        ? {
            ...base,
            cycle,
            expected: null,
            filed: null,
            nonFilers: null,
            filingRate: null,
            suppressed,
          }
        : {
            ...base,
            cycle,
            expected,
            filed,
            nonFilers: expected - filed,
            filingRate: rate(filed, expected),
            suppressed: false,
          };
    };
    const shown = Object.values(cycles);
    const total: [number, number] = [
      shown.reduce((sum, pair) => sum + pair[0], 0),
      shown.reduce((sum, pair) => sum + pair[1], 0),
    ];
    return [
      ...SECTIONS.map((section) => row(section, cycles[section] ?? [0, 0])),
      row('all', total),
    ];
  });
}

/**
 * A Commission's compliance counts; null figures when it has not reported. Suppressed in the
 * service by the Commission's officers (under 10): none of the mock's Commissions is that small.
 */
function compliance(commission: string, values: readonly number[] | null): Row {
  return {
    commission,
    commissionName: nameOf(commission),
    ...Object.fromEntries(
      COMPLIANCE_FIGURES.map((column, index) => [column, values ? (values[index] ?? 0) : null]),
    ),
    suppressed: false,
  };
}

/** Access requests are not collected yet (spec 10): every figure null, nothing suppressed. */
function accessRequests(commission: string): Row {
  return {
    commission,
    commissionName: nameOf(commission),
    ...Object.fromEntries(ACCESS_REQUEST_FIGURES.map((figure) => [figure, null])),
    suppressed: false,
  };
}

interface MockRelease {
  release: OpenDataRelease;
  tables: Record<'filing-by-commission' | 'compliance-by-commission' | 'access-requests', Row[]>;
}

const TABLE_HASH = '0'.repeat(64);

function release(
  fields: Pick<OpenDataRelease, 'id' | 'fy' | 'kind' | 'status' | 'builtAt'> & {
    publishedAt: string | null;
  },
): OpenDataRelease {
  const published = fields.status === 'published';
  return {
    version: 1,
    publishedBy: published ? { subject: 'user-eacc-supervisor', name: 'Grace Achieng' } : null,
    withdrawnAt: null,
    withdrawnBy: null,
    withdrawnReason: null,
    manifestDocumentId: published ? '0190f3a2-0000-7000-8000-00000000d025' : null,
    manifestVerificationId: published ? 'K7Q2-M9XD-4TPA' : null,
    tables: (
      [
        'filing-by-commission',
        'compliance-by-commission',
        'by-entity-type',
        'by-cycle',
        'access-requests',
        'national-totals',
      ] as const
    ).map((table) => ({ table, rows: 16, sha256Json: TABLE_HASH, sha256Csv: TABLE_HASH })),
    ...fields,
  };
}

const COMMISSIONS = ['jsc', 'nlc', MOCK_PSC.slug, 'tsc'];

/**
 * The latest published release. TSC's final cycle counts fewer than 10 officers: with it, its
 * initial cycle and JSC's final and initial ones are hidden, so neither TSC's row nor the final
 * column gives it away; PSC's figures are all shown.
 */
const PUBLISHED: MockRelease = {
  release: release({
    id: '0190f3a2-0000-7000-8000-00000000a025',
    fy: 2025,
    kind: 'annual',
    status: 'published',
    builtAt: '2026-09-18T06:40:00.000Z',
    publishedAt: '2026-09-18T07:05:00.000Z',
  }),
  tables: {
    'filing-by-commission': filingRows([
      {
        commission: 'jsc',
        reportStatus: 'submitted-on-time',
        cycles: { initial: [310, 296], biennial: [2650, 2588], final: [45, 41] },
      },
      { commission: 'nlc', reportStatus: 'not-reported', cycles: {} },
      {
        commission: MOCK_PSC.slug,
        reportStatus: 'submitted-on-time',
        cycles: { initial: [2920, 2808], biennial: [46480, 45210], final: [912, 861] },
      },
      {
        commission: 'tsc',
        reportStatus: 'submitted-late',
        cycles: { initial: [8104, 7790], biennial: [301220, 290415], final: [7, 4] },
      },
    ]),
    'compliance-by-commission': [
      compliance('jsc', [2730, 98, 61, 140, 122, 77, 21, 5, 2, 9]),
      compliance('nlc', null),
      compliance(MOCK_PSC.slug, [16054, 727, 484, 402, 329, 1173, 347, 94, 25, 61]),
      compliance('tsc', [88210, 3120, 1904, 2210, 1980, 4012, 1250, 301, 88, 140]),
    ],
    'access-requests': COMMISSIONS.map(accessRequests),
  },
};

/**
 * A mid-year snapshot built since, an even year (no biennial cycle). PSC's final cycle counts
 * fewer than 10 officers: with it, its initial cycle and JSC's final and initial ones are hidden;
 * PSC's total stays, a true sum that no longer gives either cycle away.
 */
const PREVIEW: MockRelease = {
  release: release({
    id: '0190f3a2-0000-7000-8000-00000000b026',
    fy: 2026,
    kind: 'snapshot',
    status: 'preview',
    builtAt: '2026-09-26T09:12:00.000Z',
    publishedAt: null,
  }),
  tables: {
    'filing-by-commission': filingRows([
      {
        commission: 'jsc',
        reportStatus: 'submitted-on-time',
        cycles: { initial: [120, 110], final: [30, 28] },
      },
      { commission: 'nlc', reportStatus: 'not-reported', cycles: {} },
      {
        commission: MOCK_PSC.slug,
        reportStatus: 'submitted-on-time',
        cycles: { initial: [655, 596], final: [8, 6] },
      },
      {
        commission: 'tsc',
        reportStatus: 'submitted-on-time',
        cycles: { initial: [2210, 2105], final: [640, 601] },
      },
    ]),
    'compliance-by-commission': [
      compliance('jsc', [96, 4, 2, 7, 5, 3, 1, 0, 0, 0]),
      compliance('nlc', null),
      compliance(MOCK_PSC.slug, [254, 12, 7, 31, 22, 28, 9, 2, 0, 3]),
      compliance('tsc', [1904, 61, 40, 88, 52, 70, 18, 4, 1, 3]),
    ],
    'access-requests': COMMISSIONS.map(accessRequests),
  },
};

/** Answers `GET /v1/commissions/{slug}/open-data/preview`; null for any other request. */
export function mockOpenDataFetch(request: Request): Response | null {
  const path = new URL(request.url).pathname;
  const match = /^\/v1\/commissions\/([^/]+)\/open-data\/preview$/.exec(path);
  if (!match || request.method !== 'GET') return null;
  const slug = decodeURIComponent(match[1] ?? '');
  const caller = mockCallerOf(request);
  const formM = caller.roles.some((role) => (FORM_M_ROLES as readonly string[]).includes(role));
  if (caller.tenant !== slug || !formM) return problem(404, 'Not found');
  if (!caller.roles.includes(COMMISSION_ADMIN)) return problem(403, 'Forbidden');
  const answer = current();
  if (answer === 'none') return problem(404, 'Not found');
  if (answer === 'unavailable') return problem(503, 'Upstream service unavailable');
  const shown = answer === 'preview' ? PREVIEW : PUBLISHED;
  return json(200, {
    release: shown.release,
    tables: Object.fromEntries(
      Object.entries(shown.tables).map(([table, rows]) => [
        table,
        rows.filter((row) => row.commission === slug),
      ]),
    ),
  });
}
