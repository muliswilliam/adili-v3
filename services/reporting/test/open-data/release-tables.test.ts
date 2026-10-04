import { describe, expect, it } from 'vitest';

import { buildAggregates, buildLiveAggregates } from '../../src/national-reports/aggregates.js';
import { datasetFiles, sha256, tableCsv, tableJson } from '../../src/open-data/files.js';
import {
  buildReleaseTables,
  CYCLES,
  OPEN_DATA_TABLES,
  type OpenDataTable,
  reconcile,
  type ReleaseTables,
} from '../../src/open-data/tables.js';
import { receiptOf } from '../support/receipts.js';
import {
  RELEASE_COMMISSIONS,
  RELEASE_COMPLIANCE,
  RELEASE_COUNTS,
  RELEASE_FY,
} from '../support/release-fixtures.js';

/**
 * S4 (suppression applied in the release tables) and S9 (reconciliation), pure: the six tables
 * from the FY 2027 fixtures against a golden file, the suppression patterns they share, and the
 * national totals against the NCR's.
 */

const aggregates = buildAggregates({
  fy: RELEASE_FY,
  commissions: RELEASE_COMMISSIONS.map((slug) => ({
    slug,
    issuerCode: slug.toUpperCase(),
    name: slug.toUpperCase(),
  })),
  receipts: Object.entries(RELEASE_COUNTS).map(([tenant, counts]) =>
    receiptOf(tenant, { counts, late: tenant === 'tsc' }),
  ),
});

const built = buildReleaseTables({ aggregates, compliance: RELEASE_COMPLIANCE });
const { tables } = built;

type Row = OpenDataTable['rows'][number];

const filingRow = (commission: string, cycle: string): Row | undefined =>
  tables['filing-by-commission'].rows.find(
    (row) => row.commission === commission && row.cycle === cycle,
  );
const byCycleRow = (cycle: string): Row | undefined =>
  tables['by-cycle'].rows.find((row) => row.cycle === cycle);
const national = (measure: string): Row | undefined =>
  tables['national-totals'].rows.find((row) => row.measure === measure);

/**
 * Every additive line the filing tables publish: a Commission's cycles with its `all` row, each
 * cycle's Commissions with the national (`by-cycle`) row, and the `by-cycle` rows themselves.
 * Each must hide none or at least two of its figures, or one could be recovered by subtraction.
 */
function filingLines(release: ReleaseTables): { name: string; suppressed: number }[] {
  const reported = [
    ...new Set(
      release['filing-by-commission'].rows
        .filter((row) => row.reportStatus !== 'not-reported')
        .map((row) => row.commission),
    ),
  ];
  const marker = (row: Row | undefined) => (row?.suppressed === true ? 1 : 0);
  const find = (commission: string, cycle: string) =>
    release['filing-by-commission'].rows.find(
      (row) => row.commission === commission && row.cycle === cycle,
    );
  const byCycle = (cycle: string) => release['by-cycle'].rows.find((row) => row.cycle === cycle);
  return [
    ...reported.map((commission) => ({
      name: `row ${commission}`,
      suppressed: CYCLES.reduce((n, cycle) => n + marker(find(commission, cycle)), 0),
    })),
    ...CYCLES.map((cycle) => ({
      name: `column ${cycle}`,
      suppressed:
        reported.reduce((n, commission) => n + marker(find(commission, cycle)), 0) +
        marker(byCycle(cycle)),
    })),
    {
      name: 'national cycles',
      suppressed: CYCLES.reduce((n, cycle) => n + marker(byCycle(cycle)), 0),
    },
  ];
}

describe('open data release tables (S4)', () => {
  it('builds the six tables from the aggregates and facts (golden)', async () => {
    expect(Object.keys(tables)).toEqual([...OPEN_DATA_TABLES]);
    await expect(`${JSON.stringify(tables, null, 2)}\n`).toMatchFileSnapshot(
      'golden/release-tables.json',
    );
  });

  it('suppresses filing figures over fewer than 10 officers, with complementary cells', () => {
    // psc's final cell (4 officers) would be its `all` row minus the others: its initial cell
    // (the next smallest) is suppressed too.
    expect(filingRow('psc', 'final')).toMatchObject({
      expected: null,
      filed: null,
      suppressed: true,
    });
    expect(filingRow('psc', 'initial')).toMatchObject({ filed: null, suppressed: true });
    expect(filingRow('psc', 'biennial')).toMatchObject({
      expected: 100,
      filed: 95,
      nonFilers: 5,
      filingRate: 0.95,
      suppressed: false,
    });
    expect(filingRow('psc', 'all')).toMatchObject({ expected: 116, filed: 109, suppressed: false });
    // wrc's 5 officers: every figure, its `all` row included.
    for (const cycle of ['initial', 'final', 'all']) {
      expect(filingRow('wrc', cycle)).toMatchObject({ filed: null, suppressed: true });
    }
    // No biennial cycle: a zero over no officers describes nobody and is published.
    expect(filingRow('nlc', 'biennial')).toMatchObject({
      expected: 0,
      filed: 0,
      filingRate: null,
      suppressed: false,
    });
    // The national rows: true sums, never suppressed at this size.
    expect(byCycleRow('all')).toMatchObject({ expected: 369, filed: 307, suppressed: false });
    expect(filingLines(tables).filter((line) => line.suppressed === 1)).toEqual([]);
  });

  it('leaves a Commission that has not reported without figures, unsuppressed', () => {
    for (const cycle of CYCLES) {
      expect(filingRow('jsc', cycle)).toEqual({
        commission: 'jsc',
        commissionName: 'JSC',
        reportStatus: 'not-reported',
        cycle,
        expected: null,
        filed: null,
        nonFilers: null,
        filingRate: null,
        suppressed: false,
      });
    }
    const compliance = tables['compliance-by-commission'].rows.find(
      (row) => row.commission === 'jsc',
    );
    expect(compliance).toMatchObject({ determinationsCompliant: null, suppressed: false });
    // Its facts count nowhere: 2 (psc) + 1 (tsc) + 1 (wrc), not jsc's 4.
    expect(national('determinationsCompliant')).toEqual({
      measure: 'determinationsCompliant',
      value: 4,
      suppressed: false,
    });
  });

  it('suppresses a small Commission in every per-Commission table, and the next smallest', () => {
    const suppressed = tables['compliance-by-commission'].rows
      .filter((row) => row.suppressed)
      .map((row) => row.commission);
    // wrc (5 officers) is suppressed; nlc (13, the next fewest) protects it in the totals.
    expect(suppressed).toEqual(['nlc', 'wrc']);
  });

  it('publishes access requests as each Commission filed them, suppressed with its other counts', () => {
    // Form M section 5 as filed (projected from the access events): psc 3/2/1, tsc 1/1/0; nlc
    // and wrc hidden as in compliance-by-commission; jsc has not reported.
    expect(tables['access-requests'].notCollected).toEqual([]);
    expect(tables['access-requests'].rows).toEqual([
      ...['jsc', 'nlc', 'psc', 'tsc', 'wrc'].map((commission) => ({
        commission,
        commissionName: commission.toUpperCase(),
        ...{
          jsc: { received: null, granted: null, declined: null, suppressed: false },
          nlc: { received: null, granted: null, declined: null, suppressed: true },
          psc: { received: 3, granted: 2, declined: 1, suppressed: false },
          tsc: { received: 1, granted: 1, declined: 0, suppressed: false },
          wrc: { received: null, granted: null, declined: null, suppressed: true },
        }[commission],
      })),
    ]);
    // The national totals count every Commission that reported, the suppressed ones included.
    expect(tables['national-totals'].notCollected).toEqual([]);
    expect(
      ['accessRequestsReceived', 'accessRequestsGranted', 'accessRequestsDeclined'].map(national),
    ).toEqual([
      { measure: 'accessRequestsReceived', value: 5, suppressed: false },
      { measure: 'accessRequestsGranted', value: 3, suppressed: false },
      { measure: 'accessRequestsDeclined', value: 2, suppressed: false },
    ]);
    for (const name of OPEN_DATA_TABLES) {
      if (name === 'by-entity-type') continue;
      expect(tables[name].notCollected, name).toEqual([]);
    }
  });

  it('counts the suppressed figures of each table', () => {
    const cells = Object.fromEntries(
      OPEN_DATA_TABLES.map((name) => [name, tables[name].suppression]),
    );
    expect(cells).toEqual({
      // psc initial and final, nlc initial, final and all, wrc initial, final and all (8 rows x 4).
      'filing-by-commission': { threshold: 10, cellsSuppressed: 32 },
      'compliance-by-commission': { threshold: 10, cellsSuppressed: 20 },
      'by-entity-type': { threshold: 10, cellsSuppressed: 0 },
      'by-cycle': { threshold: 10, cellsSuppressed: 0 },
      // nlc and wrc (2 rows x 3).
      'access-requests': { threshold: 10, cellsSuppressed: 6 },
      'national-totals': { threshold: 10, cellsSuppressed: 0 },
    });
  });

  it('builds by-entity-type with its columns, no rows and its figures not collected: no entity types exist yet', () => {
    expect(tables['by-entity-type']).toEqual({
      table: 'by-entity-type',
      columns: [
        'entityType',
        'cycle',
        'expected',
        'filed',
        'nonFilers',
        'filingRate',
        'suppressed',
      ],
      rows: [],
      suppression: { threshold: 10, cellsSuppressed: 0 },
      notCollected: ['expected', 'filed', 'nonFilers', 'filingRate'],
    });
  });

  it('is deterministic: the same aggregates give the same bytes', () => {
    const again = buildReleaseTables({ aggregates, compliance: RELEASE_COMPLIANCE }).tables;
    for (const name of OPEN_DATA_TABLES) {
      expect(sha256(tableJson(again[name]))).toBe(sha256(tableJson(tables[name])));
      expect(sha256(tableCsv(again[name]))).toBe(sha256(tableCsv(tables[name])));
    }
  });
});

describe('open data files', () => {
  it('writes CSV with a header row, empty suppressed cells and a _suppressed column', () => {
    const csv = tableCsv(tables['compliance-by-commission']).toString('utf8').split('\r\n');
    expect(csv).toEqual([
      'commission,commissionName,determinationsCompliant,determinationsNonCompliant,determinationsFurtherAction,clarificationsIssued,clarificationsResolved,actionsNoticeToComply,actionsWarning,actionsSalaryStoppage,actionsDisciplinaryReferral,referrals,_suppressed',
      'jsc,JSC,,,,,,,,,,,false',
      'nlc,NLC,,,,,,,,,,,true',
      'psc,PSC,2,1,0,6,1,2,1,0,0,1,false',
      'tsc,TSC,1,0,1,3,0,1,0,0,0,0,false',
      'wrc,WRC,,,,,,,,,,,true',
      '',
    ]);
  });

  it('writes access requests with empty suppressed and not-reported cells', () => {
    const csv = tableCsv(tables['access-requests']).toString('utf8').split('\r\n');
    expect(csv).toEqual([
      'commission,commissionName,received,granted,declined,_suppressed',
      'jsc,JSC,,,,false',
      'nlc,NLC,,,,true',
      'psc,PSC,3,2,1,false',
      'tsc,TSC,1,1,0,false',
      'wrc,WRC,,,,true',
      '',
    ]);
  });

  it('quotes CSV fields that need it', () => {
    const csv = tableCsv({
      table: 'access-requests',
      columns: ['commissionName', 'received'],
      rows: [{ commissionName: 'Teachers, "Service"', received: 1 }],
      suppression: { threshold: 10, cellsSuppressed: 0 },
      notCollected: [],
    });
    expect(csv.toString('utf8')).toBe('commissionName,received\r\n"Teachers, ""Service""",1\r\n');
  });

  it('lists every table file with its hash in the release JSON', () => {
    const files = datasetFiles(
      {
        id: '0199b000-0000-7000-8000-000000000001',
        fy: RELEASE_FY,
        kind: 'snapshot',
        version: 1,
        builtAt: '2028-08-20T07:00:00.000Z',
        source: 'national-report',
        ncrReference: null,
        suppression: { threshold: 10 },
      },
      tables,
    );
    expect(files.map((file) => `${file.table}.${file.format}`)).toEqual([
      ...OPEN_DATA_TABLES.flatMap((name) => [`${name}.json`, `${name}.csv`]),
      'release.json',
    ]);
    for (const file of files) expect(file.sha256).toBe(sha256(file.body));
    const release = JSON.parse(files.at(-1)?.body.toString('utf8') ?? '{}') as {
      tables: { table: string; rows: number; sha256Json: string; sha256Csv: string }[];
    };
    expect(release.tables[0]).toEqual({
      table: 'filing-by-commission',
      rows: 20,
      sha256Json: files[0]?.sha256,
      sha256Csv: files[1]?.sha256,
    });
  });
});

describe('open data reconciliation (S9)', () => {
  it('reconciles when the release national totals equal the NCR totals', () => {
    expect(reconcile(built.totals, aggregates)).toEqual([]);
  });

  it('reconciles a release of the live projections with their own national totals', () => {
    const live = buildLiveAggregates({
      fy: RELEASE_FY,
      commissions: RELEASE_COMMISSIONS.map((slug) => ({
        slug,
        issuerCode: slug.toUpperCase(),
        name: slug.toUpperCase(),
      })),
      counts: new Map(Object.entries(RELEASE_COUNTS)),
      receipts: [],
    });
    const release = buildReleaseTables({ aggregates: live, compliance: RELEASE_COMPLIANCE });
    expect(reconcile(release.totals, live)).toEqual([]);
    // Nothing reported yet, but every Commission's numbers as projected: jsc's are zeros.
    expect(live.reporting).toMatchObject({ commissions: 5, reported: 0, notReported: 5 });
    expect(live.national.all).toEqual(aggregates.national.all);
    expect(live.byCommission.jsc).toMatchObject({
      status: 'not-reported',
      initial: { expected: 0, declared: 0, notDeclared: 0, rate: null },
      clarifications: 0,
    });
  });

  it('names every national total that differs from the NCR, access requests included', () => {
    const ncr = structuredClone(aggregates);
    ncr.national.initial.declared += 1;
    ncr.national.all.declared += 1;
    ncr.national.accessRequests.received = 0;
    ncr.reporting.late = 0;
    expect(reconcile(built.totals, ncr)).toEqual([
      'reporting.late',
      'national.initial.declared',
      'national.all.declared',
      'national.accessRequests.received',
    ]);
  });
});
