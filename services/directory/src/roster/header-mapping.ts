import { ROSTER_COLUMNS, type RosterColumnName, type RosterField } from './columns.js';

/** `ColumnMapping` in the contract: how the file's header row lines up with the template. */
export interface ColumnMapping {
  /** File header (as written) and the template column it matched. */
  matched: { source: string; field: RosterColumnName }[];
  /** File headers that match no template column (or repeat one already matched). */
  ignored: string[];
  /** Optional template columns the file does not have. */
  missing: RosterColumnName[];
}

export interface HeaderMapping {
  mapping: ColumnMapping;
  /** Required template columns the file does not have; the file cannot be imported. */
  missingRequired: RosterColumnName[];
  /** Position of each matched field in the file's rows. */
  positions: { field: RosterField; index: number }[];
}

/**
 * Matches a header row against the template columns. Matching ignores case, whitespace, `_` and
 * `-`, so `personnel_file_number`, `Personnel File Number` and `personnelFileNumber` all match.
 * The first header matching a column wins; blank headers are skipped.
 */
export function mapHeader(headers: readonly string[]): HeaderMapping {
  const byKey = new Map(ROSTER_COLUMNS.map((column) => [headerKey(column.name), column]));
  const mapping: ColumnMapping = { matched: [], ignored: [], missing: [] };
  const positions: HeaderMapping['positions'] = [];
  const seen = new Set<RosterColumnName>();

  headers.forEach((source, index) => {
    const key = headerKey(source);
    if (key === '') return;
    const column = byKey.get(key);
    if (column === undefined || seen.has(column.name)) {
      mapping.ignored.push(source);
      return;
    }
    seen.add(column.name);
    mapping.matched.push({ source, field: column.name });
    positions.push({ field: column.field, index });
  });

  const missingRequired: RosterColumnName[] = [];
  for (const column of ROSTER_COLUMNS) {
    if (seen.has(column.name)) continue;
    if (column.required) missingRequired.push(column.name);
    else mapping.missing.push(column.name);
  }
  return { mapping, missingRequired, positions };
}

function headerKey(header: string): string {
  return header.toLowerCase().replace(/[\s_-]+/g, '');
}
