import { COMMISSION_ADMIN, FORM_M_ROLES } from '@adili/roles';

import { type Env, env } from '../env.server';
import { json, mockCallerOf, problem } from '../mock-http';
import { COMPLIANCE_FIGURES, OPEN_DATA_TABLES } from '../open-data-tables';
import { MOCK_PSC } from './mock-store.server';
import {
  buildReleaseTables,
  type ComplianceCounts,
  type TableFiles,
} from './releases-mock-tables.server';
import type { CommissionAggregate, OpenDataRelease } from './types';

/**
 * The reporting service's Commission open-data preview (spec 09b S6,
 * `getCommissionOpenDataPreview`), in memory, as one part of the reporting mock
 * (`mock.server.ts`): a release's Commission tables for four Commissions, built and suppressed by
 * the releases mock's port of the service's table builder (`releases-mock-tables.server.ts`),
 * filtered to the caller's as the service does. Its rules follow #491: 404 to anyone
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

const NAMES: Record<string, string> = {
  [MOCK_PSC.slug]: MOCK_PSC.name,
  tsc: 'Teachers Service Commission',
  jsc: 'Judicial Service Commission',
  nlc: 'National Land Commission',
};

type Section = 'initial' | 'biennial' | 'final';
type Counts = [expected: number, declared: number];

/** One Commission's year: each cycle's [expected, declared] (none if not reported). */
interface Fixture {
  status: CommissionAggregate['status'];
  /** A cycle left out had nothing expected of it. */
  cycles?: Partial<Record<Section, Counts>>;
  clarifications?: number;
  accessRequests?: { received: number; granted: number; declined: number };
  /** COMPLIANCE_FIGURES' counts but `clarificationsIssued` (the clarifications above). */
  compliance?: readonly number[];
}

const section = ([expected, declared]: Counts) => ({
  expected,
  declared,
  notDeclared: expected - declared,
  rate: expected > 0 ? Math.round((declared / expected) * 10_000) / 10_000 : null,
});

/** The fixtures' tables, as the service builds them from the year's aggregates. */
function tablesOf(fixtures: Readonly<Record<string, Fixture>>): TableFiles {
  const byCommission: Record<string, CommissionAggregate> = {};
  const compliance: Record<string, ComplianceCounts> = {};
  for (const [slug, fixture] of Object.entries(fixtures)) {
    const reported = fixture.status !== 'not-reported';
    const cycle = (name: Section) => (reported ? section(fixture.cycles?.[name] ?? [0, 0]) : null);
    const biennial = cycle('biennial');
    byCommission[slug] = {
      name: NAMES[slug] ?? slug,
      status: fixture.status,
      reportId: null,
      reference: null,
      submittedAt: null,
      initial: cycle('initial'),
      biennial: biennial && { ...biennial, noCycleInPeriod: biennial.expected === 0 },
      final: cycle('final'),
      clarifications: reported ? (fixture.clarifications ?? 0) : null,
      accessRequests: reported ? (fixture.accessRequests ?? null) : null,
    };
    const counts = COMPLIANCE_FIGURES.filter((name) => name !== 'clarificationsIssued');
    compliance[slug] = Object.fromEntries(
      counts.map((name, index) => [name, fixture.compliance?.[index] ?? 0]),
    ) as ComplianceCounts;
  }
  return buildReleaseTables({ byCommission }, compliance).tables;
}

const TABLE_HASH = '0'.repeat(64);

function release(
  fields: Pick<OpenDataRelease, 'id' | 'fy' | 'kind' | 'status' | 'builtAt'> & {
    publishedAt: string | null;
  },
  tables: TableFiles,
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
    tables: OPEN_DATA_TABLES.map((table) => ({
      table,
      rows: tables[table].rows.length,
      sha256Json: TABLE_HASH,
      sha256Csv: TABLE_HASH,
    })),
    ...fields,
  };
}

interface MockRelease {
  release: OpenDataRelease;
  tables: TableFiles;
}

/**
 * The latest published release. TSC's final cycle counts fewer than 10 officers: with it, its
 * initial cycle and JSC's final and initial ones are hidden, so neither TSC's row nor the final
 * column gives it away; PSC's figures are all shown.
 */
const PUBLISHED_TABLES = tablesOf({
  jsc: {
    status: 'submitted-on-time',
    cycles: { initial: [310, 296], biennial: [2650, 2588], final: [45, 41] },
    clarifications: 140,
    accessRequests: { received: 9, granted: 7, declined: 2 },
    compliance: [2730, 98, 61, 122, 77, 21, 5, 2, 9],
  },
  nlc: { status: 'not-reported' },
  [MOCK_PSC.slug]: {
    status: 'submitted-on-time',
    cycles: { initial: [2920, 2808], biennial: [46480, 45210], final: [912, 861] },
    clarifications: 402,
    accessRequests: { received: 14, granted: 11, declined: 3 },
    compliance: [16054, 727, 484, 329, 1173, 347, 94, 25, 61],
  },
  tsc: {
    status: 'submitted-late',
    cycles: { initial: [8104, 7790], biennial: [301220, 290415], final: [7, 4] },
    clarifications: 2210,
    accessRequests: { received: 52, granted: 40, declined: 12 },
    compliance: [88210, 3120, 1904, 1980, 4012, 1250, 301, 88, 140],
  },
});
const PUBLISHED: MockRelease = {
  release: release(
    {
      id: '0190f3a2-0000-7000-8000-00000000a025',
      fy: 2025,
      kind: 'annual',
      status: 'published',
      builtAt: '2026-09-18T06:40:00.000Z',
      publishedAt: '2026-09-18T07:05:00.000Z',
    },
    PUBLISHED_TABLES,
  ),
  tables: PUBLISHED_TABLES,
};

/**
 * A mid-year snapshot built since, an even year (no biennial cycle). PSC's final cycle counts
 * fewer than 10 officers: with it, its initial cycle and JSC's final and initial ones are hidden;
 * PSC's total stays, a true sum that no longer gives either cycle away.
 */
const PREVIEW_TABLES = tablesOf({
  jsc: {
    status: 'submitted-on-time',
    cycles: { initial: [120, 110], final: [30, 28] },
    clarifications: 7,
    accessRequests: { received: 2, granted: 2, declined: 0 },
    compliance: [96, 4, 2, 5, 3, 1, 0, 0, 0],
  },
  nlc: { status: 'not-reported' },
  [MOCK_PSC.slug]: {
    status: 'submitted-on-time',
    cycles: { initial: [655, 596], final: [8, 6] },
    clarifications: 31,
    accessRequests: { received: 4, granted: 3, declined: 1 },
    compliance: [254, 12, 7, 22, 28, 9, 2, 0, 3],
  },
  tsc: {
    status: 'submitted-on-time',
    cycles: { initial: [2210, 2105], final: [640, 601] },
    clarifications: 88,
    accessRequests: { received: 11, granted: 9, declined: 2 },
    compliance: [1904, 61, 40, 52, 70, 18, 4, 1, 3],
  },
});
const PREVIEW: MockRelease = {
  release: release(
    {
      id: '0190f3a2-0000-7000-8000-00000000b026',
      fy: 2026,
      kind: 'snapshot',
      status: 'preview',
      builtAt: '2026-09-26T09:12:00.000Z',
      publishedAt: null,
    },
    PREVIEW_TABLES,
  ),
  tables: PREVIEW_TABLES,
};

/** The Commission tables the preview returns. */
const COMMISSION_TABLES = [
  'filing-by-commission',
  'compliance-by-commission',
  'access-requests',
] as const;

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
      COMMISSION_TABLES.map((table) => [
        table,
        shown.tables[table].rows.filter((row) => row.commission === slug),
      ]),
    ),
  });
}
