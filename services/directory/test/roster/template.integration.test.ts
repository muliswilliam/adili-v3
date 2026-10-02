import { beforeAll, describe, expect, it } from 'vitest';

import { ROSTER_COLUMNS } from '../../src/roster/columns.js';
import { type Caller, type DirectoryApi, startDirectoryApi } from '../support/directory-api.js';
import { columnText, readXlsx, rowValues, sheet } from '../support/xlsx.js';

/** Spec 02 S1: downloading the roster template over HTTP. */
const PSC_REPORTING_OFFICER: Caller = { tenant: 'psc', roles: ['reporting-officer'] };
const PSC_COMMISSION_ADMIN: Caller = { tenant: 'psc', roles: ['commission-admin'] };
const PLATFORM_ADMIN: Caller = { tenant: 'platform', roles: ['platform-admin'] };
const EACC_ANALYST: Caller = { tenant: 'eacc', roles: ['eacc-analyst'] };
const EACC_SUPERVISOR: Caller = { tenant: 'eacc', roles: ['eacc-supervisor'] };
const PSC_REVIEWER: Caller = { tenant: 'psc', roles: ['reviewer'] };
const DECLARANT: Caller = { tenant: 'psc', roles: ['declarant'] };

const HEADERS = ROSTER_COLUMNS.map((column) => column.name);

let api: DirectoryApi;

beforeAll(async () => {
  api = await startDirectoryApi();
  return () => api.close();
});

describe('GET /v1/roster/template', () => {
  it('sends the CSV template as an attachment', async () => {
    const response = await api.get('/v1/roster/template?format=csv', PSC_REPORTING_OFFICER);

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(response.headers['content-disposition']).toBe(
      'attachment; filename="adili-roster-template.csv"',
    );
    // After the UTF-8 byte order mark.
    const [headers, sample] = response.rawPayload.subarray(3).toString('utf8').split('\r\n');
    expect(headers?.split(',')).toEqual(HEADERS);
    expect(sample).toContain(ROSTER_COLUMNS[0].example);
  });

  it('sends the XLSX template with its Roster and Notes sheets', async () => {
    const response = await api.get('/v1/roster/template?format=xlsx', PSC_REPORTING_OFFICER);

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(response.headers['content-disposition']).toBe(
      'attachment; filename="adili-roster-template.xlsx"',
    );
    expect(Number(response.headers['content-length'])).toBe(response.rawPayload.length);

    const workbook = await readXlsx(response.rawPayload);
    const roster = sheet(workbook, 'Roster');
    expect(rowValues(roster, 1)).toEqual(HEADERS);
    expect(roster.getCell('K2').value).toBe('0712345678');
    expect(roster.getCell('K2').numFmt).toBe('@');
    const notes = sheet(workbook, 'Notes');
    expect(columnText(notes, 1, 2).slice(0, HEADERS.length)).toEqual(HEADERS);
  });

  it.each([
    ['commission-admin', PSC_COMMISSION_ADMIN],
    ['platform-admin', PLATFORM_ADMIN],
    ['eacc-analyst', EACC_ANALYST],
    ['eacc-supervisor', EACC_SUPERVISOR],
  ])('is open to %s', async (_role, caller) => {
    const response = await api.get('/v1/roster/template?format=csv', caller);

    expect(response.statusCode).toBe(200);
  });

  it.each([
    ['reviewer', PSC_REVIEWER],
    ['declarant', DECLARANT],
  ])('refuses %s', async (_role, caller) => {
    const response = await api.get('/v1/roster/template?format=xlsx', caller);

    expect(response.statusCode).toBe(403);
    expect(response.headers['content-type']).toMatch(/^application\/problem\+json/);
  });

  it.each(['/v1/roster/template', '/v1/roster/template?format=pdf'])(
    'answers 400 to %s',
    async (url) => {
      const response = await api.get(url, PSC_REPORTING_OFFICER);

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ status: 400, errors: [{ path: 'format' }] });
    },
  );
});
