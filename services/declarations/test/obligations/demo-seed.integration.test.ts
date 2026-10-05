import { asc, inArray } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import { cycleCalendar } from '../../src/db/schema.js';
import { addDemoCycles, openDemoCycle } from '../../src/obligations/demo-seed.js';
import { openedCycles } from '../../src/obligations/engine.js';
import { type DeclarationsApi, startDeclarationsApi } from '../support/declarations-api.js';
import { policyVersion } from '../support/fake-directory.js';

let api: DeclarationsApi;

beforeAll(async () => {
  api = await startDeclarationsApi();
  return () => api.close();
});

describe('demo seed', () => {
  it('opens the 2027 cycle from today, leaves later cycles, and never narrows it', async () => {
    await openDemoCycle(api.db, new Date('2026-09-28T12:00:00+03:00'));
    await openDemoCycle(api.db, new Date('2027-01-15T12:00:00+03:00'));

    const calendar = await api.db
      .select()
      .from(cycleCalendar)
      .orderBy(asc(cycleCalendar.cycleYear));
    expect(calendar).toEqual([
      { cycleYear: 2027, openingLeadDays: 399 },
      { cycleYear: 2029, openingLeadDays: 120 },
      { cycleYear: 2031, openingLeadDays: 120 },
    ]);
    const rules = { ...policyVersion(), version: 1 };
    expect(openedCycles(calendar, rules, '2026-09-28')).toEqual([2027]);
  });

  it('adds the demo cycles once, open today with the demo policy’s statement date', async () => {
    try {
      expect(await addDemoCycles(api.db, [2024, 2026], 400)).toEqual([2024, 2026]);
      expect(await addDemoCycles(api.db, [2024, 2026], 400)).toEqual([]);

      const calendar = await api.db.select().from(cycleCalendar);
      const rules = {
        ...policyVersion(),
        version: 1,
        biennial: { statementDate: '06-30', dueDate: '12-31' },
      };
      expect(openedCycles(calendar, rules, '2026-10-05')).toEqual(
        expect.arrayContaining([2024, 2026]),
      );
    } finally {
      await api.db.delete(cycleCalendar).where(inArray(cycleCalendar.cycleYear, [2024, 2026]));
    }
  });
});
