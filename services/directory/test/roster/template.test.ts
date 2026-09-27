import { describe, expect, it } from 'vitest';

import { ROSTER_COLUMNS } from '../../src/roster/columns.js';
import { rosterTemplate } from '../../src/roster/template.js';
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
];

describe('roster columns', () => {
  it('are the nine spec 02 columns with the three required ones', () => {
    expect(ROSTER_COLUMNS.map((column) => column.name)).toEqual(HEADERS);
    expect(ROSTER_COLUMNS.filter((column) => column.required).map((column) => column.name)).toEqual(
      ['personnel_file_number', 'full_name', 'national_id'],
    );
    expect(ROSTER_COLUMNS.filter((column) => column.text).map((column) => column.name)).toEqual([
      'personnel_file_number',
      'phone',
    ]);
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
      ROSTER_COLUMNS.map((column) => column.example).join(','),
      '',
    ]);
    expect(lines[1]).toMatch(/^000123,/);
  });

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
      const numFmt = column.text ? '@' : undefined;
      // The sample cell and cells HR staff add later (the column style) alike.
      expect(roster.getRow(2).getCell(index + 1).numFmt, column.name).toBe(numFmt);
      expect(roster.getColumn(index + 1).numFmt, column.name).toBe(numFmt);
    });
    expect(roster.getCell('A2').value).toBe('000123');
  });

  it('documents every column on the Notes sheet', async () => {
    const workbook = await readXlsx((await rosterTemplate('xlsx')).body);
    const notes = sheet(workbook, 'Notes');

    expect(rowValues(notes, 1)).toEqual(['Column', 'Required', 'Format', 'Example']);
    ROSTER_COLUMNS.forEach((column, index) => {
      expect(rowValues(notes, index + 2)).toEqual([
        column.name,
        column.required ? 'Yes' : 'No',
        column.format,
        column.example,
      ]);
    });
    const guidance = columnText(notes, 1, ROSTER_COLUMNS.length + 2).join(' ');
    expect(guidance).toContain('delete the sample row');
  });
});
