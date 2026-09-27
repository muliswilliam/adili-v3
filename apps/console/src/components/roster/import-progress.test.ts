import { describe, expect, it } from 'vitest';

import { failureDetail, failureReason, importEnded, importProgress } from './import-progress';

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
  it('gives a plain reason for each code', () => {
    expect(failureReason({ code: 'missing-columns' })).toBe('a required column is missing');
    expect(failureReason({ code: 'parse-error' })).toBe('the file could not be read');
    expect(failureReason({ code: 'internal' })).toBe('a system error interrupted it');
    expect(failureReason({ code: 'storage-error' })).toBe(
      'the file could not be read from storage',
    );
    expect(failureReason({ code: 'upload-not-clean' })).toBe(
      'the file had not passed the security scan',
    );
  });
});

describe('failureDetail', () => {
  it('passes on what to fix in the file', () => {
    const detail = 'The file has no national_id column. Add it and upload the file again.';
    expect(failureDetail({ code: 'missing-columns', detail })).toBe(detail);
    expect(failureDetail({ code: 'parse-error', detail: ' Row 8214: unclosed quote. ' })).toBe(
      'Row 8214: unclosed quote.',
    );
  });

  it('leaves out details that add nothing', () => {
    expect(failureDetail({ code: 'missing-columns', detail: '  ' })).toBeNull();
    expect(
      failureDetail({
        code: 'internal',
        detail: 'Rows could not be applied. Rows already applied are kept.',
      }),
    ).toBeNull();
  });
});
