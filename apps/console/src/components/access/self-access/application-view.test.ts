import { describe, expect, it } from 'vitest';

import {
  applicationState,
  declarationYear,
  deadlineRuns,
  identityNoteOf,
  recordFailure,
} from './application-view';

const copy = (status: 'pending' | 'issued' | 'failed') =>
  ({ status }) as Parameters<typeof applicationState>[0]['certifiedCopy'];

describe('applicationState', () => {
  it('follows the certified copy until it is issued, then the hand-over', () => {
    expect(
      applicationState({
        status: 'recorded',
        deliveryMethod: 'collection',
        certifiedCopy: copy('pending'),
      }),
    ).toBe('preparing');
    expect(
      applicationState({
        status: 'recorded',
        deliveryMethod: 'collection',
        certifiedCopy: copy('failed'),
      }),
    ).toBe('failed');
    expect(
      applicationState({
        status: 'issued',
        deliveryMethod: 'dispatch',
        certifiedCopy: copy('issued'),
      }),
    ).toBe('ready');
    expect(
      applicationState({
        status: 'delivered',
        deliveryMethod: 'collection',
        certifiedCopy: copy('issued'),
      }),
    ).toBe('collected');
    expect(
      applicationState({
        status: 'delivered',
        deliveryMethod: 'dispatch',
        certifiedCopy: copy('issued'),
      }),
    ).toBe('dispatched');
  });

  it('runs the 14-day deadline only while the copy is not issued', () => {
    expect(deadlineRuns('preparing')).toBe(true);
    expect(deadlineRuns('failed')).toBe(true);
    expect(deadlineRuns('ready')).toBe(false);
    expect(deadlineRuns('collected')).toBe(false);
  });
});

describe('identityNoteOf', () => {
  it('records the document seen and the match, then the note, without numbers', () => {
    expect(identityNoteOf({ applicant: 'declarant', document: 'passport', note: '  ' })).toBe(
      'Passport seen. It matches the roster record.',
    );
    expect(
      identityNoteOf({
        applicant: 'representative',
        document: 'national-id',
        note: 'Authority letter dated 28 September.',
      }),
    ).toBe(
      "The declarant's National ID on the written authority matches the roster record. The representative's ID was checked against them. Authority letter dated 28 September.",
    );
  });
});

describe('recordFailure', () => {
  const problem = (status: number, paths: string[] = []) =>
    ({
      kind: 'problem',
      problem: {
        type: 'about:blank',
        title: 'x',
        status,
        errors: paths.map((path) => ({ path, message: 'bad' })),
      },
    }) as const;

  it('names the field the service refused', () => {
    expect(recordFailure(problem(400, ['rosterRecordId'])).field).toBe('declarant');
    expect(recordFailure(problem(400, ['version'])).field).toBe('version');
    expect(recordFailure(problem(400, ['representative.authorityUploadId'])).field).toBe(
      'authority',
    );
    expect(recordFailure(problem(400, ['representative.idUploadId'])).field).toBe('identification');
  });

  it('says which upstream is down, sends a lapsed session to sign in, and refuses the supervisor', () => {
    expect(
      recordFailure({ kind: 'unavailable', detail: null, problemType: 'workflow-unavailable' })
        .message,
    ).toBe('The copy cannot be ordered right now. Try again in a moment.');
    expect(recordFailure({ kind: 'unavailable', detail: null }).message).toBe(
      'We could not record the application. Try again.',
    );
    expect(recordFailure({ kind: 'unauthenticated' }).signIn).toBe(true);
    expect(recordFailure(problem(403)).message).toBe(
      'Only the access officer records applications.',
    );
  });
});

describe('declarationYear', () => {
  it('names the year of a biennial declaration only', () => {
    expect(declarationYear('biennial', '2026-12-31')).toBe('2026');
    expect(declarationYear('initial', '2025-09-30')).toBe('');
  });
});
