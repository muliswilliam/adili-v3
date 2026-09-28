import { describe, expect, it } from 'vitest';

import { childInclusion, deriveHeader } from '../../src/drafts/derive.js';

describe('deriveHeader (S18)', () => {
  it.each([
    [
      'a biennial after a declaration on Adili runs from its statement date',
      { type: 'biennial', statementDate: '2027-11-01' },
      { previousStatementDate: '2025-11-01' },
      { from: '2025-11-01', to: '2027-11-01', fromSource: 'declared' },
    ],
    [
      'a biennial with no record on Adili assumes two years (S1)',
      { type: 'biennial', statementDate: '2027-11-01' },
      {},
      { from: '2025-11-01', to: '2027-11-01', fromSource: 'assumed' },
    ],
    [
      'a first biennial after appointment runs from the appointment date',
      { type: 'biennial', statementDate: '2027-11-01' },
      { appointmentDate: '2026-03-10' },
      { from: '2026-03-10', to: '2027-11-01', fromSource: 'assumed' },
    ],
    [
      'an appointment before the two years does not shorten them',
      { type: 'biennial', statementDate: '2027-11-01' },
      { appointmentDate: '2019-06-01' },
      { from: '2025-11-01', to: '2027-11-01', fromSource: 'assumed' },
    ],
    [
      'a declared previous statement date wins over the appointment date',
      { type: 'biennial', statementDate: '2027-11-01' },
      { previousStatementDate: '2026-01-15', appointmentDate: '2026-03-10' },
      { from: '2026-01-15', to: '2027-11-01', fromSource: 'declared' },
    ],
    [
      'an initial covers the year ending on its statement date (S2)',
      { type: 'initial', statementDate: '2027-03-10' },
      { previousStatementDate: '2025-11-01' },
      { from: '2026-03-10', to: '2027-03-10', fromSource: 'assumed' },
    ],
    [
      'a final runs from the previous statement date to the exit (S2)',
      { type: 'final', statementDate: '2027-09-15' },
      { previousStatementDate: '2025-11-01' },
      { from: '2025-11-01', to: '2027-09-15', fromSource: 'declared' },
    ],
    [
      'a final with no record on Adili falls back like a biennial',
      { type: 'final', statementDate: '2027-09-15' },
      { appointmentDate: '2026-01-05' },
      { from: '2026-01-05', to: '2027-09-15', fromSource: 'assumed' },
    ],
    [
      'two years before a leap day is the last day of February',
      { type: 'biennial', statementDate: '2028-02-29' },
      {},
      { from: '2026-02-28', to: '2028-02-29', fromSource: 'assumed' },
    ],
  ] as const)('%s', (_name, obligation, history, incomePeriod) => {
    expect(deriveHeader(obligation, history)).toEqual({
      type: obligation.type,
      statementDate: obligation.statementDate,
      incomePeriod,
    });
  });
});

describe('childInclusion (S18)', () => {
  it.each([
    ['17 on the statement date', '2010-11-02', '2027-11-01', { included: true }],
    [
      '18 on the statement date, their birthday',
      '2009-11-01',
      '2027-11-01',
      { included: false, reason: 'over-18-at-statement-date' },
    ],
    [
      'past 18',
      '2004-06-02',
      '2027-11-01',
      { included: false, reason: 'over-18-at-statement-date' },
    ],
    ['born on the statement date', '2027-11-01', '2027-11-01', { included: true }],
    [
      'born on a leap day, the day before 1 March of their 18th year',
      '2008-02-29',
      '2026-02-28',
      { included: true },
    ],
    [
      'born on a leap day, on 1 March of their 18th year',
      '2008-02-29',
      '2026-03-01',
      { included: false, reason: 'over-18-at-statement-date' },
    ],
  ] as const)('a child %s', (_name, dateOfBirth, statementDate, inclusion) => {
    expect(childInclusion(dateOfBirth, statementDate)).toEqual(inclusion);
  });
});
