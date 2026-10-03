import { validateFormM } from '@adili/forms';
import { describe, expect, it } from 'vitest';

import {
  type AccessRequestFactRow,
  type ActionFactRow,
  aggregateFacts,
  assemble,
  type AssembleInput,
  NO_MANUAL_ENTRIES,
  type ObligationFactRow,
} from '../../src/compliance-reports/form-m.js';
import {
  dueDateOf,
  financialYearAt,
  financialYearOf,
  previewFromOf,
} from '../../src/financial-year.js';

const id = (n: number) => `0199b000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const fact = (n: number, overrides: Partial<ObligationFactRow> = {}): ObligationFactRow => ({
  obligationId: id(n),
  type: 'initial',
  statementDate: '2027-09-01',
  status: 'due',
  filedAt: null,
  late: null,
  ...overrides,
});

describe('financial years', () => {
  it('runs from 1 July to 30 June, keyed by the start year, in Nairobi time', () => {
    expect(financialYearOf('2027-06-30')).toBe(2026);
    expect(financialYearOf('2027-07-01')).toBe(2027);
    expect(financialYearAt(new Date('2027-06-30T20:59:59.000Z'))).toBe(2026);
    expect(financialYearAt(new Date('2027-06-30T21:00:00.000Z'))).toBe(2027);
    expect(dueDateOf(2027)).toBe('2028-07-31');
    expect(previewFromOf(2027)).toBe('2028-04-01');
  });
});

describe('aggregateFacts', () => {
  it('counts declared as filed on time, lists everyone else, and leaves cancelled obligations out', () => {
    const aggregate = aggregateFacts(
      [
        fact(1, { status: 'filed', filedAt: new Date('2027-09-10'), late: false }),
        fact(2, { status: 'filed', filedAt: new Date('2027-11-10'), late: true }),
        fact(3, { status: 'overdue' }),
        fact(4, { status: 'cancelled' }),
        fact(5, { type: 'final', statementDate: '2028-01-01', status: 'filed', late: null }),
        fact(6, { type: null }),
      ],
      [],
      [],
    );

    expect(aggregate.counts.initial).toEqual({ expected: 3, declared: 1, notDeclared: 2 });
    expect(aggregate.nonFilers.initial).toEqual([id(2), id(3)]);
    expect(aggregate.counts.final).toEqual({ expected: 1, declared: 1, notDeclared: 0 });
  });

  it('S4: a year with no biennial obligation has no cycle in the period', () => {
    expect(aggregateFacts([fact(1)], [], []).counts.biennial).toEqual({
      expected: 0,
      declared: 0,
      notDeclared: 0,
      noCycleInPeriod: true,
    });
    expect(
      aggregateFacts([fact(1, { type: 'biennial' })], [], []).counts.biennial.noCycleInPeriod,
    ).toBe(false);
  });

  it('orders clarifications by the time they were issued', () => {
    const aggregate = aggregateFacts(
      [],
      [
        { clarificationId: id(2), issuedAt: new Date('2027-12-02') },
        { clarificationId: id(1), issuedAt: new Date('2027-12-01') },
      ],
      [],
    );

    expect(aggregate.clarificationIds).toEqual([id(1), id(2)]);
    expect(aggregate.counts.clarifications).toBe(2);
  });
});

describe('aggregateFacts: section 5, access to information (Form K requests)', () => {
  const request = (
    n: number,
    overrides: Partial<AccessRequestFactRow> = {},
  ): AccessRequestFactRow => ({
    requestId: id(n),
    outcome: null,
    grounds: [],
    withdrawn: false,
    ...overrides,
  });
  const section5 = (requests: AccessRequestFactRow[]) => {
    const aggregate = aggregateFacts([], [], requests);
    return { ...aggregate.counts.accessRequests, declineReasons: aggregate.declineReasons };
  };

  it('counts every request received in the year, still open ones included', () => {
    expect(section5([request(1), request(2)])).toEqual({
      received: 2,
      granted: 0,
      declined: 0,
      declineReasons: [],
    });
  });

  it('counts full and partial grants as granted; a partial grant cites its grounds as reasons', () => {
    expect(
      section5([
        request(1, { outcome: 'grant' }),
        request(2, { outcome: 'partial-grant', grounds: ['prejudice-proceeding'] }),
      ]),
    ).toEqual({
      received: 2,
      granted: 2,
      declined: 0,
      declineReasons: [{ reason: 'prejudice-proceeding', count: 1 }],
    });
  });

  it('counts a denial citing several grounds once as declined and once under each ground', () => {
    expect(
      section5([
        request(1, { outcome: 'deny', grounds: ['not-objectives', 'public-interest'] }),
        request(2, { outcome: 'deny', grounds: ['public-interest'] }),
      ]),
    ).toEqual({
      received: 2,
      granted: 0,
      declined: 2,
      // In Regulation 24 order, reasons with no request left out.
      declineReasons: [
        { reason: 'public-interest', count: 2 },
        { reason: 'not-objectives', count: 1 },
      ],
    });
  });

  it('counts a request closed because the officer cannot be identified as declined for reason other', () => {
    expect(section5([request(1, { outcome: 'cannot-identify' })])).toEqual({
      received: 1,
      granted: 0,
      declined: 1,
      declineReasons: [{ reason: 'other', count: 1 }],
    });
  });

  it('counts a withdrawn request as received only', () => {
    expect(section5([request(1, { withdrawn: true })])).toEqual({
      received: 1,
      granted: 0,
      declined: 0,
      declineReasons: [],
    });
  });
});

describe('assemble', () => {
  const ISSUED = new Date('2027-10-06T09:05:00.000Z');
  const input = (
    actions: ActionFactRow[],
    obligation = fact(1, { status: 'overdue' }),
  ): AssembleInput => {
    const aggregate = aggregateFacts([obligation], [], []);
    return {
      fy: 2027,
      commission: { name: 'Public Service Commission', issuerCode: 'PSC' },
      aggregate,
      obligations: new Map([[obligation.obligationId, obligation]]),
      actions,
      officers: [],
      clarificationStatuses: new Map(),
      clarifications: [],
      remarks: new Map(),
      manual: {
        ...NO_MANUAL_ENTRIES,
        emailAddress: 'info@publicservice.go.ke',
      },
      compiledAt: new Date('2028-07-01T06:00:00.000Z'),
    };
  };
  const rowOf = (actions: ActionFactRow[], obligation?: ObligationFactRow) =>
    assemble(input(actions, obligation)).partII.initial.nonFilers[0];

  it('takes the furthest step issued to the officer; steps never issued are no action', () => {
    expect(
      rowOf([
        { subjectId: id(1), step: 'notice-to-comply', status: 'responded', issuedAt: ISSUED },
        { subjectId: id(1), step: 'warning', status: 'issued', issuedAt: ISSUED },
        { subjectId: id(1), step: 'salary-stoppage', status: 'proposed', issuedAt: null },
        { subjectId: id(2), step: 'disciplinary-referral', status: 'issued', issuedAt: ISSUED },
      ]),
    ).toMatchObject({ actionTaken: 'warning', complied: 'pending', remarks: 'Warning issued' });
    expect(
      rowOf([
        { subjectId: id(1), step: 'notice-to-comply', status: 'approved', issuedAt: null },
        { subjectId: id(1), step: 'warning', status: 'declined', issuedAt: null },
        { subjectId: id(1), step: 'salary-stoppage', status: 'cancelled', issuedAt: null },
      ]),
    ).toMatchObject({ actionTaken: 'none', complied: 'no' });
  });

  it('counts a step complied when its ladder closed only if it had been issued (spec 08 closes approved steps too)', () => {
    expect(
      rowOf([
        { subjectId: id(1), step: 'notice-to-comply', status: 'complied', issuedAt: ISSUED },
        { subjectId: id(1), step: 'warning', status: 'complied', issuedAt: null },
      ]),
    ).toMatchObject({ actionTaken: 'notice-to-comply' });
  });

  it('marks a late filer complied, with or without an action', () => {
    const late = fact(1, { status: 'filed', filedAt: new Date('2027-12-01'), late: true });

    expect(rowOf([], late)).toMatchObject({ actionTaken: 'none', complied: 'yes' });
    expect(
      rowOf(
        [{ subjectId: id(1), step: 'salary-stoppage', status: 'complied', issuedAt: ISSUED }],
        late,
      ),
    ).toMatchObject({ actionTaken: 'salary-stoppage', complied: 'yes', remarks: 'Salary stopped' });
  });

  it('keeps a row whose officer declarations no longer knows, dated by its statement date', () => {
    expect(rowOf([])).toEqual({
      name: '',
      designation: '',
      identifier: '',
      date: '2027-09-01',
      actionTaken: 'none',
      complied: 'no',
      remarks: 'No administrative action taken',
      obligationId: id(1),
    });
  });

  it('produces a document valid against form-m.v1 once Part I has its email', () => {
    const document = assemble(input([]));

    expect(validateFormM(document)).toEqual({ ok: true, value: document });
  });
});
