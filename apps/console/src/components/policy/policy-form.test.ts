import { describe, expect, it } from 'vitest';

import type { DirectoryError, TenantPolicyVersion } from '../../server/directory/client';
import {
  checkStartDate,
  monthDayText,
  policyFailure,
  policyVersions,
  reminderOffsetsText,
} from './policy-form';

const problem = (status: number, extra: Record<string, unknown> = {}): DirectoryError => ({
  kind: 'problem',
  problem: { type: 'about:blank', title: 'No', status, ...extra },
});

function version(v: number, overrides: Partial<TenantPolicyVersion> = {}): TenantPolicyVersion {
  return {
    id: `0199a0b4-0000-7000-8000-00000000000${v}`,
    version: v,
    effectiveFrom: `2026-0${v}-01T06:00:00Z`,
    obligationsStartDate: '2026-08-03',
    initialDueAfterAppointmentDays: 30,
    biennial: { statementDate: '11-01', dueDate: '12-31' },
    finalDueAfterExitDays: 30,
    reminderOffsetsDays: [30, 14, 7],
    clarification: { issueWindowMonths: 6, replyWindowDays: 30 },
    formMDue: '07-31',
    createdBy: 'Amina Wanjiru',
    createdAt: `2026-0${v}-01T06:00:00Z`,
    ...overrides,
  };
}

describe('S19 policy card words', () => {
  it('lists the reminder offsets as the prototype words them', () => {
    expect(reminderOffsetsText([30, 14, 7])).toBe('30, 14 and 7 days before due');
    expect(reminderOffsetsText([14, 7])).toBe('14 and 7 days before due');
    expect(reminderOffsetsText([7])).toBe('7 days before due');
    expect(reminderOffsetsText([])).toBe('No reminders');
  });

  it('orders the offsets from the earliest reminder', () => {
    expect(reminderOffsetsText([7, 30, 14])).toBe('30, 14 and 7 days before due');
  });

  it('reads a month-day as a short date', () => {
    expect(monthDayText('11-01')).toBe('1 Nov');
    expect(monthDayText('12-31')).toBe('31 Dec');
    expect(monthDayText('nonsense')).toBe('nonsense');
  });

  it('lists versions newest first, the one in force at the top', () => {
    const history = { current: version(3), previous: [version(1), version(2)] };
    expect(policyVersions(history).map((v) => v.version)).toEqual([3, 2, 1]);
  });
});

describe('S19 change dialog checks', () => {
  it('asks for a date', () => {
    expect(checkStartDate('', '2026-08-03')).toBe('Enter a valid date.');
    expect(checkStartDate('2026-02-30', '2026-08-03')).toBe('Enter a valid date.');
    expect(checkStartDate('03/08/2026', '2026-08-03')).toBe('Enter a valid date.');
  });

  it('refuses the start date already in force', () => {
    expect(checkStartDate('2026-08-03', '2026-08-03')).toBe(
      'This is already the start date in force. Choose a different date.',
    );
  });

  it('accepts another real date, earlier or later', () => {
    expect(checkStartDate('2026-07-01', '2026-08-03')).toBeUndefined();
    expect(checkStartDate('2028-02-29', '2026-08-03')).toBeUndefined();
  });
});

describe('S19 change refused by the directory', () => {
  it('keeps the key after a network failure or 5xx so the retry replays', () => {
    expect(policyFailure({ kind: 'unavailable', detail: null })).toEqual({
      fieldError: undefined,
      unmapped: [],
      alert: 'error',
      newKey: false,
    });
  });

  it('keeps the key while the same request is still running', () => {
    expect(policyFailure(problem(409, { type: 'idempotency-key-in-use' }))).toMatchObject({
      alert: 'in-progress',
      newKey: false,
    });
  });

  it('shows a refused date on the field', () => {
    const failure = policyFailure(
      problem(400, { errors: [{ path: 'obligationsStartDate', message: 'must be a date' }] }),
    );
    expect(failure).toEqual({
      fieldError: 'Enter a valid date.',
      unmapped: [],
      alert: 'rejected',
      newKey: true,
    });
  });

  it('lists messages that name no field', () => {
    expect(policyFailure(problem(400, { detail: 'Start date unchanged' }))).toMatchObject({
      unmapped: ['Start date unchanged'],
      alert: 'rejected',
    });
    expect(
      policyFailure(problem(400, { errors: [{ path: 'reason', message: 'is required' }] })),
    ).toMatchObject({ unmapped: ['reason: is required'] });
  });

  it.each([
    [403, 'forbidden'],
    [404, 'not-found'],
    [409, 'changed'],
    [422, 'changed'],
    [418, 'error'],
  ] as const)('reads %i as %s', (status, alert) => {
    expect(policyFailure(problem(status))).toMatchObject({ alert, newKey: true });
  });
});
