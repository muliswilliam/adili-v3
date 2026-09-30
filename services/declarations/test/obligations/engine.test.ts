import { describe, expect, it } from 'vitest';

import type { CivilDate } from '../../src/obligations/dates.js';
import {
  type CycleCalendar,
  cycleOpeningDate,
  type DesiredObligation,
  type ExistingObligation,
  type ObligationPolicy,
  openedCycles,
  planObligations,
  type RosterSnapshot,
} from '../../src/obligations/engine.js';

/** The platform default policy (spec 01) with a 2027-01-01 obligations-start date. */
const policy: ObligationPolicy = {
  version: 1,
  obligationsStartDate: '2027-01-01',
  initialDueAfterAppointmentDays: 30,
  biennial: { statementDate: '11-01', dueDate: '12-31' },
  finalDueAfterExitDays: 30,
  reminderOffsetsDays: [30, 14, 7],
};

/** The seeded calendar (migration 0002): cycles every two years from 2027, each opening 120 days ahead. */
const calendar: CycleCalendar = [
  { cycleYear: 2027, openingLeadDays: 120 },
  { cycleYear: 2029, openingLeadDays: 120 },
  { cycleYear: 2031, openingLeadDays: 120 },
];

function record(overrides: Partial<RosterSnapshot> = {}): RosterSnapshot {
  return {
    rosterRecordId: 'rec-1',
    appointmentDate: '2020-01-15',
    exitDate: null,
    personId: null,
    ofr: null,
    ...overrides,
  };
}

function plan(input: {
  record: RosterSnapshot;
  today: CivilDate;
  existing?: ExistingObligation[];
  policy?: ObligationPolicy;
}) {
  return planObligations({
    record: input.record,
    policy: input.policy ?? policy,
    calendar,
    today: input.today,
    existing: input.existing ?? [],
  });
}

/** The obligations a plan creates (plain creates and the new side of supersedes). */
function created(result: ReturnType<typeof plan>): DesiredObligation[] {
  return result.operations.flatMap((op) =>
    op.kind === 'create' || op.kind === 'supersede' ? [op.obligation] : [],
  );
}

function summary(obligations: DesiredObligation[]) {
  return obligations.map((o) => ({
    cycleKey: o.cycleKey,
    statementDate: o.statementDate,
    dueDate: o.dueDate,
    status: o.status,
  }));
}

function existing(
  id: string,
  obligation: Pick<ExistingObligation, 'type' | 'cycleKey' | 'status'> &
    Partial<ExistingObligation>,
): ExistingObligation {
  return { id, personId: null, ...obligation };
}

describe('cycle calendar', () => {
  it('seeds 2027, 2029 and 2031, each opening 120 days before its statement date', () => {
    expect(calendar.map((c) => c.cycleYear)).toEqual([2027, 2029, 2031]);
    expect(cycleOpeningDate({ cycleYear: 2027, openingLeadDays: 120 }, policy)).toBe('2027-07-04');
    expect(cycleOpeningDate({ cycleYear: 2029, openingLeadDays: 120 }, policy)).toBe('2029-07-04');
  });

  it('opens a cycle on its opening date, not before', () => {
    expect(openedCycles(calendar, policy, '2027-07-03')).toEqual([]);
    expect(openedCycles(calendar, policy, '2027-07-04')).toEqual([2027]);
    expect(openedCycles(calendar, policy, '2029-07-04')).toEqual([2027, 2029]);
  });
});

describe('S1 appointment on or after the obligations-start date', () => {
  it('creates an initial with statement = appointment and due 30 days later, due inside the window', () => {
    const result = plan({ record: record({ appointmentDate: '2027-03-10' }), today: '2027-03-15' });

    expect(summary(created(result))).toEqual([
      {
        cycleKey: 'initial:2027-03-10',
        statementDate: '2027-03-10',
        dueDate: '2027-04-09',
        status: 'due',
      },
    ]);
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]).toMatchObject({ kind: 'create' });
  });

  it('records the policy version, the person and the reminders to schedule', () => {
    const [initial] = created(
      plan({
        record: record({ appointmentDate: '2027-03-10', personId: 'p-1', ofr: 'OFR-1' }),
        today: '2027-03-15',
      }),
    );

    expect(initial).toMatchObject({
      type: 'initial',
      policyVersion: 1,
      personId: 'p-1',
      ofr: 'OFR-1',
      skippedReminders: [{ offsetDays: 30, date: '2027-03-10' }],
      reminders: [
        { offsetDays: 14, date: '2027-03-26' },
        { offsetDays: 7, date: '2027-04-02' },
      ],
    });
  });

  it('is due on the appointment day itself and on the due date, never upcoming', () => {
    const onDay = created(
      plan({ record: record({ appointmentDate: '2027-03-10' }), today: '2027-03-10' }),
    );
    expect(onDay[0]).toMatchObject({ status: 'due' });
    // The 30-day reminder falls on the appointment day: still ahead, not skipped.
    expect(onDay[0]?.skippedReminders).toEqual([]);

    const onDue = created(
      plan({ record: record({ appointmentDate: '2027-03-10' }), today: '2027-04-09' }),
    );
    expect(onDue[0]).toMatchObject({ status: 'due' });

    const future = created(
      plan({ record: record({ appointmentDate: '2027-03-20' }), today: '2027-03-15' }),
    );
    expect(future[0]).toMatchObject({ status: 'due' });
  });

  it('creates an initial for an appointment exactly on the start date', () => {
    const result = plan({ record: record({ appointmentDate: '2027-01-01' }), today: '2027-01-05' });
    expect(created(result).map((o) => o.cycleKey)).toEqual(['initial:2027-01-01']);
  });

  it('adds the biennial once its cycle has opened', () => {
    const result = plan({ record: record({ appointmentDate: '2027-03-10' }), today: '2027-07-04' });
    expect(summary(created(result))).toEqual([
      {
        cycleKey: 'initial:2027-03-10',
        statementDate: '2027-03-10',
        dueDate: '2027-04-09',
        status: 'overdue',
      },
      {
        cycleKey: 'biennial:2027',
        statementDate: '2027-11-01',
        dueDate: '2027-12-31',
        status: 'upcoming',
      },
    ]);
  });
});

describe('S2 appointment before the obligations-start date', () => {
  it('creates no initial, and the 2027 biennial upcoming', () => {
    const result = plan({ record: record({ appointmentDate: '2026-06-01' }), today: '2027-07-10' });

    expect(summary(created(result))).toEqual([
      {
        cycleKey: 'biennial:2027',
        statementDate: '2027-11-01',
        dueDate: '2027-12-31',
        status: 'upcoming',
      },
    ]);
    expect(created(result)[0]).toMatchObject({
      type: 'biennial',
      skippedReminders: [],
      reminders: [
        { offsetDays: 30, date: '2027-12-01' },
        { offsetDays: 14, date: '2027-12-17' },
        { offsetDays: 7, date: '2027-12-24' },
      ],
    });
  });

  it('creates nothing before the 2027 cycle opens', () => {
    const result = plan({ record: record({ appointmentDate: '2026-06-01' }), today: '2027-03-01' });
    expect(result.obligations).toEqual([]);
    expect(result.operations).toEqual([]);
  });

  it('treats a record without an appointment date as long-serving', () => {
    const result = plan({ record: record({ appointmentDate: null }), today: '2027-08-01' });
    expect(created(result).map((o) => o.cycleKey)).toEqual(['biennial:2027']);
  });

  it('skips biennial cycles whose statement date is before the start date', () => {
    const lateJoiner = { ...policy, obligationsStartDate: '2028-03-01' };
    const result = plan({
      record: record({ appointmentDate: '2020-01-15' }),
      today: '2029-08-01',
      policy: lateJoiner,
    });
    expect(created(result).map((o) => o.cycleKey)).toEqual(['biennial:2029']);
  });
});

describe('S3 late import past the due date', () => {
  it('creates the initial overdue with every past reminder reported skipped', () => {
    const result = plan({ record: record({ appointmentDate: '2027-03-10' }), today: '2027-06-01' });

    const [initial] = created(result);
    expect(initial).toMatchObject({
      cycleKey: 'initial:2027-03-10',
      dueDate: '2027-04-09',
      status: 'overdue',
      reminders: [],
      skippedReminders: [
        { offsetDays: 30, date: '2027-03-10' },
        { offsetDays: 14, date: '2027-03-26' },
        { offsetDays: 7, date: '2027-04-02' },
      ],
    });
  });

  it('is overdue the day after the due date', () => {
    const [initial] = created(
      plan({ record: record({ appointmentDate: '2027-03-10' }), today: '2027-04-10' }),
    );
    expect(initial).toMatchObject({ status: 'overdue' });
  });

  it('creates a missed biennial overdue when the record arrives after its cycle', () => {
    const result = plan({ record: record(), today: '2028-02-01' });
    expect(summary(created(result))).toEqual([
      {
        cycleKey: 'biennial:2027',
        statementDate: '2027-11-01',
        dueDate: '2027-12-31',
        status: 'overdue',
      },
    ]);
    expect(created(result)[0]?.skippedReminders).toHaveLength(3);
  });
});

describe('S4 exit and the biennial', () => {
  it('exit before the 2027 statement date cancels the biennial and creates the final', () => {
    const result = plan({
      record: record({ exitDate: '2027-09-15' }),
      today: '2027-09-20',
      existing: [
        existing('b-2027', { type: 'biennial', cycleKey: 'biennial:2027', status: 'upcoming' }),
      ],
    });

    expect(result.operations).toEqual([
      { kind: 'cancel', obligationId: 'b-2027', reason: 'exited-before-statement-date' },
      expect.objectContaining({ kind: 'create' }),
    ]);
    expect(summary(created(result))).toEqual([
      {
        cycleKey: 'final:2027-09-15',
        statementDate: '2027-09-15',
        dueDate: '2027-10-15',
        status: 'due',
      },
    ]);
    expect(summary(result.obligations)).toEqual(summary(created(result)));
  });

  it('exit after the 2027 statement date keeps the biennial and creates the final', () => {
    const result = plan({
      record: record({ exitDate: '2027-11-20' }),
      today: '2027-11-22',
      existing: [
        existing('b-2027', { type: 'biennial', cycleKey: 'biennial:2027', status: 'due' }),
      ],
    });

    expect(result.operations).toEqual([expect.objectContaining({ kind: 'create' })]);
    expect(summary(created(result))).toEqual([
      {
        cycleKey: 'final:2027-11-20',
        statementDate: '2027-11-20',
        dueDate: '2027-12-20',
        status: 'due',
      },
    ]);
    expect(result.obligations.map((o) => o.cycleKey)).toEqual([
      'biennial:2027',
      'final:2027-11-20',
    ]);
  });

  it('an exit on the statement date cancels the biennial: only the final is owed', () => {
    const result = plan({
      record: record({ exitDate: '2027-11-01' }),
      today: '2027-11-03',
      existing: [
        existing('b-2027', { type: 'biennial', cycleKey: 'biennial:2027', status: 'due' }),
      ],
    });

    expect(result.operations).toEqual([
      { kind: 'cancel', obligationId: 'b-2027', reason: 'exited-before-statement-date' },
      expect.objectContaining({ kind: 'create' }),
    ]);
    expect(result.obligations.map((o) => o.cycleKey)).toEqual(['final:2027-11-01']);
  });

  it('an exit on the statement date creates no biennial for a record ingested later', () => {
    const result = plan({ record: record({ exitDate: '2027-11-01' }), today: '2027-11-03' });

    expect(result.obligations.map((o) => o.cycleKey)).toEqual(['final:2027-11-01']);
  });

  it('a late-confirmed exit cancels a biennial that has already become due', () => {
    const result = plan({
      record: record({ exitDate: '2027-10-20' }),
      today: '2027-11-05',
      existing: [
        existing('b-2027', { type: 'biennial', cycleKey: 'biennial:2027', status: 'due' }),
      ],
    });
    expect(result.operations[0]).toEqual({
      kind: 'cancel',
      obligationId: 'b-2027',
      reason: 'exited-before-statement-date',
    });
  });

  it('an exited record gets no biennial for cycles after its exit', () => {
    const result = plan({ record: record({ exitDate: '2027-09-15' }), today: '2027-09-20' });
    expect(created(result).map((o) => o.cycleKey)).toEqual(['final:2027-09-15']);
  });

  it('an exit before the obligations-start date creates no final', () => {
    const result = plan({ record: record({ exitDate: '2026-12-15' }), today: '2027-01-10' });
    expect(result.operations).toEqual([]);
  });
});

describe('S5 exit reversal', () => {
  it('cancels the final and recreates the biennial it displaced', () => {
    const result = plan({
      record: record({ exitDate: null }),
      today: '2027-10-01',
      existing: [
        existing('b-2027', { type: 'biennial', cycleKey: 'biennial:2027', status: 'cancelled' }),
        existing('f-1', { type: 'final', cycleKey: 'final:2027-09-15', status: 'due' }),
      ],
    });

    expect(result.operations).toEqual([
      { kind: 'cancel', obligationId: 'f-1', reason: 'exit-reversed' },
      expect.objectContaining({ kind: 'create' }),
    ]);
    expect(summary(created(result))).toEqual([
      {
        cycleKey: 'biennial:2027',
        statementDate: '2027-11-01',
        dueDate: '2027-12-31',
        status: 'upcoming',
      },
    ]);
  });

  it('cancels an overdue final too', () => {
    const result = plan({
      record: record({ exitDate: null }),
      today: '2027-06-01',
      existing: [
        existing('f-1', { type: 'final', cycleKey: 'final:2027-02-09', status: 'overdue' }),
      ],
    });
    expect(result.operations).toEqual([
      { kind: 'cancel', obligationId: 'f-1', reason: 'exit-reversed' },
    ]);
  });
});

describe('S6 appointment date correction', () => {
  it('supersedes the initial with one on the corrected dates', () => {
    const result = plan({
      record: record({ appointmentDate: '2027-03-20' }),
      today: '2027-03-25',
      existing: [
        existing('i-1', { type: 'initial', cycleKey: 'initial:2027-03-10', status: 'due' }),
      ],
    });

    expect(result.operations).toEqual([
      expect.objectContaining({ kind: 'supersede', obligationId: 'i-1' }),
    ]);
    expect(summary(created(result))).toEqual([
      {
        cycleKey: 'initial:2027-03-20',
        statementDate: '2027-03-20',
        dueDate: '2027-04-19',
        status: 'due',
      },
    ]);
  });

  it('leaves a filed initial alone and creates no replacement', () => {
    const result = plan({
      record: record({ appointmentDate: '2027-03-20', personId: 'p-1', ofr: 'OFR-1' }),
      today: '2027-04-01',
      existing: [
        existing('i-1', { type: 'initial', cycleKey: 'initial:2027-03-10', status: 'filed' }),
      ],
    });
    expect(result.operations).toEqual([]);
  });

  it('leaves a filed final alone when the exit is reversed', () => {
    const result = plan({
      record: record({ exitDate: null }),
      today: '2027-10-01',
      existing: [
        existing('b-2027', { type: 'biennial', cycleKey: 'biennial:2027', status: 'cancelled' }),
        existing('f-1', { type: 'final', cycleKey: 'final:2027-09-15', status: 'filed' }),
      ],
    });
    expect(result.operations.map((op) => op.kind)).toEqual(['create']);
    expect(created(result)[0]).toMatchObject({ cycleKey: 'biennial:2027' });
  });

  it('supersedes the final when the exit date is corrected', () => {
    const result = plan({
      record: record({ exitDate: '2027-09-20' }),
      today: '2027-09-25',
      existing: [existing('f-1', { type: 'final', cycleKey: 'final:2027-09-15', status: 'due' })],
    });
    expect(result.operations).toEqual([
      expect.objectContaining({ kind: 'supersede', obligationId: 'f-1' }),
    ]);
    expect(created(result)[0]).toMatchObject({
      cycleKey: 'final:2027-09-20',
      dueDate: '2027-10-20',
    });
  });

  it('cancels the initial as superseded when the corrected date falls before the start date', () => {
    const result = plan({
      record: record({ appointmentDate: '2026-12-20' }),
      today: '2027-01-10',
      existing: [
        existing('i-1', { type: 'initial', cycleKey: 'initial:2027-01-05', status: 'due' }),
      ],
    });
    expect(result.operations).toEqual([
      { kind: 'cancel', obligationId: 'i-1', reason: 'superseded' },
    ]);
  });

  it('cancels a biennial as superseded when the appointment moves after its statement date', () => {
    const result = plan({
      record: record({ appointmentDate: '2027-11-10' }),
      today: '2027-11-12',
      existing: [
        existing('b-2027', { type: 'biennial', cycleKey: 'biennial:2027', status: 'due' }),
      ],
    });
    expect(result.operations).toEqual([
      { kind: 'cancel', obligationId: 'b-2027', reason: 'superseded' },
      expect.objectContaining({ kind: 'create' }),
    ]);
    expect(created(result).map((o) => o.cycleKey)).toEqual(['initial:2027-11-10']);
  });

  it('never cancels a filed biennial, even after a retroactive exit', () => {
    const result = plan({
      record: record({ exitDate: '2027-10-20' }),
      today: '2028-01-10',
      existing: [
        existing('b-2027', { type: 'biennial', cycleKey: 'biennial:2027', status: 'filed' }),
      ],
    });
    expect(result.operations.map((op) => op.kind)).toEqual(['create']);
    expect(created(result)[0]).toMatchObject({ cycleKey: 'final:2027-10-20' });
  });
});

describe('reconciliation is idempotent and keeps what exists', () => {
  it('plans nothing when every desired obligation already exists', () => {
    const result = plan({
      record: record({ appointmentDate: '2027-03-10' }),
      today: '2027-08-01',
      existing: [
        existing('i-1', { type: 'initial', cycleKey: 'initial:2027-03-10', status: 'overdue' }),
        existing('b-2027', { type: 'biennial', cycleKey: 'biennial:2027', status: 'upcoming' }),
      ],
    });
    expect(result.operations).toEqual([]);
    expect(result.obligations.map((o) => o.cycleKey)).toEqual([
      'initial:2027-03-10',
      'biennial:2027',
    ]);
  });
});

describe('story 22: a later policy version moves the obligations-start date', () => {
  const later = (obligationsStartDate: CivilDate) => ({
    ...policy,
    version: 2,
    obligationsStartDate,
  });

  it('cancels an open initial whose statement date is now before the start date', () => {
    const result = plan({
      record: record({ appointmentDate: '2027-03-10' }),
      today: '2027-05-20',
      policy: later('2027-06-01'),
      existing: [
        existing('i-1', { type: 'initial', cycleKey: 'initial:2027-03-10', status: 'overdue' }),
      ],
    });
    expect(result.operations).toEqual([
      { kind: 'cancel', obligationId: 'i-1', reason: 'before-obligations-start-date' },
    ]);
  });

  it('cancels an open biennial before it too, and keeps what is on or after it', () => {
    const result = plan({
      record: record({ appointmentDate: '2020-01-15', exitDate: '2030-01-10' }),
      today: '2030-01-20',
      policy: later('2029-11-01'),
      existing: [
        existing('b-2027', { type: 'biennial', cycleKey: 'biennial:2027', status: 'overdue' }),
        existing('b-2029', { type: 'biennial', cycleKey: 'biennial:2029', status: 'overdue' }),
        existing('f-1', { type: 'final', cycleKey: 'final:2030-01-10', status: 'due' }),
      ],
    });
    expect(result.operations).toEqual([
      { kind: 'cancel', obligationId: 'b-2027', reason: 'before-obligations-start-date' },
    ]);
  });

  it('keeps a filed obligation before the new start date', () => {
    const result = plan({
      record: record({ appointmentDate: '2027-03-10' }),
      today: '2027-05-20',
      policy: later('2027-06-01'),
      existing: [
        existing('i-1', { type: 'initial', cycleKey: 'initial:2027-03-10', status: 'filed' }),
      ],
    });
    expect(result.operations).toEqual([]);
    expect(result.obligations.map((o) => o.cycleKey)).toEqual(['initial:2027-03-10']);
  });

  it('creates the initial an earlier start date now reaches', () => {
    const result = plan({
      record: record({ appointmentDate: '2026-10-01' }),
      today: '2027-05-20',
      policy: later('2026-01-01'),
    });
    expect(summary(created(result))).toEqual([
      {
        cycleKey: 'initial:2026-10-01',
        statementDate: '2026-10-01',
        dueDate: '2026-10-31',
        status: 'overdue',
      },
    ]);
  });
});

describe('person link', () => {
  it('links the onboarded person to every open obligation that lacks them', () => {
    const result = plan({
      record: record({ appointmentDate: '2027-03-10', personId: 'p-1', ofr: 'OFR-1' }),
      today: '2027-08-01',
      existing: [
        existing('i-1', { type: 'initial', cycleKey: 'initial:2027-03-10', status: 'overdue' }),
        existing('b-2027', { type: 'biennial', cycleKey: 'biennial:2027', status: 'upcoming' }),
      ],
    });
    expect(result.operations).toEqual([
      { kind: 'link-person', obligationIds: ['i-1', 'b-2027'], personId: 'p-1', ofr: 'OFR-1' },
    ]);
  });

  it('leaves obligations already linked, filed or cancelled alone', () => {
    const result = plan({
      record: record({ appointmentDate: '2027-03-10', personId: 'p-1', ofr: 'OFR-1' }),
      today: '2027-08-01',
      existing: [
        existing('i-1', { type: 'initial', cycleKey: 'initial:2027-03-10', status: 'filed' }),
        existing('b-2027', {
          type: 'biennial',
          cycleKey: 'biennial:2027',
          status: 'upcoming',
          personId: 'p-1',
        }),
        existing('f-old', { type: 'final', cycleKey: 'final:2027-05-01', status: 'cancelled' }),
      ],
    });
    expect(result.operations).toEqual([]);
  });

  it('links nothing before onboarding', () => {
    const result = plan({
      record: record({ appointmentDate: '2027-03-10' }),
      today: '2027-03-20',
      existing: [
        existing('i-1', { type: 'initial', cycleKey: 'initial:2027-03-10', status: 'due' }),
      ],
    });
    expect(result.operations).toEqual([]);
  });
});

describe('two cycles', () => {
  it('materialises 2027 and 2029 once both have opened; 2031 waits', () => {
    const result = plan({ record: record(), today: '2029-07-04' });
    expect(summary(created(result))).toEqual([
      {
        cycleKey: 'biennial:2027',
        statementDate: '2027-11-01',
        dueDate: '2027-12-31',
        status: 'overdue',
      },
      {
        cycleKey: 'biennial:2029',
        statementDate: '2029-11-01',
        dueDate: '2029-12-31',
        status: 'upcoming',
      },
    ]);
  });

  it('an appointment between cycles owes only the cycles after it', () => {
    const result = plan({ record: record({ appointmentDate: '2028-05-02' }), today: '2029-08-01' });
    expect(created(result).map((o) => o.cycleKey)).toEqual(['initial:2028-05-02', 'biennial:2029']);
  });
});

describe('month-end, leap-day and year-boundary dates', () => {
  it.each([
    // [appointment, today, due, status]
    ['2027-01-31', '2027-02-15', '2027-03-02', 'due'],
    ['2028-01-30', '2028-02-29', '2028-02-29', 'due'],
    ['2028-02-29', '2028-03-01', '2028-03-30', 'due'],
    ['2027-12-15', '2028-01-14', '2028-01-14', 'due'],
    ['2027-12-15', '2028-01-15', '2028-01-14', 'overdue'],
  ])('appointment %s seen on %s is due %s (%s)', (appointmentDate, today, dueDate, status) => {
    const initial = created(plan({ record: record({ appointmentDate }), today })).find(
      (o) => o.type === 'initial',
    );
    expect(initial).toMatchObject({ dueDate, status });
  });

  it('an appointment on the statement date owes both the initial and the biennial', () => {
    const result = plan({ record: record({ appointmentDate: '2027-11-01' }), today: '2027-11-01' });
    expect(summary(created(result))).toEqual([
      {
        cycleKey: 'initial:2027-11-01',
        statementDate: '2027-11-01',
        dueDate: '2027-12-01',
        status: 'due',
      },
      {
        cycleKey: 'biennial:2027',
        statementDate: '2027-11-01',
        dueDate: '2027-12-31',
        status: 'due',
      },
    ]);
  });

  it('a final for an exit on 31 December is due across the year boundary', () => {
    const result = plan({ record: record({ exitDate: '2027-12-31' }), today: '2028-01-02' });
    expect(created(result).find((o) => o.type === 'final')).toMatchObject({
      cycleKey: 'final:2027-12-31',
      dueDate: '2028-01-30',
      status: 'due',
    });
  });
});

describe('2027 triple peak', () => {
  it('resignation to run for office by 9 February: final only', () => {
    const result = plan({ record: record({ exitDate: '2027-02-09' }), today: '2027-02-12' });
    expect(summary(result.obligations)).toEqual([
      {
        cycleKey: 'final:2027-02-09',
        statementDate: '2027-02-09',
        dueDate: '2027-03-11',
        status: 'due',
      },
    ]);
  });

  it('outgoing officer at the 10 August election: final, and no 2027 biennial', () => {
    const result = plan({
      record: record({ exitDate: '2027-08-10' }),
      today: '2027-08-20',
      existing: [
        existing('b-2027', { type: 'biennial', cycleKey: 'biennial:2027', status: 'upcoming' }),
      ],
    });
    expect(result.operations[0]).toEqual({
      kind: 'cancel',
      obligationId: 'b-2027',
      reason: 'exited-before-statement-date',
    });
    expect(summary(result.obligations)).toEqual([
      {
        cycleKey: 'final:2027-08-10',
        statementDate: '2027-08-10',
        dueDate: '2027-09-09',
        status: 'due',
      },
    ]);
  });

  it('newly elected officer sworn in after the election: initial and the 2027 biennial', () => {
    const result = plan({ record: record({ appointmentDate: '2027-08-25' }), today: '2027-09-01' });
    expect(summary(result.obligations)).toEqual([
      {
        cycleKey: 'initial:2027-08-25',
        statementDate: '2027-08-25',
        dueDate: '2027-09-24',
        status: 'due',
      },
      {
        cycleKey: 'biennial:2027',
        statementDate: '2027-11-01',
        dueDate: '2027-12-31',
        status: 'upcoming',
      },
    ]);
  });

  it('long-serving officer in the December biennial: due on 1 November, overdue on 1 January', () => {
    const due = plan({ record: record(), today: '2027-11-01' });
    expect(created(due)[0]).toMatchObject({ cycleKey: 'biennial:2027', status: 'due' });
    const overdue = plan({ record: record(), today: '2028-01-01' });
    expect(created(overdue)[0]).toMatchObject({ cycleKey: 'biennial:2027', status: 'overdue' });
  });
});
