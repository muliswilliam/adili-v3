import type {
  AccessRequestsRow,
  ByCycleRow,
  ByEntityTypeRow,
  ComplianceByCommissionRow,
  FilingByCommissionRow,
  NationalMeasure,
  NationalTotalsRow,
  OpenDataRelease,
  OpenDataTable,
  ReleaseTables,
  ReportStatus,
} from './types';

/**
 * The open-data mock's synthetic world (spec 09b): 52 responsible Commissions over two financial
 * years, built into the six tables in the reporting service's shapes (#491 `tables.ts`), with
 * its suppression rule (a row over fewer than 10 officers is hidden whole, and one more where a
 * single hidden row could be worked out from a total). Deterministic, so file hashes are stable.
 *
 * Releases: FY 2025/26 annual v1 (published), FY 2025/26 mid-year snapshot v1, FY 2024/25 annual
 * v1 (withdrawn: TSC initial declarations counted twice) and v2 (its correction). FY 2024/25 is
 * before the contract's first financial year (2025); the mock serves it anyway so the national
 * trend has two years to draw.
 */

export const SUPPRESSION_THRESHOLD = 10;

interface Commission {
  slug: string;
  name: string;
  /** Officers expected per cycle in FY 2025/26. */
  size: Record<'initial' | 'biennial' | 'final', number>;
  /** Financial years whose Form M it never sent. */
  notReported?: number[];
  late?: boolean;
}

const COUNTIES = [
  'Mombasa',
  'Kwale',
  'Kilifi',
  'Tana River',
  'Lamu',
  'Taita-Taveta',
  'Garissa',
  'Wajir',
  'Mandera',
  'Marsabit',
  'Isiolo',
  'Meru',
  'Tharaka-Nithi',
  'Embu',
  'Kitui',
  'Machakos',
  'Makueni',
  'Nyandarua',
  'Nyeri',
  'Kirinyaga',
  "Murang'a",
  'Kiambu',
  'Turkana',
  'West Pokot',
  'Samburu',
  'Trans Nzoia',
  'Uasin Gishu',
  'Elgeyo-Marakwet',
  'Nandi',
  'Baringo',
  'Laikipia',
  'Nakuru',
  'Narok',
  'Kajiado',
  'Kericho',
  'Bomet',
  'Kakamega',
  'Vihiga',
  'Bungoma',
  'Busia',
  'Siaya',
  'Kisumu',
  'Homa Bay',
  'Migori',
  'Kisii',
  'Nyamira',
  'Nairobi City',
];

const COMMISSIONS: Commission[] = [
  {
    slug: 'psc',
    name: 'Public Service Commission',
    size: { initial: 2920, biennial: 46480, final: 912 },
  },
  {
    slug: 'tsc',
    name: 'Teachers Service Commission',
    size: { initial: 9412, biennial: 331870, final: 7905 },
    late: true,
  },
  {
    slug: 'jsc',
    name: 'Judicial Service Commission',
    size: { initial: 410, biennial: 6120, final: 88 },
    notReported: [2024, 2025],
  },
  {
    slug: 'parlsc',
    name: 'Parliamentary Service Commission',
    size: { initial: 214, biennial: 2890, final: 96 },
  },
  {
    slug: 'npsc',
    name: 'National Police Service Commission',
    size: { initial: 6120, biennial: 104300, final: 2410 },
  },
  ...COUNTIES.map((county, index): Commission => {
    const k = index + 1;
    return {
      slug: `cpsb${String(k).padStart(3, '0')}`,
      name: `${county} County Public Service Board`,
      size: {
        initial: 180 + ((k * 37) % 320),
        biennial: 2400 + ((k * 211) % 4200),
        // Lamu (5), Tana River (4), Isiolo (11) and Samburu (25) have tiny final cycles, which
        // suppression hides.
        final: { 4: 7, 5: 6, 11: 8, 25: 9 }[k] ?? 40 + ((k * 13) % 90),
      },
      notReported: { 37: [2024, 2025], 42: [2025] }[k],
      late: k % 9 === 0,
    };
  }),
];

const ENTITY_TYPES: [string, number][] = [
  ['Public school or college', 0.5],
  ['Ministry or state department', 0.12],
  ['Police service', 0.16],
  ['County executive', 0.1],
  ['County assembly', 0.03],
  ['State corporation', 0.05],
  ['Constitutional commission or independent office', 0.02],
  ['Parliament', 0.012],
  ['Judiciary', 0.008],
];

const CYCLE_SECTIONS = ['initial', 'biennial', 'final'] as const;

/** A number in [0, 1) from a key, the same every run. */
function noise(key: string): number {
  let hash = 2166136261;
  for (const char of key) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 2246822507);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 4294967296;
}

const between = (key: string, low: number, high: number) => low + (high - low) * noise(key);
const rate = (part: number, whole: number) =>
  whole === 0 ? null : Math.round((part / whole) * 10000) / 10000;

export interface MockRelease {
  release: OpenDataRelease;
  tables: ReleaseTables;
}

interface Filing {
  expected: number;
  filed: number;
}

type Section = (typeof CYCLE_SECTIONS)[number];
type CycleFilings = Record<Section | 'all', Filing>;

const SNAPSHOT_SHARE: Record<Section, number> = { initial: 0.6, biennial: 0.42, final: 0.58 };

function filingOf(commission: Commission, fy: number, kind: string, cycle: Section): Filing {
  // No biennial declarations fall due in an even financial year.
  if (cycle === 'biennial' && fy % 2 === 0) return { expected: 0, filed: 0 };
  const size = commission.size[cycle];
  let expected = size < SUPPRESSION_THRESHOLD ? size : Math.round(size * (fy === 2024 ? 0.96 : 1));
  if (kind === 'snapshot' && expected >= SUPPRESSION_THRESHOLD) {
    expected = Math.round(expected * SNAPSHOT_SHARE[cycle]);
  }
  const key = `${commission.slug}-${String(fy)}-${kind}-${cycle}`;
  const missed =
    between(key, 0.012, 0.075) + (fy === 2024 ? 0.025 : 0) + (kind === 'snapshot' ? 0.05 : 0);
  const filed =
    expected < SUPPRESSION_THRESHOLD
      ? expected - Math.round(between(`${key}s`, 0, 2.4))
      : expected - Math.round(expected * missed);
  return { expected, filed: Math.max(0, filed) };
}

function filingFigures({ expected, filed }: Filing) {
  return {
    expected,
    filed,
    nonFilers: Math.max(0, expected - filed),
    filingRate: rate(Math.min(filed, expected), expected),
  };
}

const HIDDEN_FILING = { expected: null, filed: null, nonFilers: null, filingRate: null };

/**
 * Which cells of a Commission x cycle grid to hide: under the threshold, then one more in any
 * row or column where a single hidden cell could be recovered from the published total.
 */
function suppressGrid(grid: Map<string, Map<string, number>>): Set<string> {
  const hidden = new Set<string>();
  for (const [row, cells] of grid) {
    for (const [column, value] of cells) {
      if (value > 0 && value < SUPPRESSION_THRESHOLD) hidden.add(`${row}|${column}`);
    }
  }
  const lines = (byRow: boolean) => {
    const out = new Map<string, [string, number][]>();
    for (const [row, cells] of grid) {
      for (const [column, value] of cells) {
        const line = byRow ? row : column;
        out.set(line, [...(out.get(line) ?? []), [`${row}|${column}`, value]]);
      }
    }
    return out;
  };
  for (let changed = true; changed;) {
    changed = false;
    for (const byRow of [true, false]) {
      for (const cells of lines(byRow).values()) {
        if (cells.filter(([key]) => hidden.has(key)).length !== 1) continue;
        const next = cells
          .filter(([key, value]) => !hidden.has(key) && value > 0)
          .sort((a, b) => a[1] - b[1])[0];
        if (next) {
          hidden.add(next[0]);
          changed = true;
        }
      }
    }
  }
  return hidden;
}

function table<Row extends Record<string, string | number | boolean | null>>(
  name: OpenDataTable['table'],
  columns: string[],
  rows: Row[],
  notCollected: string[] = [],
): OpenDataTable<Row> {
  const figures = columns.filter(
    (column) =>
      !/^(commission|commissionName|reportStatus|cycle|entityType|measure|suppressed)$/.test(
        column,
      ),
  );
  const cellsSuppressed = rows.filter((row) => row.suppressed === true).length * figures.length;
  return {
    table: name,
    columns,
    rows,
    suppression: { threshold: SUPPRESSION_THRESHOLD, cellsSuppressed },
    notCollected,
  };
}

interface Compliance {
  compliant: number;
  nonCompliant: number;
  furtherAction: number;
  clarificationsIssued: number;
  clarificationsResolved: number;
  notice: number;
  warning: number;
  stoppage: number;
  disciplinary: number;
  referrals: number;
}

function complianceOf(
  commission: Commission,
  fy: number,
  kind: string,
  filed: number,
  nonFilers: number,
): Compliance {
  const key = `${commission.slug}-${String(fy)}-${kind}`;
  const determinations = Math.round(filed * between(`${key}dr`, 0.22, 0.5));
  const compliant = Math.round(determinations * between(`${key}cr`, 0.88, 0.965));
  const nonCompliant = Math.round((determinations - compliant) * between(`${key}nc`, 0.45, 0.7));
  const clarificationsIssued = Math.round(filed * between(`${key}cl`, 0.004, 0.012));
  const notice = Math.round(
    (nonFilers * between(`${key}an`, 0.45, 0.7) + nonCompliant * 0.4) *
      (kind === 'snapshot' ? 0.45 : 1),
  );
  const warning = Math.round(notice * between(`${key}aw`, 0.18, 0.34));
  const stoppage = Math.round(warning * between(`${key}as`, 0.12, 0.28));
  const disciplinary = Math.round(stoppage * between(`${key}ad`, 0.2, 0.45));
  return {
    compliant,
    nonCompliant,
    furtherAction: determinations - compliant - nonCompliant,
    clarificationsIssued,
    clarificationsResolved: Math.round(clarificationsIssued * between(`${key}cz`, 0.78, 0.93)),
    notice,
    warning,
    stoppage,
    disciplinary,
    referrals: Math.round(disciplinary * between(`${key}rf`, 0.3, 0.8) + between(`${key}rx`, 0, 4)),
  };
}

function buildTables(
  fy: number,
  kind: OpenDataRelease['kind'],
  doubleCountTsc: boolean,
): ReleaseTables {
  const reporting = COMMISSIONS.filter(
    (commission) => kind === 'snapshot' || !commission.notReported?.includes(fy),
  );
  const filing = new Map<string, CycleFilings>();
  const compliance = new Map<string, Compliance>();
  for (const commission of reporting) {
    const initial = filingOf(commission, fy, kind, 'initial');
    if (doubleCountTsc && commission.slug === 'tsc') initial.filed += 1204;
    const biennial = filingOf(commission, fy, kind, 'biennial');
    const final = filingOf(commission, fy, kind, 'final');
    const all = {
      expected: initial.expected + biennial.expected + final.expected,
      filed: initial.filed + biennial.filed + final.filed,
    };
    filing.set(commission.slug, { initial, biennial, final, all });
    compliance.set(
      commission.slug,
      complianceOf(commission, fy, kind, all.filed, Math.max(0, all.expected - all.filed)),
    );
  }

  const hiddenFiling = suppressGrid(
    new Map(
      [...filing].map(([slug, cycles]) => [
        slug,
        new Map(CYCLE_SECTIONS.map((cycle) => [cycle, cycles[cycle].expected])),
      ]),
    ),
  );
  // Commission-level counts are over a Commission's officers: hide those under the threshold,
  // and a second one when only one would be hidden.
  const hiddenCommissions = new Set(
    [...filing]
      .filter(([, cycles]) => cycles.all.expected < SUPPRESSION_THRESHOLD)
      .map(([slug]) => slug),
  );
  if (hiddenCommissions.size === 1) {
    const next = [...filing]
      .filter(([slug]) => !hiddenCommissions.has(slug))
      .sort((a, b) => a[1].all.expected - b[1].all.expected)[0];
    if (next) hiddenCommissions.add(next[0]);
  }

  const statusOf = (commission: Commission): ReportStatus =>
    !filing.has(commission.slug)
      ? 'not-reported'
      : commission.late
        ? 'submitted-late'
        : 'submitted-on-time';

  const filingRows: FilingByCommissionRow[] = COMMISSIONS.flatMap((commission) =>
    (['initial', 'biennial', 'final', 'all'] as const).map((cycle): FilingByCommissionRow => {
      const base = {
        commission: commission.slug,
        commissionName: commission.name,
        reportStatus: statusOf(commission),
        cycle,
      };
      const cycles = filing.get(commission.slug);
      if (!cycles) return { ...base, ...HIDDEN_FILING, suppressed: false };
      const hidden =
        cycle === 'all'
          ? hiddenCommissions.has(commission.slug)
          : hiddenFiling.has(`${commission.slug}|${cycle}`);
      return hidden
        ? { ...base, ...HIDDEN_FILING, suppressed: true }
        : { ...base, ...filingFigures(cycles[cycle]), suppressed: false };
    }),
  );

  const complianceRows: ComplianceByCommissionRow[] = COMMISSIONS.map((commission) => {
    const counts = compliance.get(commission.slug);
    const base = { commission: commission.slug, commissionName: commission.name };
    const figures = (value: (c: Compliance) => number) =>
      counts && !hiddenCommissions.has(commission.slug) ? value(counts) : null;
    return {
      ...base,
      determinationsCompliant: figures((c) => c.compliant),
      determinationsNonCompliant: figures((c) => c.nonCompliant),
      determinationsFurtherAction: figures((c) => c.furtherAction),
      clarificationsIssued: figures((c) => c.clarificationsIssued),
      clarificationsResolved: figures((c) => c.clarificationsResolved),
      actionsNoticeToComply: figures((c) => c.notice),
      actionsWarning: figures((c) => c.warning),
      actionsSalaryStoppage: figures((c) => c.stoppage),
      actionsDisciplinaryReferral: figures((c) => c.disciplinary),
      referrals: figures((c) => c.referrals),
      suppressed: Boolean(counts) && hiddenCommissions.has(commission.slug),
    };
  });

  const sum = (pick: (cycles: CycleFilings) => number) =>
    [...filing.values()].reduce((total, cycles) => total + pick(cycles), 0);
  const nationalBy = (cycle: Section | 'all'): Filing => ({
    expected: sum((cycles) => cycles[cycle].expected),
    filed: sum((cycles) => cycles[cycle].filed),
  });
  const cycleRows: ByCycleRow[] = (['initial', 'biennial', 'final', 'all'] as const).map(
    (cycle) => ({ cycle, ...filingFigures(nationalBy(cycle)), suppressed: false }),
  );

  const national = filingFigures(nationalBy('all'));
  const entityRows: ByEntityTypeRow[] = ENTITY_TYPES.flatMap(([entityType, share]) =>
    (['initial', 'biennial', 'final', 'all'] as const).map((cycle): ByEntityTypeRow => {
      const expected = Math.round(nationalBy(cycle).expected * share);
      const filed = Math.round(
        expected * (1 - between(`${String(fy)}${kind}${entityType}${cycle}`, 0.02, 0.09)),
      );
      if (expected > 0 && expected < SUPPRESSION_THRESHOLD) {
        return { entityType, cycle, ...HIDDEN_FILING, suppressed: true };
      }
      return { entityType, cycle, ...filingFigures({ expected, filed }), suppressed: false };
    }),
  );

  const accessRows: AccessRequestsRow[] = COMMISSIONS.map((commission) => ({
    commission: commission.slug,
    commissionName: commission.name,
    received: null,
    granted: null,
    declined: null,
    suppressed: false,
  }));

  const totals = [...compliance.values()];
  const count = (pick: (c: Compliance) => number) =>
    totals.reduce((total, c) => total + pick(c), 0);
  const statuses = COMMISSIONS.map(statusOf);
  const reported = statuses.filter((status) => status !== 'not-reported').length;
  const measures: Record<NationalMeasure, number | null> = {
    commissions: COMMISSIONS.length,
    commissionsReported: reported,
    commissionsReportedOnTime: statuses.filter((status) => status === 'submitted-on-time').length,
    commissionsReportedLate: statuses.filter((status) => status === 'submitted-late').length,
    commissionsNotReported: COMMISSIONS.length - reported,
    reportingRate: rate(reported, COMMISSIONS.length),
    expected: national.expected,
    filed: national.filed,
    nonFilers: national.nonFilers,
    filingRate: national.filingRate,
    clarificationsIssued: count((c) => c.clarificationsIssued),
    clarificationsResolved: count((c) => c.clarificationsResolved),
    determinationsCompliant: count((c) => c.compliant),
    determinationsNonCompliant: count((c) => c.nonCompliant),
    determinationsFurtherAction: count((c) => c.furtherAction),
    actionsNoticeToComply: count((c) => c.notice),
    actionsWarning: count((c) => c.warning),
    actionsSalaryStoppage: count((c) => c.stoppage),
    actionsDisciplinaryReferral: count((c) => c.disciplinary),
    referrals: count((c) => c.referrals),
    accessRequestsReceived: null,
    accessRequestsGranted: null,
    accessRequestsDeclined: null,
  };
  const nationalRows: NationalTotalsRow[] = Object.entries(measures).map(([measure, value]) => ({
    measure: measure as NationalMeasure,
    value,
    suppressed: false,
  }));

  const filingColumns = ['expected', 'filed', 'nonFilers', 'filingRate', 'suppressed'];
  return {
    'filing-by-commission': table(
      'filing-by-commission',
      ['commission', 'commissionName', 'reportStatus', 'cycle', ...filingColumns],
      filingRows,
    ),
    'compliance-by-commission': table(
      'compliance-by-commission',
      [
        'commission',
        'commissionName',
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
        'suppressed',
      ],
      complianceRows,
    ),
    'by-entity-type': table(
      'by-entity-type',
      ['entityType', 'cycle', ...filingColumns],
      entityRows,
    ),
    'by-cycle': table('by-cycle', ['cycle', ...filingColumns], cycleRows),
    'access-requests': table(
      'access-requests',
      ['commission', 'commissionName', 'received', 'granted', 'declined', 'suppressed'],
      accessRows,
      ['received', 'granted', 'declined'],
    ),
    'national-totals': table('national-totals', ['measure', 'value', 'suppressed'], nationalRows, [
      'accessRequestsReceived',
      'accessRequestsGranted',
      'accessRequestsDeclined',
    ]),
  };
}

type Seed = Omit<OpenDataRelease, 'tables' | 'verifyUrl'>;

const MOCK_VERIFY_ORIGIN = 'http://localhost:3030';

const SEEDS: Seed[] = [
  {
    id: '0199c1a0-2025-7000-8000-000000000001',
    fy: 2025,
    kind: 'annual',
    version: 1,
    status: 'published',
    builtAt: '2026-09-18T12:10:00Z',
    publishedAt: '2026-09-18T12:12:00Z',
    withdrawnAt: null,
    withdrawnReason: null,
    correctedVersion: null,
    manifestVerificationId: 'ADL-8KQD-3TWM-6HXC-2RPA-9VNF-4E',
  },
  {
    id: '0199c1a0-2025-7000-8000-000000000002',
    fy: 2025,
    kind: 'snapshot',
    version: 1,
    status: 'published',
    builtAt: '2026-02-12T06:40:00Z',
    publishedAt: '2026-02-16T07:05:00Z',
    withdrawnAt: null,
    withdrawnReason: null,
    correctedVersion: null,
    manifestVerificationId: 'ADL-5MRX-7QCK-1WHT-8DNP-3JFA-6B',
  },
  {
    id: '0199c1a0-2024-7000-8000-000000000004',
    fy: 2024,
    kind: 'annual',
    version: 2,
    status: 'published',
    builtAt: '2025-10-06T05:55:00Z',
    publishedAt: '2025-10-06T06:30:00Z',
    withdrawnAt: null,
    withdrawnReason: null,
    correctedVersion: null,
    manifestVerificationId: 'ADL-2HVN-9KDT-4QXM-7CPW-1RFE-8K',
  },
  {
    id: '0199c1a0-2024-7000-8000-000000000003',
    fy: 2024,
    kind: 'annual',
    version: 1,
    status: 'withdrawn',
    builtAt: '2025-09-19T13:02:00Z',
    publishedAt: '2025-09-19T13:04:00Z',
    withdrawnAt: '2025-10-03T08:20:00Z',
    withdrawnReason:
      'Initial declarations for the Teachers Service Commission were counted twice for 1,204 declarants. Version 2 corrects this.',
    correctedVersion: 2,
    manifestVerificationId: 'ADL-6TCW-2MKR-8HQD-5XNA-3VPE-1F',
  },
];

/** The releases, latest year first, then annual before snapshot, latest version first. */
export function mockReleases(hash: (body: string) => string): MockRelease[] {
  return SEEDS.map((seed) => {
    const tables = buildTables(seed.fy, seed.kind, seed.fy === 2024 && seed.version === 1);
    return {
      tables,
      release: {
        ...seed,
        verifyUrl: `${MOCK_VERIFY_ORIGIN}/v/${seed.manifestVerificationId}`,
        tables: Object.values(tables).map((each: OpenDataTable) => ({
          table: each.table,
          rows: each.rows.length,
          sha256Json: hash(tableJson(each)),
          sha256Csv: hash(tableCsv(each)),
        })),
      },
    };
  });
}

/** A table's JSON file, as the service stores and serves it. */
export function tableJson(each: OpenDataTable): string {
  return `${JSON.stringify(each)}\n`;
}

/**
 * A table's CSV file, as the service writes it: RFC 4180, CRLF, a header row of the columns
 * with the marker as `_suppressed`, a suppressed or not-collected figure as an empty cell.
 */
export function tableCsv(each: OpenDataTable): string {
  const field = (value: string | number | boolean | null | undefined) => {
    if (value === null || value === undefined) return '';
    const text = String(value);
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const header = each.columns.map((column) =>
    field(column === 'suppressed' ? '_suppressed' : column),
  );
  const lines = [
    header.join(','),
    ...each.rows.map((row) => each.columns.map((column) => field(row[column])).join(',')),
  ];
  return `${lines.join('\r\n')}\r\n`;
}
