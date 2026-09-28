import { describe, expect, it } from 'vitest';

import type { DirectoryError } from '../../server/directory/client';
import {
  checkExits,
  exitDatesReducer,
  type ExitingOfficer,
  exitsFailure,
  initialExitDates,
  keepFailure,
  selectionReducer,
  todayInNairobi,
} from './exits';

const officers: ExitingOfficer[] = [
  { id: 'a', fullName: 'Achieng Otieno', personnelFileNumber: 'PSC/2019/0412' },
  { id: 'b', fullName: 'Brian Kiprono', personnelFileNumber: 'PSC/2020/0101' },
  { id: 'c', fullName: 'Chebet Wanjiru', personnelFileNumber: 'PSC/2021/0333' },
];
const TODAY = '2026-09-28';

function problem(status: number, extra: Partial<Record<string, unknown>> = {}): DirectoryError {
  return {
    kind: 'problem',
    problem: { type: 'about:blank', title: 'Problem', status, ...extra },
  };
}

describe('selectionReducer (S25)', () => {
  it('selects all on the page, keeping officers selected on earlier pages', () => {
    const selection = selectionReducer(['x'], { type: 'set', ids: new Set(['x', 'a', 'b', 'c']) });
    expect(selection).toEqual(['x', 'a', 'b', 'c']);
  });

  it('unselects the page, leaving the rest', () => {
    const selection = selectionReducer(['x', 'a', 'b'], { type: 'set', ids: new Set(['x']) });
    expect(selection).toEqual(['x']);
  });

  it('keeps the order officers were selected in', () => {
    const selection = selectionReducer(['c', 'a'], { type: 'set', ids: new Set(['a', 'b', 'c']) });
    expect(selection).toEqual(['c', 'a', 'b']);
  });

  it('returns the same selection when nothing changes', () => {
    const before = ['a', 'b'];
    expect(selectionReducer(before, { type: 'set', ids: ['b', 'a'] })).toBe(before);
    expect(selectionReducer(before, { type: 'retain', ids: ['a', 'b', 'c'] })).toBe(before);
    const empty: string[] = [];
    expect(selectionReducer(empty, { type: 'clear' })).toBe(empty);
  });

  it('clears', () => {
    expect(selectionReducer(['a', 'b'], { type: 'clear' })).toEqual([]);
  });

  it('drops officers no longer listed after a reload', () => {
    expect(selectionReducer(['a', 'b', 'c'], { type: 'retain', ids: ['c', 'a'] })).toEqual([
      'a',
      'c',
    ]);
  });
});

describe('exitDatesReducer (S25)', () => {
  it('opens with today for everyone and no overrides', () => {
    expect(initialExitDates(TODAY)).toEqual({ exitDate: TODAY, overrides: {} });
  });

  it('sets the batch date', () => {
    const dates = exitDatesReducer(initialExitDates(TODAY), {
      type: 'exit-date',
      date: '2026-09-01',
    });
    expect(dates.exitDate).toBe('2026-09-01');
  });

  it('overrides one officer, and clears the override when the date is emptied', () => {
    let dates = exitDatesReducer(initialExitDates(TODAY), {
      type: 'override',
      id: 'b',
      date: '2026-08-31',
    });
    expect(dates.overrides).toEqual({ b: '2026-08-31' });
    dates = exitDatesReducer(dates, { type: 'override', id: 'b', date: '2026-08-30' });
    expect(dates.overrides).toEqual({ b: '2026-08-30' });
    dates = exitDatesReducer(dates, { type: 'override', id: 'b', date: '' });
    expect(dates.overrides).toEqual({});
  });
});

describe('checkExits', () => {
  it('applies the batch date to everyone', () => {
    expect(checkExits(officers, { exitDate: '2026-09-15', overrides: {} }, TODAY)).toEqual({
      ok: true,
      exits: {
        exitDate: '2026-09-15',
        records: [{ recordId: 'a' }, { recordId: 'b' }, { recordId: 'c' }],
      },
    });
  });

  it('sends per-officer dates that differ from the batch date', () => {
    const check = checkExits(
      officers,
      { exitDate: '2026-09-15', overrides: { b: '2026-08-31', c: '2026-09-15' } },
      TODAY,
    );
    expect(check).toEqual({
      ok: true,
      exits: {
        exitDate: '2026-09-15',
        records: [{ recordId: 'a' }, { recordId: 'b', exitDate: '2026-08-31' }, { recordId: 'c' }],
      },
    });
  });

  it('allows no batch date when every officer has their own', () => {
    const check = checkExits(
      officers.slice(0, 2),
      { exitDate: '', overrides: { a: '2026-09-01', b: '2026-09-02' } },
      TODAY,
    );
    expect(check).toEqual({
      ok: true,
      exits: {
        records: [
          { recordId: 'a', exitDate: '2026-09-01' },
          { recordId: 'b', exitDate: '2026-09-02' },
        ],
      },
    });
  });

  it('asks for a batch date when someone has no date', () => {
    const check = checkExits(officers, { exitDate: '', overrides: { a: '2026-09-01' } }, TODAY);
    expect(check).toEqual({
      ok: false,
      errors: { exitDate: 'Enter an exit date.', overrides: {} },
    });
  });

  it('refuses dates in the future, per field', () => {
    const check = checkExits(
      officers,
      { exitDate: '2026-09-29', overrides: { b: '2026-10-02', c: '2026-09-28' } },
      TODAY,
    );
    expect(check).toEqual({
      ok: false,
      errors: {
        exitDate: 'The exit date cannot be in the future.',
        overrides: { b: 'The exit date cannot be in the future.' },
      },
    });
  });

  it('refuses dates that are not calendar dates', () => {
    const check = checkExits(officers, { exitDate: '2026-02-30', overrides: {} }, TODAY);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.errors.exitDate).toBe('Enter a date as day, month and year.');
  });
});

describe('todayInNairobi', () => {
  it('is the Kenyan calendar date, three hours ahead of UTC', () => {
    expect(todayInNairobi(new Date('2026-09-28T20:59:00Z'))).toBe('2026-09-28');
    expect(todayInNairobi(new Date('2026-09-28T21:00:00Z'))).toBe('2026-09-29');
  });
});

describe('exitsFailure', () => {
  it('signs in again when the session ended', () => {
    expect(exitsFailure(officers, { kind: 'unauthenticated' })).toEqual({ kind: 'sign-in' });
  });

  it('keeps the key after a network failure, so the retry is the same request', () => {
    expect(exitsFailure(officers, { kind: 'unavailable', detail: null })).toEqual({
      kind: 'failed',
      message: 'Exits were not recorded. Try again.',
      errors: { overrides: {} },
      newKey: false,
    });
    expect(exitsFailure(officers.slice(0, 1), { kind: 'unavailable', detail: null })).toMatchObject(
      { message: 'The exit was not recorded. Try again.' },
    );
  });

  it('reloads when officers exited or left the roster meanwhile', () => {
    for (const type of ['record-exited', 'record-not-found']) {
      expect(
        exitsFailure(officers, problem(type === 'record-exited' ? 409 : 404, { type })),
      ).toMatchObject({ kind: 'stale' });
    }
  });

  it("puts the directory's date errors on the fields they name", () => {
    const failure = exitsFailure(
      officers,
      problem(400, {
        errors: [
          { path: 'exitDate', message: 'Exit date cannot be in the future' },
          { path: 'records.2.exitDate', message: 'Exit date cannot be in the future' },
        ],
      }),
    );
    expect(failure).toEqual({
      kind: 'failed',
      message: null,
      errors: {
        exitDate: 'The exit date cannot be in the future.',
        overrides: { c: 'The exit date cannot be in the future.' },
      },
      newKey: true,
    });
  });

  it('shows the retry message for errors it cannot place', () => {
    const failure = exitsFailure(
      officers,
      problem(400, { errors: [{ path: 'records.1.recordId', message: 'Record listed twice' }] }),
    );
    expect(failure).toMatchObject({ message: 'Exits were not recorded. Try again.', newKey: true });
  });

  it('says who may confirm exits on 403', () => {
    expect(exitsFailure(officers, problem(403))).toMatchObject({
      message: 'Only the reporting officer can confirm exits.',
    });
  });
});

describe('keepFailure', () => {
  it('signs in again, explains 403, or asks to retry', () => {
    expect(keepFailure({ kind: 'unauthenticated' })).toEqual({ kind: 'sign-in' });
    expect(keepFailure(problem(403))).toEqual({
      kind: 'failed',
      message: 'Only the reporting officer can mark officers as still employed.',
    });
    expect(keepFailure({ kind: 'unavailable', detail: null })).toEqual({
      kind: 'failed',
      message: 'Nobody was marked as still employed. Try again.',
    });
  });
});
