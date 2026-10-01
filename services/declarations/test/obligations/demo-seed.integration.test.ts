import { asc } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { cycleCalendar } from '../../src/db/schema.js';
import { openDemoCycle } from '../../src/obligations/demo-seed.js';
import { openedCycles } from '../../src/obligations/engine.js';
import { type DeclarationsApi, startDeclarationsApi } from '../support/declarations-api.js';
import { policyVersion } from '../support/fake-directory.js';

let api: DeclarationsApi;

beforeAll(async () => {
  api = await startDeclarationsApi();
});

afterAll(async () => {
  await api.close();
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
});
