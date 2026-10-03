/**
 * The open-data releases mock's table builder: a port of the reporting service's
 * (`services/reporting/src/open-data/suppression.ts` and `tables.ts`, #491), so the console's
 * mock answers with the tables, suppression markers and totals the service would build from the
 * same aggregates. Pure: aggregates and compliance counts in, the six tables and their
 * unsuppressed national totals out.
 */
import {
  COMPLIANCE_FIGURES,
  type ComplianceFigure,
  CYCLES,
  type Cycle,
  NATIONAL_MEASURES,
  type NationalMeasure,
  type OpenDataTableKey,
} from '../open-data-tables';
import type { NationalAggregates } from './types';

export const SUPPRESSION_THRESHOLD = 10;

type Row = Record<string, string | number | boolean | null>;

/** A table file as the service stores and serves it (reporting.yaml `OpenDataTableFile`). */
export interface TableFile {
  table: OpenDataTableKey;
  columns: string[];
  rows: Row[];
  suppression: { threshold: number; cellsSuppressed: number };
  notCollected: string[];
}

export type TableFiles = Record<OpenDataTableKey, TableFile>;

/* ---------- suppression (#491 suppression.ts) ---------- */

interface CountCell {
  value: number;
  officers: number;
}

type ReleasedCell = { suppressed: false; value: number } | { suppressed: true; value: null };

interface Figure {
  value: number;
  officers: number;
  rank: number;
  order: number;
  suppressed: boolean;
}

interface ReleasedTable {
  cells: ReleasedCell[][];
  rowTotals: ReleasedCell[];
  columnTotals: ReleasedCell[];
  total: ReleasedCell;
}

/**
 * Suppresses every figure over fewer officers than the threshold, then, while any row or column
 * (totals included) holds a single suppressed figure, the next by preference: cells before
 * totals, then the smallest value, then the fewest officers.
 */
function suppressTable(cellRows: CountCell[][], columns: number, threshold: number): ReleasedTable {
  let order = 0;
  const figure = (value: number, officers: number, rank: number): Figure => ({
    value,
    officers,
    rank,
    order: (order += 1),
    suppressed: officers > 0 && officers < threshold,
  });
  const lineOf = (members: Figure[], rank: number) => ({
    members,
    total: figure(
      members.reduce((t, f) => t + f.value, 0),
      members.reduce((t, f) => t + f.officers, 0),
      rank,
    ),
  });
  const cells = cellRows.map((row) => row.map((cell) => figure(cell.value, cell.officers, 0)));
  const columnCells: Figure[][] = Array.from({ length: columns }, () => []);
  for (const row of cells) row.forEach((f, c) => columnCells[c]?.push(f));
  const rowLines = cells.map((row) => lineOf(row, 1));
  const columnLines = columnCells.map((column) => lineOf(column, 1));
  const rowTotals = rowLines.map((line) => line.total);
  const columnTotals = columnLines.map((line) => line.total);
  const total = lineOf(rowTotals, 2).total;
  const lines = [
    ...rowLines,
    { members: columnTotals, total },
    ...columnLines,
    { members: rowTotals, total },
  ].map((line) => [...line.members, line.total]);
  for (;;) {
    const next = lines
      .find((line) => line.length > 1 && line.filter((f) => f.suppressed).length === 1)
      ?.filter((f) => !f.suppressed && f.officers > 0)
      .sort(
        (a, b) =>
          a.rank - b.rank || a.value - b.value || a.officers - b.officers || a.order - b.order,
      )[0];
    if (next === undefined) break;
    next.suppressed = true;
  }
  const released = (f: Figure): ReleasedCell =>
    f.suppressed ? { suppressed: true, value: null } : { suppressed: false, value: f.value };
  return {
    cells: cells.map((row) => row.map(released)),
    rowTotals: rowTotals.map(released),
    columnTotals: columnTotals.map(released),
    total: released(total),
  };
}

/* ---------- tables (#491 tables.ts) ---------- */

const SECTIONS = ['initial', 'biennial', 'final'] as const;

interface Counts {
  expected: number;
  declared: number;
  notDeclared: number;
}

/** A Commission's counts for the year from the projection facts. */
export type ComplianceCounts = Record<Exclude<ComplianceFigure, 'clarificationsIssued'>, number>;

const FILING_COLUMNS = ['expected', 'filed', 'nonFilers', 'filingRate', 'suppressed'];
const ACCESS_MEASURES = ['received', 'granted', 'declined'];
const ACCESS_NATIONAL: NationalMeasure[] = [
  'accessRequestsReceived',
  'accessRequestsGranted',
  'accessRequestsDeclined',
];
const DIMENSIONS = new Set([
  'commission',
  'commissionName',
  'reportStatus',
  'cycle',
  'entityType',
  'measure',
  'suppressed',
]);

const rateOf = (declared: number, expected: number) =>
  expected > 0 ? Math.round((declared / expected) * 10_000) / 10_000 : null;

const sumOf = (sections: Counts[]): Counts =>
  sections.reduce(
    (t, s) => ({
      expected: t.expected + s.expected,
      declared: t.declared + s.declared,
      notDeclared: t.notDeclared + s.notDeclared,
    }),
    { expected: 0, declared: 0, notDeclared: 0 },
  );

function filingFigures(counts: Counts, cell: ReleasedCell | undefined): Row {
  if (cell?.suppressed) {
    return { expected: null, filed: null, nonFilers: null, filingRate: null, suppressed: true };
  }
  return {
    expected: counts.expected,
    filed: counts.declared,
    nonFilers: counts.notDeclared,
    filingRate: rateOf(counts.declared, counts.expected),
    suppressed: false,
  };
}

function tableOf(
  table: OpenDataTableKey,
  columns: string[],
  rows: Row[],
  threshold: number,
  notCollected: string[] = [],
): TableFile {
  const figures = columns.filter((c) => !DIMENSIONS.has(c) && !notCollected.includes(c)).length;
  return {
    table,
    columns,
    rows: rows.map((row) => Object.fromEntries(columns.map((c) => [c, row[c] ?? null]))),
    suppression: {
      threshold,
      cellsSuppressed: rows.filter((row) => row.suppressed === true).length * figures,
    },
    notCollected,
  };
}

/** The release's six tables, suppressed, and its national totals before suppression. */
export function buildReleaseTables(
  aggregates: NationalAggregates,
  compliance: Readonly<Record<string, ComplianceCounts>>,
  threshold = SUPPRESSION_THRESHOLD,
): { tables: TableFiles; totals: { declared: number; expected: number } } {
  const commissions = Object.entries(aggregates.byCommission).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  const reported = commissions.flatMap(([slug, row]) => {
    if (!row.initial || !row.biennial || !row.final) return [];
    const sections = {
      initial: row.initial,
      biennial: row.biennial,
      final: row.final,
    } satisfies Record<(typeof SECTIONS)[number], Counts>;
    const facts = compliance[slug];
    const counts = Object.fromEntries(
      COMPLIANCE_FIGURES.map((name) => [
        name,
        name === 'clarificationsIssued' ? (row.clarifications ?? 0) : (facts?.[name] ?? 0),
      ]),
    ) as Record<ComplianceFigure, number>;
    return [
      {
        slug,
        sections,
        officers: SECTIONS.reduce((t, s) => t + sections[s].expected, 0),
        compliance: counts,
      },
    ];
  });
  const indexOf = (slug: string) => reported.findIndex((c) => c.slug === slug);

  const filing = suppressTable(
    reported.map((c) =>
      SECTIONS.map((s) => ({ value: c.sections[s].declared, officers: c.sections[s].expected })),
    ),
    SECTIONS.length,
    threshold,
  );
  const perCommission = suppressTable(
    reported.map((c) => [{ value: c.officers, officers: c.officers }]),
    1,
    threshold,
  );

  const national = Object.fromEntries(
    SECTIONS.map((s) => [s, sumOf(reported.map((c) => c.sections[s]))]),
  ) as Record<Cycle, Counts>;
  national.all = sumOf(SECTIONS.map((s) => national[s]));

  const filingRows: Row[] = [];
  const complianceRows: Row[] = [];
  const accessRows: Row[] = [];
  for (const [slug, row] of commissions) {
    const r = indexOf(slug);
    const commission = reported[r];
    const dimensions = { commission: slug, commissionName: row.name };
    for (const cycle of CYCLES) {
      const filingDimensions = { ...dimensions, reportStatus: row.status, cycle };
      if (!commission) {
        filingRows.push({
          ...filingDimensions,
          expected: null,
          filed: null,
          nonFilers: null,
          filingRate: null,
          suppressed: false,
        });
        continue;
      }
      const counts =
        cycle === 'all'
          ? sumOf(SECTIONS.map((s) => commission.sections[s]))
          : commission.sections[cycle];
      const cell =
        cycle === 'all' ? filing.rowTotals[r] : filing.cells[r]?.[SECTIONS.indexOf(cycle)];
      filingRows.push({ ...filingDimensions, ...filingFigures(counts, cell) });
    }
    const suppressed =
      commission !== undefined && (perCommission.cells[r]?.[0]?.suppressed ?? false);
    complianceRows.push({
      ...dimensions,
      ...Object.fromEntries(
        COMPLIANCE_FIGURES.map((name) => [
          name,
          commission && !suppressed ? commission.compliance[name] : null,
        ]),
      ),
      suppressed,
    });
    accessRows.push({
      ...dimensions,
      received: null,
      granted: null,
      declined: null,
      suppressed: false,
    });
  }

  const byCycleRows: Row[] = CYCLES.map((cycle) => ({
    cycle,
    ...filingFigures(
      national[cycle],
      cycle === 'all' ? filing.total : filing.columnTotals[SECTIONS.indexOf(cycle)],
    ),
  }));

  const complianceTotals = Object.fromEntries(
    COMPLIANCE_FIGURES.map((name) => [name, reported.reduce((t, c) => t + c.compliance[name], 0)]),
  ) as Record<ComplianceFigure, number>;
  const onTime = commissions.filter(([, row]) => row.status === 'submitted-on-time').length;
  const late = commissions.filter(([, row]) => row.status === 'submitted-late').length;
  const filingTotal = filingFigures(national.all, filing.total);
  const perCommissionSuppressed = perCommission.total.suppressed;
  const nationalValues: Record<NationalMeasure, { value: number | null; suppressed: boolean }> = {
    commissions: { value: commissions.length, suppressed: false },
    commissionsReported: { value: onTime + late, suppressed: false },
    commissionsReportedOnTime: { value: onTime, suppressed: false },
    commissionsReportedLate: { value: late, suppressed: false },
    commissionsNotReported: { value: commissions.length - onTime - late, suppressed: false },
    reportingRate: { value: rateOf(onTime + late, commissions.length), suppressed: false },
    expected: {
      value: filingTotal.expected as number | null,
      suppressed: filingTotal.suppressed as boolean,
    },
    filed: {
      value: filingTotal.filed as number | null,
      suppressed: filingTotal.suppressed as boolean,
    },
    nonFilers: {
      value: filingTotal.nonFilers as number | null,
      suppressed: filingTotal.suppressed as boolean,
    },
    filingRate: {
      value: filingTotal.filingRate as number | null,
      suppressed: filingTotal.suppressed as boolean,
    },
    ...(Object.fromEntries(
      COMPLIANCE_FIGURES.map((name) => [
        name,
        perCommissionSuppressed
          ? { value: null, suppressed: true }
          : { value: complianceTotals[name], suppressed: false },
      ]),
    ) as Record<ComplianceFigure, { value: number | null; suppressed: boolean }>),
    accessRequestsReceived: { value: null, suppressed: false },
    accessRequestsGranted: { value: null, suppressed: false },
    accessRequestsDeclined: { value: null, suppressed: false },
  };

  const tables: TableFiles = {
    'filing-by-commission': tableOf(
      'filing-by-commission',
      ['commission', 'commissionName', 'reportStatus', 'cycle', ...FILING_COLUMNS],
      filingRows,
      threshold,
    ),
    'compliance-by-commission': tableOf(
      'compliance-by-commission',
      ['commission', 'commissionName', ...COMPLIANCE_FIGURES, 'suppressed'],
      complianceRows,
      threshold,
    ),
    'by-entity-type': tableOf(
      'by-entity-type',
      ['entityType', 'cycle', ...FILING_COLUMNS],
      [],
      threshold,
    ),
    'by-cycle': tableOf('by-cycle', ['cycle', ...FILING_COLUMNS], byCycleRows, threshold),
    'access-requests': tableOf(
      'access-requests',
      ['commission', 'commissionName', ...ACCESS_MEASURES, 'suppressed'],
      accessRows,
      threshold,
      ACCESS_MEASURES,
    ),
    'national-totals': tableOf(
      'national-totals',
      ['measure', 'value', 'suppressed'],
      NATIONAL_MEASURES.map((measure) => ({ measure, ...nationalValues[measure] })),
      threshold,
      ACCESS_NATIONAL,
    ),
  };
  return { tables, totals: { declared: national.all.declared, expected: national.all.expected } };
}
