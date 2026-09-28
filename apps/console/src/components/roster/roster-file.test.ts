import { describe, expect, it } from 'vitest';

import { ROSTER_FILE_MAX_BYTES, rosterContentType, rosterFileFormat } from './roster-file';

describe('rosterFileFormat', () => {
  it.each([
    ['roster.csv', 'csv'],
    ['PSC Roster 2026.XLSX', 'xlsx'],
    [' roster.csv ', 'csv'],
    ['roster.xls', null],
    ['roster.csv.png', null],
    ['roster', null],
  ])('reads %s as %s', (name, expected) => {
    expect(rosterFileFormat(name)).toBe(expected);
  });
});

describe('rosterContentType', () => {
  it('declares the type from the name, not what the browser reports', () => {
    expect(rosterContentType('roster.csv')).toBe('text/csv');
    expect(rosterContentType('roster.xlsx')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(rosterContentType('photo.png')).toBeNull();
  });
});

it('limits roster files to 50 MB', () => {
  expect(ROSTER_FILE_MAX_BYTES).toBe(52_428_800);
});
