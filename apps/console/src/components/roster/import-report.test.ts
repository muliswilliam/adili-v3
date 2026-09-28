import { describe, expect, it } from 'vitest';

import type { DirectoryError } from '../../server/directory/client';
import {
  columnName,
  importRunning,
  reportCsvUrl,
  reportFileName,
  rowFileNumber,
  rowsFailure,
  rowsPurged,
  runningImportId,
} from './import-report';

const problem = (status: number, extra: Record<string, unknown> = {}): DirectoryError => ({
  kind: 'problem',
  problem: { type: 'about:blank', title: 'Problem', status, ...extra },
});

describe('columnName', () => {
  it('spells the directory field as the template column', () => {
    expect(columnName('personnelFileNumber')).toBe('personnel_file_number');
    expect(columnName('nationalId')).toBe('national_id');
    expect(columnName('email')).toBe('email');
    expect(columnName('appointmentDate')).toBe('appointment_date');
  });
});

describe('rowFileNumber', () => {
  it('reads the file number as sent, or none', () => {
    expect(rowFileNumber({ raw: { personnelFileNumber: ' PSC/2019/0888 ' } })).toBe(
      'PSC/2019/0888',
    );
    expect(rowFileNumber({ raw: { personnelFileNumber: '' } })).toBeNull();
    expect(rowFileNumber({ raw: { personnelFileNumber: null } })).toBeNull();
    expect(rowFileNumber({ raw: {} })).toBeNull();
  });
});

describe('rowsPurged', () => {
  const now = new Date('2026-10-28T09:00:00Z');

  it('is false while the import runs or its rows are kept', () => {
    expect(rowsPurged({ rowsRetainedUntil: null }, now)).toBe(false);
    expect(rowsPurged({ rowsRetainedUntil: '2026-10-28T09:00:01Z' }, now)).toBe(false);
  });

  it('is true once the retention date has passed', () => {
    expect(rowsPurged({ rowsRetainedUntil: '2026-10-28T09:00:00Z' }, now)).toBe(true);
    expect(rowsPurged({ rowsRetainedUntil: '2026-10-01T00:00:00Z' }, now)).toBe(true);
  });
});

describe('rowsFailure', () => {
  it('tells purged rows and the Commission-only rule from other failures', () => {
    expect(rowsFailure(problem(410))).toBe('purged');
    expect(rowsFailure(problem(403))).toBe('commission-only');
    expect(rowsFailure(problem(404))).toBe('failed');
    expect(rowsFailure({ kind: 'unavailable', detail: null })).toBe('failed');
  });
});

describe('reportFileName', () => {
  it("follows the directory's name for the rejected rows CSV", () => {
    expect(reportFileName('psc-roster-2026-09-25.xlsx')).toBe(
      'psc-roster-2026-09-25-rejected-rows.csv',
    );
    expect(reportFileName('PSC roster (Sep).csv')).toBe('PSC-roster-Sep-rejected-rows.csv');
    expect(reportFileName(null)).toBe('roster-import-rejected-rows.csv');
    expect(reportFileName('.csv')).toBe('roster-import-rejected-rows.csv');
  });
});

describe('reportCsvUrl', () => {
  it("is the console's own route for the import", () => {
    expect(reportCsvUrl('0199a0b4-0000-7000-8000-0000000000aa')).toBe(
      '/roster/imports/0199a0b4-0000-7000-8000-0000000000aa/report.csv',
    );
  });
});

describe('runningImportId', () => {
  const id = '0199a0b4-0000-7000-8000-0000000000bb';

  it('reads the running import from a 409 import-in-progress', () => {
    expect(runningImportId(problem(409, { type: 'import-in-progress', importId: id }))).toBe(id);
  });

  it('is null when the answer names none', () => {
    expect(runningImportId(problem(409, { type: 'import-in-progress' }))).toBeNull();
    expect(runningImportId(problem(409, { importId: '' }))).toBeNull();
    expect(runningImportId(problem(404, { importId: id }))).toBeNull();
    expect(runningImportId({ kind: 'unavailable', detail: null })).toBeNull();
  });
});

describe('importRunning', () => {
  it('is true until the import completes or fails', () => {
    expect(importRunning({ state: 'pending' })).toBe(true);
    expect(importRunning({ state: 'processing' })).toBe(true);
    expect(importRunning({ state: 'completed' })).toBe(false);
    expect(importRunning({ state: 'failed' })).toBe(false);
  });
});
