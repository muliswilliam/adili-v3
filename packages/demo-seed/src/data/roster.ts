import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from '../repo.js';

/** A roster row as the directory imports it (the roster template's columns). */
export interface RosterRow {
  personnelFileNumber: string;
  fullName: string;
  nationalId: string;
  designation: string;
  jobGroup: string;
  reportingEntity: string;
  employerCode: string;
  appointmentDate: string;
  email: string;
  phone: string;
}

/** The roster template's CSV columns, in order (`mocks/demo/rosters.py` `TEMPLATE_COLUMNS`). */
const CSV_COLUMNS: readonly [string, keyof RosterRow][] = [
  ['personnel_file_number', 'personnelFileNumber'],
  ['full_name', 'fullName'],
  ['national_id', 'nationalId'],
  ['designation', 'designation'],
  ['job_group', 'jobGroup'],
  ['reporting_entity', 'reportingEntity'],
  ['appointment_date', 'appointmentDate'],
  ['email', 'email'],
  ['phone', 'phone'],
  ['employer_code', 'employerCode'],
];

/**
 * What a Commission's roster holds for a record, in the fields a roster row sets. The list read
 * gives the first three; the rest come from the record's own read, which the seed makes only for
 * the named officers (undefined: not read, not compared).
 */
export interface HeldRow {
  fullName: string;
  designation: string | null;
  jobGroup: string | null;
  nationalId?: string;
  appointmentDate?: string | null;
  email?: string | null;
  phone?: string | null;
}

/**
 * The fields where the roster's record differs from the row the seed wants it to hold, as the
 * import would normalise the row: a re-import is due when any does. This is how a re-run of the
 * seed puts back a record a stale roster file changed (#679), or brings a stack seeded before a
 * fixture changed up to date.
 */
export function rosterDrift(held: HeldRow, row: RosterRow): (keyof HeldRow)[] {
  const wanted: Required<HeldRow> = {
    fullName: collapse(row.fullName) ?? '',
    designation: collapse(row.designation),
    jobGroup: collapse(row.jobGroup),
    nationalId: row.nationalId.trim(),
    appointmentDate: collapse(row.appointmentDate),
    email: collapse(row.email)?.toLowerCase() ?? null,
    phone: collapse(row.phone),
  };
  return (Object.keys(wanted) as (keyof HeldRow)[]).filter(
    (field) => held[field] !== undefined && held[field] !== wanted[field],
  );
}

function collapse(value: string): string | null {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  return collapsed === '' ? null : collapsed;
}

/** A fixture officer: the roster row and what IPRS holds besides. */
export interface FixtureOfficer extends RosterRow {
  dateOfBirth: string;
  placeOfBirth: string;
}

/**
 * The named officers of a Commission's roster fixture (`mocks/demo/fixtures/rosters/<slug>.csv`):
 * the same file the mocks build their IPRS, KRA and HR records from, so the two always agree.
 */
export function fixtureRoster(slug: string): FixtureOfficer[] {
  const path = join(REPO_ROOT, 'mocks/demo/fixtures/rosters', `${slug}.csv`);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return [];
  }
  const [header, ...lines] = parseCsv(text);
  if (!header) return [];
  const at = (name: string) => header.indexOf(name);
  return lines
    .filter((cells) => cells.length > 1)
    .map((cells) => ({
      personnelFileNumber: cells[at('personnelFileNumber')] ?? '',
      fullName: cells[at('fullName')] ?? '',
      nationalId: cells[at('nationalId')] ?? '',
      designation: cells[at('designation')] ?? '',
      jobGroup: cells[at('jobGroup')] ?? '',
      reportingEntity: cells[at('reportingEntity')] ?? '',
      employerCode: cells[at('employerCode')] ?? '',
      appointmentDate: cells[at('appointmentDate')] ?? '',
      email: cells[at('email')] ?? '',
      phone: cells[at('phone')] ?? '',
      dateOfBirth: cells[at('dateOfBirth')] ?? '',
      placeOfBirth: cells[at('placeOfBirth')] ?? '',
    }));
}

/** Rows as a roster file in the template's columns. */
export function rosterCsv(rows: readonly RosterRow[]): string {
  const lines = [CSV_COLUMNS.map(([column]) => column).join(',')];
  for (const row of rows) lines.push(CSV_COLUMNS.map(([, key]) => csvCell(row[key])).join(','));
  return `${lines.join('\n')}\n`;
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** RFC 4180 enough for the fixtures: quoted cells with commas and doubled quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text.charAt(i);
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
