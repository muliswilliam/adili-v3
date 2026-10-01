import { describe, expect, it } from 'vitest';

import { amendRefusal, isLate, submitRefusal } from '../../src/declaration/window.js';

const BIENNIAL = { statementDate: '2027-11-01', dueDate: '2027-12-31' };

describe('submitRefusal', () => {
  it.each([
    ['draft', 'due', '2027-11-01', null],
    ['draft', 'overdue', '2028-01-15', null],
    // The date decides, not a status its workflow has not moved on yet.
    ['draft', 'upcoming', '2027-11-01', null],
    ['draft', 'upcoming', '2027-10-31', 'before-statement-date'],
    ['draft', 'due', '2027-10-31', 'before-statement-date'],
    ['draft', 'cancelled', '2027-11-15', 'obligation-cancelled'],
    ['draft', 'filed', '2027-11-15', 'not-a-draft'],
    ['submitted', 'filed', '2027-11-15', 'not-a-draft'],
    ['discarded', 'due', '2027-11-15', 'not-a-draft'],
    ['amending', 'filed', '2027-12-31', null],
    ['amending', 'filed', '2028-01-01', 'amendment-window-closed'],
  ] as const)('%s declaration, %s obligation, on %s: %s', (status, obligation, today, refusal) => {
    expect(submitRefusal(status, { ...BIENNIAL, status: obligation }, today)).toBe(refusal);
  });
});

describe('amendRefusal', () => {
  it.each([
    ['submitted', 'filed', '2027-11-15', null],
    // Open on the due date itself (Africa/Nairobi), closed the day after.
    ['submitted', 'filed', '2027-12-31', null],
    ['submitted', 'filed', '2028-01-01', 'amendment-window-closed'],
    ['submitted', 'cancelled', '2027-11-15', 'obligation-cancelled'],
    ['draft', 'due', '2027-11-15', 'not-submitted'],
    ['amending', 'filed', '2027-11-15', 'not-submitted'],
    ['discarded', 'due', '2027-11-15', 'not-submitted'],
  ] as const)('%s declaration, %s obligation, on %s: %s', (status, obligation, today, refusal) => {
    expect(amendRefusal(status, { ...BIENNIAL, status: obligation }, today)).toBe(refusal);
  });
});

describe('isLate', () => {
  it('is late only after the due date', () => {
    expect(isLate('2027-12-31', '2027-12-31')).toBe(false);
    expect(isLate('2027-12-31', '2028-01-01')).toBe(true);
  });
});
