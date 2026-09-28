import { describe, expect, it } from 'vitest';

import {
  jitterMs,
  nairobiDateOf,
  type ObligationSchedule,
  startOfNairobiDay,
  timeline,
} from '../../src/obligations/workflow/timeline.js';

const HOUR = 60 * 60 * 1000;
const WINDOW = 6 * HOUR;

const biennial: ObligationSchedule = {
  obligationId: '0199a000-0000-7000-8000-00000000b001',
  type: 'biennial',
  statementDate: '2027-11-01',
  dueDate: '2027-12-31',
  reminderOffsetsDays: [7, 30, 14],
  jitterWindowMs: WINDOW,
};

const at = (iso: string) => Date.parse(iso);
const noon = (date: string) => at(`${date}T12:00:00+03:00`);

describe('obligation timeline', () => {
  it('S10: a biennial created in June turns due 1 Nov, is reminded 1/17/24 Dec with jitter, overdue 1 Jan', () => {
    const jitter = jitterMs(biennial.obligationId, WINDOW);

    const plan = timeline(biennial, noon('2027-06-01'), new Set());

    expect(plan.status).toBe('upcoming');
    expect(plan.missed).toEqual([]);
    expect(plan.steps).toEqual([
      { kind: 'status', status: 'due', at: at('2027-11-01T00:00:00+03:00') },
      { kind: 'reminder', offsetDays: 30, at: noon('2027-12-01') + jitter },
      { kind: 'reminder', offsetDays: 14, at: noon('2027-12-17') + jitter },
      { kind: 'reminder', offsetDays: 7, at: noon('2027-12-24') + jitter },
      { kind: 'status', status: 'overdue', at: at('2028-01-01T00:00:00+03:00') },
    ]);
  });

  it('keeps jitter within the window, the same for the same id, spread across ids', () => {
    const ids = Array.from(
      { length: 500 },
      (_, i) => `0199a000-0000-7000-8000-${String(i).padStart(12, '0')}`,
    );
    const jitters = ids.map((id) => jitterMs(id, WINDOW));

    expect(jitters.every((j) => Math.abs(j) <= WINDOW)).toBe(true);
    expect(ids.map((id) => jitterMs(id, WINDOW))).toEqual(jitters);
    // Spread over the whole window, not bunched: some in each quarter.
    for (let q = 0; q < 4; q += 1) {
      const from = -WINDOW + (q * WINDOW) / 2;
      expect(jitters.some((j) => j >= from && j < from + WINDOW / 2)).toBe(true);
    }
    expect(jitterMs(ids[0] ?? '', 0)).toBe(0);
  });

  it('leaves out reminders already recorded', () => {
    const plan = timeline(biennial, noon('2027-12-05'), new Set([30]));

    expect(plan.status).toBe('due');
    expect(plan.steps.map((step) => step.kind === 'reminder' && step.offsetDays)).toEqual([
      14,
      7,
      false,
    ]);
  });

  it('marks reminders of earlier days missed and still sends one due today', () => {
    // 17 Dec at 23:00: the 30-day reminder (1 Dec) was missed; the 14-day one is today.
    const now = at('2027-12-17T23:00:00+03:00');

    const plan = timeline(biennial, now, new Set());

    expect(plan.missed).toEqual([
      { offsetDays: 30, scheduledAt: noon('2027-12-01') + jitterMs(biennial.obligationId, WINDOW) },
    ]);
    expect(plan.steps[0]).toMatchObject({ kind: 'reminder', offsetDays: 14 });
  });

  it('has nothing left after the due date but the status: overdue', () => {
    const plan = timeline(biennial, noon('2028-01-01'), new Set());

    expect(plan.status).toBe('overdue');
    expect(plan.steps).toEqual([]);
    expect(plan.missed.map((m) => m.offsetDays)).toEqual([30, 14, 7]);
  });

  it('never plans an initial as upcoming: due from creation, overdue after 30 days', () => {
    const initial: ObligationSchedule = {
      ...biennial,
      type: 'initial',
      statementDate: '2027-03-10',
      dueDate: '2027-04-09',
    };

    const plan = timeline(initial, noon('2027-03-10'), new Set());

    expect(plan.status).toBe('due');
    expect(plan.steps.map((step) => step.kind)).toEqual([
      'reminder',
      'reminder',
      'reminder',
      'status',
    ]);
    expect(plan.steps.at(-1)).toEqual({
      kind: 'status',
      status: 'overdue',
      at: startOfNairobiDay('2027-04-10'),
    });
  });

  it('counts days in Nairobi', () => {
    expect(nairobiDateOf(at('2027-10-31T21:00:00Z'))).toBe('2027-11-01');
    expect(nairobiDateOf(at('2027-10-31T20:59:59Z'))).toBe('2027-10-31');
  });
});
