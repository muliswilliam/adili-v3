import { describe, expect, it } from 'vitest';

import { ROSTER_COLUMNS } from '../../src/roster/columns.js';
import { parseRosterFile } from '../../src/roster/roster-file.js';
import { rosterTemplate, type RosterTemplateFormat } from '../../src/roster/template.js';
import { columnText, readXlsx, rowValues, sheet } from '../support/xlsx.js';

/** Spec 02 S1, file contents: the template is generated from the parser's column definitions. */
const HEADERS = [
  'personnel_file_number',
  'full_name',
  'national_id',
  'designation',
  'job_group',
  'reporting_entity',
  'appointment_date',
  'email',
  'phone',
  'employer_code',
];

describe('roster columns', () => {
  it('are the nine spec 02 columns and the employer code, three of them required', () => {
    expect(ROSTER_COLUMNS.map((column) => column.name)).toEqual(HEADERS);
    expect(ROSTER_COLUMNS.filter((column) => column.required).map((column) => column.name)).toEqual(
      ['personnel_file_number', 'full_name', 'national_id'],
    );
    expect(ROSTER_COLUMNS.filter((column) => column.textCell).map((column) => column.name)).toEqual(
      ['personnel_file_number', 'national_id', 'phone', 'employer_code'],
    );
  });
});

describe('rosterTemplate', () => {
  it('writes a UTF-8 CSV with the headers and the sample row', async () => {
    const file = await rosterTemplate('csv');

    expect(file.fileName).toBe('adili-roster-template.csv');
    expect(file.contentType).toBe('text/csv; charset=utf-8');
    expect([...file.body.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const lines = file.body.subarray(3).toString('utf8').split('\r\n');
    expect(lines).toEqual([
      HEADERS.join(','),
      // RFC 4180: a value with a comma is quoted.
      ROSTER_COLUMNS.map(({ example }) => (example.includes(',') ? `"${example}"` : example)).join(
        ',',
      ),
      '',
    ]);
  });

  it.each<RosterTemplateFormat>(['csv', 'xlsx'])(
    'writes a %s the roster file parser reads with every column matched',
    async (format) => {
      const parsed = await parseRosterFile((await rosterTemplate(format)).body, format, {
        today: '2026-09-28',
      });
      if (!parsed.ok) throw new Error(`missing ${parsed.missingRequired.join(', ')}`);

      expect(parsed.mapping.matched.map(({ field }) => field)).toEqual(HEADERS);
      expect(parsed.mapping).toMatchObject({ ignored: [], missing: [] });
      const rows = [];
      for await (const row of parsed.rows) rows.push(row);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: 'accepted', errors: [] });
      expect(rows[0]?.raw).toEqual(
        Object.fromEntries(ROSTER_COLUMNS.map(({ field, example }) => [field, example])),
      );
    },
  );

  it('writes an XLSX with a Roster sheet whose identifier columns are text', async () => {
    const file = await rosterTemplate('xlsx');

    expect(file.fileName).toBe('adili-roster-template.xlsx');
    expect(file.contentType).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    const workbook = await readXlsx(file.body);
    expect(workbook.worksheets.map((worksheet) => worksheet.name)).toEqual(['Roster', 'Notes']);

    const roster = sheet(workbook, 'Roster');
    expect(rowValues(roster, 1)).toEqual(HEADERS);
    expect(rowValues(roster, 2)).toEqual(ROSTER_COLUMNS.map((column) => column.example));
    expect(roster.rowCount).toBe(2);
    ROSTER_COLUMNS.forEach((column, index) => {
      const numFmt = column.textCell ? '@' : undefined;
      // The sample cell and cells HR staff add later (the column style) alike.
      expect(roster.getRow(2).getCell(index + 1).numFmt, column.name).toBe(numFmt);
      expect(roster.getColumn(index + 1).numFmt, column.name).toBe(numFmt);
    });
    expect(roster.getCell('I2').value).toBe('0712345678');
  });

  it('documents every column on the Notes sheet', async () => {
    const workbook = await readXlsx((await rosterTemplate('xlsx')).body);
    const notes = sheet(workbook, 'Notes');

    expect(rowValues(notes, 1)).toEqual(['Column', 'Required', 'Format', 'Example', 'Notes']);
    ROSTER_COLUMNS.forEach((column, index) => {
      expect(rowValues(notes, index + 2)).toEqual([
        column.name,
        column.required ? 'Yes' : 'No',
        column.format,
        column.example,
        column.note,
      ]);
    });
    const guidance = columnText(notes, 1, ROSTER_COLUMNS.length + 2).join(' ');
    expect(guidance).toContain('delete the sample row');
  });
});
