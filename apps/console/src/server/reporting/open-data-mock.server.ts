import { COMMISSION_ADMIN } from '@adili/roles';
import createClient from 'openapi-fetch';

import { env } from '../env.server';
import { json, mockCallerOf, problem, unsignedMockToken } from '../mock-http';
import type { components, paths } from './api.gen';

type OpenDataRelease = components['schemas']['OpenDataRelease'];

/**
 * The reporting service's Commission open-data preview (spec 09b S6,
 * `getCommissionOpenDataPreview`), in memory: a release's Commission tables as the service stores
 * them, for three Commissions, filtered to the caller's as the service does. Its rules follow
 * #491: anyone not of the Commission 404, its other staff 403, 404 while no release is built, 503
 * when object storage is down. Which release it answers with is `REPORTING_MOCK_OPEN_DATA`.
 */

export type OpenDataMockScenario = 'published' | 'preview' | 'none' | 'unavailable';

let scenario: OpenDataMockScenario | null = null;

/** Sets what the mock answers; tests call it before each case. */
export function resetOpenDataMock(next: OpenDataMockScenario): void {
  scenario = next;
}

function current(): OpenDataMockScenario {
  scenario ??= env().REPORTING_MOCK_OPEN_DATA;
  return scenario;
}

type Row = Record<string, string | number | boolean | null>;
type Cycle = 'initial' | 'biennial' | 'final' | 'all';

const NAMES: Record<string, string> = {
  psc: 'Public Service Commission',
  tsc: 'Teachers Service Commission',
  jsc: 'Judicial Service Commission',
};

const rate = (filed: number, expected: number) =>
  expected > 0 ? Math.round((filed / expected) * 10_000) / 10_000 : null;

/** One Commission's filing rows: its cycles' [expected, filed] (null: suppressed) and the total. */
function filing(
  commission: string,
  reportStatus: 'not-reported' | 'submitted-on-time' | 'submitted-late',
  cycles: Partial<Record<Exclude<Cycle, 'all'>, [number, number] | null>>,
): Row[] {
  const base = { commission, commissionName: NAMES[commission] ?? commission, reportStatus };
  if (reportStatus === 'not-reported') {
    return (['initial', 'biennial', 'final', 'all'] as const).map((cycle) => ({
      ...base,
      cycle,
      expected: null,
      filed: null,
      nonFilers: null,
      filingRate: null,
      suppressed: false,
    }));
  }
  const figures = (cycle: Cycle, pair: [number, number] | null | undefined): Row =>
    pair === null
      ? {
          ...base,
          cycle,
          expected: null,
          filed: null,
          nonFilers: null,
          filingRate: null,
          suppressed: true,
        }
      : {
          ...base,
          cycle,
          expected: pair?.[0] ?? 0,
          filed: pair?.[1] ?? 0,
          nonFilers: (pair?.[0] ?? 0) - (pair?.[1] ?? 0),
          filingRate: pair ? rate(pair[1], pair[0]) : null,
          suppressed: false,
        };
  const sections = (['initial', 'biennial', 'final'] as const).map((cycle) =>
    figures(cycle, cycles[cycle]),
  );
  // The service publishes totals as true sums, suppressed cycles included; the mock has no hidden
  // figures, so its totals add up the shown cycles only.
  const known = Object.values(cycles).filter((pair): pair is [number, number] => pair != null);
  const total: [number, number] = [
    known.reduce((sum, pair) => sum + pair[0], 0),
    known.reduce((sum, pair) => sum + pair[1], 0),
  ];
  return [...sections, figures('all', total)];
}

const COMPLIANCE_COLUMNS = [
  'determinationsCompliant',
  'determinationsNonCompliant',
  'determinationsFurtherAction',
  'clarificationsIssued',
  'clarificationsResolved',
  'actionsNoticeToComply',
  'actionsWarning',
  'actionsSalaryStoppage',
  'actionsDisciplinaryReferral',
  'referrals',
] as const;

function compliance(commission: string, values: readonly number[] | 'suppressed' | null): Row {
  return {
    commission,
    commissionName: NAMES[commission] ?? commission,
    ...Object.fromEntries(
      COMPLIANCE_COLUMNS.map((column, index) => [
        column,
        Array.isArray(values) ? (values[index] ?? 0) : null,
      ]),
    ),
    suppressed: values === 'suppressed',
  };
}

/** Access requests are not collected yet (spec 10): every figure null, nothing suppressed. */
function accessRequests(commission: string): Row {
  return {
    commission,
    commissionName: NAMES[commission] ?? commission,
    received: null,
    granted: null,
    declined: null,
    suppressed: false,
  };
}

interface MockRelease {
  release: OpenDataRelease;
  tables: Record<'filing-by-commission' | 'compliance-by-commission' | 'access-requests', Row[]>;
}

const TABLE_HASH = '0'.repeat(64);

function release(fields: Pick<OpenDataRelease, 'id' | 'fy' | 'kind' | 'status' | 'builtAt'> & {
  publishedAt: string | null;
}): OpenDataRelease {
  return {
    version: 1,
    withdrawnAt: null,
    withdrawnReason: null,
    manifestVerificationId: fields.status === 'published' ? 'K7Q2-M9XD-4TPA' : null,
    tables: (
      [
        'filing-by-commission',
        'compliance-by-commission',
        'by-entity-type',
        'by-cycle',
        'access-requests',
        'national-totals',
      ] as const
    ).map((table) => ({ table, rows: 12, sha256Json: TABLE_HASH, sha256Csv: TABLE_HASH })),
    ...fields,
  };
}

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
    'filing-by-commission': [
      ...filing('jsc', 'not-reported', {}),
      ...filing('psc', 'submitted-on-time', {
        initial: [2920, 2808],
        biennial: [46480, 45210],
        final: [912, 861],
      }),
      ...filing('tsc', 'submitted-late', {
        initial: [8104, 7790],
        biennial: [301220, 290415],
        // A final cycle of fewer than 10 officers: suppressed.
        final: null,
      }),
    ],
    'compliance-by-commission': [
      compliance('jsc', null),
      compliance('psc', [16054, 727, 484, 402, 329, 1173, 347, 94, 25, 61]),
      compliance('tsc', [88210, 3120, 1904, 2210, 1980, 4012, 1250, 301, 88, 140]),
    ],
    'access-requests': ['jsc', 'psc', 'tsc'].map(accessRequests),
  },
};

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
    'filing-by-commission': [
      ...filing('jsc', 'not-reported', {}),
      // An even year: no biennial cycle, nothing expected of it.
      ...filing('psc', 'submitted-on-time', { initial: [655, 596], final: null }),
      ...filing('tsc', 'submitted-on-time', { initial: [2210, 2105], final: [640, 601] }),
    ],
    'compliance-by-commission': [
      compliance('jsc', null),
      compliance('psc', 'suppressed'),
      compliance('tsc', [1904, 61, 40, 88, 52, 70, 18, 4, 1, 3]),
    ],
    'access-requests': ['jsc', 'psc', 'tsc'].map(accessRequests),
  },
};

/** Answers `GET /v1/commissions/{slug}/open-data/preview`; null for any other request. */
export function mockOpenDataFetch(request: Request): Response | null {
  const path = new URL(request.url).pathname;
  const match = /^\/v1\/commissions\/([^/]+)\/open-data\/preview$/.exec(path);
  if (!match || request.method !== 'GET') return null;
  const slug = decodeURIComponent(match[1] ?? '');
  const caller = mockCallerOf(request);
  if (caller.tenant !== slug) return problem(404, 'Not found');
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

/** A reporting client answered by this mock as a member of `tenant` holding `roles`, for tests. */
export function mockOpenDataClient({ roles, tenant }: { roles: readonly string[]; tenant: string }) {
  return createClient<paths>({
    baseUrl: 'http://reporting.test',
    headers: {
      authorization: `Bearer ${unsignedMockToken({ subject: 'user-test', name: 'Test', roles, tenant })}`,
    },
    fetch: (request) =>
      Promise.resolve(mockOpenDataFetch(request) ?? problem(404, 'Not found')),
  });
}
