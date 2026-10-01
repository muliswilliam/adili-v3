import { describe, expect, it } from 'vitest';

import type { PersonObligation } from '../../src/declarations/declarations-client.js';
import { ladderWindowDays, twoMissedCycles } from '../../src/referrals/missed-cycles.js';

const biennial = (
  year: number,
  status: PersonObligation['status'] = 'overdue',
  overrides: Partial<PersonObligation> = {},
): PersonObligation => ({
  obligationId: `0199c000-0000-7000-8000-00000000${String(year)}`,
  type: 'biennial',
  cycleKey: `biennial:${String(year)}`,
  status,
  dueDate: `${String(year)}-12-31`,
  filedAt: status === 'filed' ? `${String(year)}-12-01T09:00:00.000Z` : null,
  late: false,
  ...overrides,
});

/** 14 + 14 + 30 days: the default ladder. */
const WINDOW = 58;

describe('twoMissedCycles (S12)', () => {
  it('finds two consecutive biennial cycles overdue and unfiled past the ladder window', () => {
    const history = [biennial(2023, 'filed'), biennial(2025), biennial(2027)];

    expect(twoMissedCycles(history, '2028-03-01', WINDOW)).toEqual({
      cycleYear: 2027,
      earlierCycleYear: 2025,
      obligationIds: [history[1]?.obligationId, history[2]?.obligationId],
    });
  });

  it('waits until the later cycle is past the ladder window', () => {
    const history = [biennial(2025), biennial(2027)];

    // 31 December 2027 plus 58 days is 27 February 2028.
    expect(twoMissedCycles(history, '2028-02-27', WINDOW)).toBeNull();
    expect(twoMissedCycles(history, '2028-02-28', WINDOW)).not.toBeNull();
  });

  it('needs the two cycles consecutive, both overdue and unfiled', () => {
    expect(
      twoMissedCycles(
        [biennial(2023), biennial(2025, 'filed'), biennial(2027)],
        '2029-01-01',
        WINDOW,
      ),
    ).toBeNull();
    expect(
      twoMissedCycles([biennial(2025), biennial(2027, 'due')], '2029-01-01', WINDOW),
    ).toBeNull();
    expect(
      twoMissedCycles(
        [biennial(2025, 'overdue', { filedAt: '2028-01-05T09:00:00.000Z' }), biennial(2027)],
        '2029-01-01',
        WINDOW,
      ),
    ).toBeNull();
    expect(twoMissedCycles([biennial(2027)], '2029-01-01', WINDOW)).toBeNull();
  });

  it('does not take two missed cycles with a cycle between them as consecutive', () => {
    // No 2025 obligation (not in post then), or a cancelled one: 2023 and 2027 are two cycles apart.
    expect(twoMissedCycles([biennial(2023), biennial(2027)], '2028-03-01', WINDOW)).toBeNull();
    expect(
      twoMissedCycles(
        [biennial(2023), biennial(2025, 'cancelled'), biennial(2027)],
        '2028-03-01',
        WINDOW,
      ),
    ).toBeNull();
  });

  it('counts biennial obligations only, in cycle order, ignoring cancelled ones', () => {
    const initial: PersonObligation = {
      ...biennial(2026),
      type: 'initial',
      cycleKey: 'initial:2026-03-01',
    };
    const history = [biennial(2027), biennial(2023, 'cancelled'), initial, biennial(2025)];

    expect(twoMissedCycles(history, '2028-03-01', WINDOW)?.cycleYear).toBe(2027);
    expect(twoMissedCycles([biennial(2027), initial], '2028-03-01', WINDOW)).toBeNull();
  });

  it('takes the latest pair when several qualify', () => {
    const history = [biennial(2023), biennial(2025), biennial(2027)];

    expect(twoMissedCycles(history, '2028-03-01', WINDOW)?.cycleYear).toBe(2027);
  });
});

describe('ladderWindowDays', () => {
  it('adds the notice, warning and stoppage windows', () => {
    expect(
      ladderWindowDays({ noticeWindowDays: 14, warningWindowDays: 14, stoppageWindowDays: 30 }),
    ).toBe(58);
  });
});
