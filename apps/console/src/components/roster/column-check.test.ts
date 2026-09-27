import { describe, expect, it } from 'vitest';

import type {
  DirectoryError,
  RosterImportPreview,
  RosterSummary,
} from '../../server/directory/client';
import {
  checkFailure,
  defaultDeclaredComplete,
  mappingRows,
  needsNewIdempotencyKey,
  startFailure,
} from './column-check';

const problem = (status: number, type = 'about:blank'): DirectoryError => ({
  kind: 'problem',
  problem: { type, title: 'Problem', status },
});

const summary = (overrides: Partial<RosterSummary> = {}): RosterSummary => ({
  status: 'imported',
  expectedDeclarants: 120,
  onboardedDeclarants: 30,
  flagged: 0,
  lastImportAt: '2026-09-20T08:00:00Z',
  lastImportId: '0199a0b4-0000-7000-8000-000000000001',
  lastCompleteImportAt: '2026-09-20T08:00:00Z',
  ...overrides,
});

describe('mappingRows (S24 header mapping preview)', () => {
  const preview = (overrides: Partial<RosterImportPreview>): RosterImportPreview => ({
    uploadId: '0199a0b4-0000-7000-8000-000000000001',
    fileName: 'roster.csv',
    format: 'csv',
    mapping: { matched: [], ignored: [], missing: [] },
    missingRequired: [],
    estimatedRows: 3,
    ...overrides,
  });

  it('lists missing required columns, then matched, not in file, ignored', () => {
    expect(
      mappingRows(
        preview({
          mapping: {
            matched: [
              { source: 'File No', field: 'personnel_file_number' },
              { source: 'Full Name', field: 'full_name' },
            ],
            ignored: ['ID Number (old)'],
            missing: ['designation', 'phone'],
          },
          missingRequired: ['national_id'],
        }),
      ),
    ).toEqual([
      { status: 'missing', field: 'national_id' },
      { status: 'matched', source: 'File No', field: 'personnel_file_number' },
      { status: 'matched', source: 'Full Name', field: 'full_name' },
      { status: 'not-in-file', field: 'designation' },
      { status: 'not-in-file', field: 'phone' },
      { status: 'ignored', source: 'ID Number (old)' },
    ]);
  });

  it('keeps the file order of matched columns', () => {
    const rows = mappingRows(
      preview({
        mapping: {
          matched: [
            { source: 'national id', field: 'national_id' },
            { source: 'personnelFileNumber', field: 'personnel_file_number' },
            { source: 'FULL_NAME', field: 'full_name' },
          ],
          ignored: [],
          missing: [],
        },
      }),
    );
    expect(rows.map((row) => (row.status === 'ignored' ? row.source : row.field))).toEqual([
      'national_id',
      'personnel_file_number',
      'full_name',
    ]);
  });
});

describe('defaultDeclaredComplete', () => {
  it('ticks the box on a first import', () => {
    expect(defaultDeclaredComplete(summary({ status: 'none', expectedDeclarants: 0 }))).toBe(true);
    expect(defaultDeclaredComplete(summary({ expectedDeclarants: 0 }))).toBe(true);
  });

  it('leaves it unticked when there is a roster, or it could not be read', () => {
    expect(defaultDeclaredComplete(summary())).toBe(false);
    expect(defaultDeclaredComplete(null)).toBe(false);
  });
});

describe('checkFailure', () => {
  it('sends the officer back to upload when the upload is gone or not clean', () => {
    expect(checkFailure(problem(404))).toBe('upload-gone');
    expect(checkFailure(problem(409, 'upload-not-clean'))).toBe('upload-gone');
  });

  it('says the file cannot be read on 422', () => {
    expect(checkFailure(problem(422, 'parse-error'))).toBe('unreadable');
  });

  it('offers a retry otherwise', () => {
    expect(checkFailure({ kind: 'unavailable', detail: null })).toBe('failed');
    expect(checkFailure(problem(403))).toBe('failed');
  });
});

describe('startFailure', () => {
  it('maps the refusals the step explains', () => {
    expect(startFailure(problem(409, 'import-in-progress'))).toBe('running');
    expect(startFailure(problem(409, 'upload-not-clean'))).toBe('upload-gone');
    expect(startFailure(problem(404))).toBe('upload-gone');
    expect(startFailure(problem(429, 'rate-limited'))).toBe('limited');
    expect(startFailure(problem(400))).toBe('failed');
    expect(startFailure({ kind: 'unavailable', detail: null })).toBe('failed');
  });
});

describe('needsNewIdempotencyKey', () => {
  it('keeps the key after a timeout or outage, not after a problem answer', () => {
    expect(needsNewIdempotencyKey({ kind: 'unavailable', detail: null })).toBe(false);
    expect(needsNewIdempotencyKey(problem(409, 'import-in-progress'))).toBe(true);
  });
});
