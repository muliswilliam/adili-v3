import { createReadStream, readFileSync } from 'node:fs';

import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import { ROSTER_COLUMNS } from '../../src/roster/columns.js';
import {
  parseRosterFile,
  type ParsedRosterRow,
  type RosterFile,
} from '../../src/roster/roster-file.js';
import { RosterFileError } from '../../src/roster/sheet.js';

const TODAY = '2026-09-28';

function fixture(name: string): URL {
  return new URL(`fixtures/${name}`, import.meta.url);
}

async function parsed(file: RosterFile): Promise<ParsedRosterRow[]> {
  if (!file.ok) throw new Error(`missing ${file.missingRequired.join(', ')}`);
  const rows: ParsedRosterRow[] = [];
  for await (const row of file.rows) rows.push(row);
  return rows;
}

async function workbook(build: (workbook: ExcelJS.Workbook) => void): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  build(book);
  return Buffer.from(await book.xlsx.writeBuffer());
}

describe('parseRosterFile: CSV', () => {
  it('maps headers ignoring case and whitespace, reports unknown columns, normalises rows', async () => {
    const file = await parseRosterFile(createReadStream(fixture('roster-comma.csv')), 'csv', {
      today: TODAY,
    });

    expect(file.mapping).toEqual({
      matched: [
        { source: 'Personnel File Number', field: 'personnel_file_number' },
        { source: ' FULL_NAME ', field: 'full_name' },
        { source: 'national_id', field: 'national_id' },
        { source: 'designation', field: 'designation' },
        { source: 'job_group', field: 'job_group' },
        { source: 'reporting_entity', field: 'reporting_entity' },
        { source: 'appointment_date', field: 'appointment_date' },
        { source: 'email', field: 'email' },
        { source: 'phone', field: 'phone' },
      ],
      ignored: ['Station Code'],
      // Spec 05b's columns, which the fixture predates.
      missing: ['work_station', 'marital_status'],
    });

    const rows = await parsed(file);
    expect(rows.map((row) => [row.rowNumber, row.status])).toEqual([
      [2, 'accepted'],
      [3, 'accepted'],
      [5, 'accepted'],
    ]);
    expect(rows[0]).toMatchObject({
      raw: { personnelFileNumber: 'TSC/000123', fullName: '  Achieng   Mary Otieno ' },
      normalised: {
        personnelFileNumber: 'TSC/000123',
        fullName: 'Achieng Mary Otieno',
        nationalId: '23456789',
        designation: 'Senior Teacher',
        jobGroup: 'C3',
        reportingEntity: 'Moi Girls High School, Eldoret',
        appointmentDate: '2019-01-07',
        email: 'mary.otieno@example.go.ke',
        phone: '+254712345678',
      },
      errors: [],
    });
    expect(rows[1]?.normalised).toEqual({
      personnelFileNumber: 'tsc/000124',
      fullName: 'Kiprono Kipchumba',
      nationalId: '12345678',
      designation: null,
      jobGroup: null,
      reportingEntity: null,
      workStation: null,
      appointmentDate: null,
      maritalStatus: null,
      email: null,
      phone: null,
    });
    expect(rows[2]?.normalised).toMatchObject({
      fullName: 'Wanjiru "Shiru" Kamau',
      appointmentDate: '2020-02-29',
      phone: '+254110123456',
    });
    expect(file.ok && file.totals).toEqual({ rows: 3, accepted: 3, rejected: 0 });
  });

  it('detects a semicolon delimiter and strips a UTF-8 BOM (CRLF lines)', async () => {
    const file = await parseRosterFile(readFileSync(fixture('roster-semicolon-bom.csv')), 'csv', {
      today: TODAY,
    });

    expect(file.mapping.matched.map((match) => match.source)).toEqual([
      'personnel_file_number',
      'full_name',
      'national_id',
      'appointment_date',
      'phone',
    ]);
    expect(file.mapping.missing).toEqual([
      'designation',
      'job_group',
      'reporting_entity',
      'work_station',
      'marital_status',
      'email',
    ]);
    const rows = await parsed(file);
    expect(rows.map((row) => row.normalised)).toEqual([
      expect.objectContaining({
        personnelFileNumber: 'PSC/9/001',
        appointmentDate: '2018-03-15',
        phone: '+254722000111',
      }),
      expect.objectContaining({ personnelFileNumber: 'PSC/9/002', fullName: 'Abdi; Halima' }),
    ]);
  });

  it('fails the whole file when a required column is missing, before reading rows', async () => {
    const file = await parseRosterFile(
      createReadStream(fixture('roster-missing-required.csv')),
      'csv',
    );

    expect(file).toEqual({
      ok: false,
      missingRequired: ['national_id'],
      mapping: {
        matched: [
          { source: 'personnel_file_number', field: 'personnel_file_number' },
          { source: 'full_name', field: 'full_name' },
          { source: 'designation', field: 'designation' },
        ],
        ignored: [],
        missing: [
          'job_group',
          'reporting_entity',
          'work_station',
          'appointment_date',
          'marital_status',
          'email',
          'phone',
        ],
      },
    });
  });

  it('rejects each row that breaks a validation rule with the field and code', async () => {
    const file = await parseRosterFile(
      createReadStream(fixture('roster-invalid-rows.csv')),
      'csv',
      { today: TODAY },
    );
    const rows = await parsed(file);

    const outcome = rows.map((row) => ({
      row: row.rowNumber,
      errors: row.errors.map((error) => `${error.field}:${error.code}`),
    }));
    expect(outcome).toEqual([
      { row: 2, errors: [] },
      { row: 3, errors: ['personnelFileNumber:required'] },
      { row: 4, errors: ['personnelFileNumber:too-long'] },
      { row: 5, errors: ['personnelFileNumber:format'] },
      { row: 6, errors: ['fullName:required'] },
      { row: 7, errors: ['fullName:format'] },
      { row: 8, errors: ['fullName:too-long'] },
      { row: 9, errors: ['nationalId:required'] },
      { row: 10, errors: ['nationalId:format'] },
      { row: 11, errors: ['nationalId:format'] },
      { row: 12, errors: ['nationalId:format'] },
      { row: 13, errors: ['designation:too-long'] },
      { row: 14, errors: ['jobGroup:too-long'] },
      { row: 15, errors: ['reportingEntity:too-long'] },
      { row: 16, errors: ['appointmentDate:format'] },
      { row: 17, errors: ['appointmentDate:format'] },
      { row: 18, errors: ['appointmentDate:future-date'] },
      { row: 19, errors: ['email:format'] },
      { row: 20, errors: ['email:too-long'] },
      { row: 21, errors: ['phone:format'] },
      { row: 22, errors: ['phone:too-long'] },
      { row: 23, errors: ['personnelFileNumber:duplicate-in-file'] },
      { row: 24, errors: ['nationalId:duplicate-in-file'] },
    ]);
    expect(rows.every((row) => row.status === (row.errors.length ? 'rejected' : 'accepted'))).toBe(
      true,
    );
    expect(rows.at(-2)?.errors[0]?.message).toBe('Same file number as row 2');
    expect(rows.at(-1)?.errors[0]?.message).toBe('Same national ID as row 2');
    expect(file.ok && file.totals).toEqual({ rows: 23, accepted: 1, rejected: 22 });
  });

  it('reports every error of a row, not just the first', async () => {
    const csv = 'personnel_file_number,full_name,national_id,email\n,X,12,nope\n';
    const rows = await parsed(await parseRosterFile(Buffer.from(csv), 'csv'));

    expect(rows[0]?.errors.map((error) => error.field)).toEqual([
      'personnelFileNumber',
      'fullName',
      'nationalId',
      'email',
    ]);
  });

  it('matches camelCase and hyphenated headers', async () => {
    const csv = 'personnelFileNumber,Full-Name,NATIONAL ID\nA1,Jane Doe,12345678\n';
    const file = await parseRosterFile(Buffer.from(csv), 'csv');

    expect(file.mapping.matched.map((match) => match.field)).toEqual([
      'personnel_file_number',
      'full_name',
      'national_id',
    ]);
  });

  it('can be closed after reading only the mapping', async () => {
    const file = await parseRosterFile(createReadStream(fixture('roster-comma.csv')), 'csv');
    if (!file.ok) throw new Error('expected a readable file');

    await file.close();
    expect(await parsed(file)).toEqual([]);
  });

  it('treats a repeated header as ignored and keeps the first', async () => {
    const csv =
      'personnel_file_number,full_name,national_id,Full Name\nA1,Jane Doe,12345678,Other\n';
    const file = await parseRosterFile(Buffer.from(csv), 'csv');

    expect(file.mapping.ignored).toEqual(['Full Name']);
    expect((await parsed(file))[0]?.normalised?.fullName).toBe('Jane Doe');
  });

  it('refuses an unterminated quote and an empty file', async () => {
    const broken = 'personnel_file_number,full_name,national_id\nA1,"Jane,12345678\n';
    const readAll = async () => parsed(await parseRosterFile(Buffer.from(broken), 'csv'));

    await expect(readAll()).rejects.toThrow(RosterFileError);
    await expect(parseRosterFile(Buffer.from('\n\n'), 'csv')).rejects.toMatchObject({
      code: 'malformed',
    });
  });

  it('refuses a file with more rows than the limit', async () => {
    const csv =
      'personnel_file_number,full_name,national_id\nA1,Jane Doe,11111111\nA2,John Doe,22222222\n';
    const file = await parseRosterFile(Buffer.from(csv), 'csv', { maxRows: 1 });

    await expect(parsed(file)).rejects.toMatchObject({ code: 'too-many-rows' });
  });

  it('refuses a file that is not UTF-8, however far in, rather than garbling its names', async () => {
    const header = 'personnel_file_number,full_name,national_id\n';
    // Past what the documents service samples (8 KB) and past the first chunk.
    const valid = Array.from(
      { length: 3000 },
      (_, index) => `A${index},Jane Doe,${10_000_000 + index}\n`,
    ).join('');
    async function* chunks(): AsyncGenerator<Buffer> {
      yield Buffer.from(header + valid);
      await Promise.resolve();
      yield Buffer.from('B1,Ren\xe9 Otieno,33333333\n', 'latin1');
    }
    const readAll = async () => parsed(await parseRosterFile(chunks(), 'csv'));

    await expect(readAll()).rejects.toMatchObject({
      code: 'encoding',
      message: expect.stringContaining('CSV UTF-8') as unknown,
    });
    await expect(
      parseRosterFile(Buffer.from(`${header}B1,Ren\xe9,1\n`, 'latin1'), 'csv').then(parsed),
    ).rejects.toMatchObject({ code: 'encoding' });
    // A file cut off mid-character is not UTF-8 either.
    await expect(
      parseRosterFile(Buffer.from(`${header}B1,Wanjir\xc5`, 'latin1'), 'csv').then(parsed),
    ).rejects.toMatchObject({ code: 'encoding' });
  });

  it('passes on an error of the source stream part way', async () => {
    async function* failing(): AsyncGenerator<Buffer> {
      yield Buffer.from('personnel_file_number,full_name,national_id\nA1,Jane Doe,11111111\n');
      await Promise.resolve();
      throw new Error('connection reset');
    }
    const readAll = async () => parsed(await parseRosterFile(failing(), 'csv'));

    await expect(readAll()).rejects.toThrow('connection reset');
  });
});

describe('parseRosterFile: XLSX', () => {
  it('keeps leading zeros of numeric cells, converts date cells, reports unknown columns', async () => {
    const file = await workbook((book) => {
      const sheet = book.addWorksheet('Roster');
      sheet.addRow([...ROSTER_COLUMNS.map((column) => column.name), 'County']);
      const zeros = sheet.addRow([
        123,
        { richText: [{ text: 'Achieng ' }, { text: 'Otieno' }] },
        23456789,
        'Teacher',
        'C3',
        'Moi Girls',
        'Eldoret',
        new Date(Date.UTC(2019, 0, 7)),
        'Married',
        'A@B.CO.KE',
        712345678,
        'Uasin Gishu',
      ]);
      zeros.getCell(1).numFmt = '000000';
      zeros.getCell(8).numFmt = 'd-mmm-yy';
      zeros.getCell(11).numFmt = '0000000000';
      sheet.addRow([]);
      const text = sheet.addRow(['000456', 'Kiprono Kipchumba', '12345678']);
      text.getCell(8).value = '07/01/2019';
      const serial = sheet.addRow(['000457', 'Halima Abdi', 34567890]);
      serial.getCell(8).value = 43472; // 2019-0107 as a serial in a General cell: not a date cell
    });

    const parsedFile = await parseRosterFile(file, 'xlsx', { today: TODAY });
    expect(parsedFile.mapping.ignored).toEqual(['County']);
    const rows = await parsed(parsedFile);

    expect(rows.map((row) => row.rowNumber)).toEqual([2, 4, 5]);
    expect(rows[0]).toMatchObject({
      status: 'accepted',
      raw: { personnelFileNumber: '000123', appointmentDate: '2019-01-07', phone: '0712345678' },
      normalised: {
        personnelFileNumber: '000123',
        fullName: 'Achieng Otieno',
        nationalId: '23456789',
        workStation: 'Eldoret',
        appointmentDate: '2019-01-07',
        maritalStatus: 'married',
        email: 'a@b.co.ke',
        phone: '+254712345678',
      },
    });
    expect(rows[1]?.normalised).toMatchObject({
      personnelFileNumber: '000456',
      appointmentDate: '2019-01-07',
    });
    expect(rows[2]?.errors).toEqual([
      expect.objectContaining({ field: 'appointmentDate', code: 'format' }),
    ]);
  });

  it('reads date cells of a workbook on the 1904 date system', async () => {
    const file = await workbook((book) => {
      book.properties.date1904 = true;
      const sheet = book.addWorksheet('Roster');
      sheet.addRow(['personnel_file_number', 'full_name', 'national_id', 'appointment_date']);
      const row = sheet.addRow(['A1', 'Jane Doe', '12345678', new Date(Date.UTC(2019, 0, 7))]);
      row.getCell(4).numFmt = 'dd/mm/yyyy';
    });

    const rows = await parsed(await parseRosterFile(file, 'xlsx', { today: TODAY }));
    expect(rows[0]?.normalised?.appointmentDate).toBe('2019-01-07');
  });

  it('reads only the first sheet and fails on missing required columns', async () => {
    const file = await workbook((book) => {
      book.addWorksheet('Roster').addRow(['personnel_file_number', 'full_name']);
      book.addWorksheet('Notes').addRow(['national_id']);
    });

    expect(await parseRosterFile(file, 'xlsx')).toMatchObject({
      ok: false,
      missingRequired: ['national_id'],
    });
  });

  it('refuses a file that is not a workbook', async () => {
    await expect(parseRosterFile(Buffer.from('not a zip'), 'xlsx')).rejects.toMatchObject({
      code: 'malformed',
    });
  });
});
