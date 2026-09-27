import { describe, expect, it } from 'vitest';

import { failureReason, importEnded, importProgress } from './import-progress';

describe('importProgress', () => {
  it('reads the file until the rows are known', () => {
    expect(importProgress({ state: 'pending', totalRows: null, processedRows: 0 })).toEqual({
      kind: 'reading',
    });
    expect(importProgress({ state: 'processing', totalRows: null, processedRows: 0 })).toEqual({
      kind: 'reading',
    });
  });

  it('counts the rows applied, rounding down', () => {
    expect(
      importProgress({ state: 'processing', totalRows: 48_431, processedRows: 21_400 }),
    ).toEqual({ kind: 'rows', processed: 21_400, total: 48_431, percent: 44 });
    expect(importProgress({ state: 'processing', totalRows: 1000, processedRows: 999 })).toEqual({
      kind: 'rows',
      processed: 999,
      total: 1000,
      percent: 99,
    });
  });

  it('is full once completed, and for an empty file', () => {
    expect(importProgress({ state: 'completed', totalRows: 3, processedRows: 3 })).toMatchObject({
      percent: 100,
    });
    expect(importProgress({ state: 'processing', totalRows: 0, processedRows: 0 })).toMatchObject({
      percent: 100,
    });
  });

  it('keeps the processed count within the total', () => {
    expect(importProgress({ state: 'processing', totalRows: 10, processedRows: 12 })).toMatchObject(
      { processed: 10, percent: 100 },
    );
  });
});

describe('importEnded', () => {
  it('stops polling on completed and failed', () => {
    expect(importEnded({ state: 'pending' })).toBe(false);
    expect(importEnded({ state: 'processing' })).toBe(false);
    expect(importEnded({ state: 'completed' })).toBe(true);
    expect(importEnded({ state: 'failed' })).toBe(true);
  });
});

describe('failureReason', () => {
  it('names the missing columns', () => {
    expect(failureReason({ code: 'missing-columns', detail: 'national_id' })).toBe(
      'the file has no national_id column',
    );
    expect(failureReason({ code: 'missing-columns', detail: 'national_id, full_name' })).toBe(
      'the file has no national_id, full_name column',
    );
    expect(failureReason({ code: 'missing-columns', detail: '' })).toBe(
      'a required column is missing',
    );
  });

  it('names the row that could not be read when the detail is one', () => {
    expect(failureReason({ code: 'parse-error', detail: '8214' })).toBe(
      'row 8,214 could not be read',
    );
    expect(failureReason({ code: 'parse-error', detail: 'Unexpected end of zip' })).toBe(
      'the file could not be read',
    );
  });

  it('gives a plain reason for the other codes', () => {
    expect(failureReason({ code: 'internal', detail: 'boom' })).toBe(
      'a system error interrupted it',
    );
    expect(failureReason({ code: 'storage-error', detail: '' })).toBe(
      'the file could not be read from storage',
    );
    expect(failureReason({ code: 'upload-not-clean', detail: '' })).toBe(
      'the file had not passed the security scan',
    );
  });
});
