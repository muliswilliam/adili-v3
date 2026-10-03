import { describe, expect, it } from 'vitest';

import { addDays, daysBetween, plural, nairobiDayStartOf } from './calendar-days';

describe('daysBetween', () => {
  it('counts calendar days in Kenyan time, not 24-hour spans', () => {
    // 23:30 and 00:30 the next day in Nairobi are one day apart though an hour passed.
    expect(daysBetween('2026-09-27T20:30:00Z', '2026-09-27T21:30:00Z')).toBe(1);
    expect(daysBetween('2026-09-01T06:00:00Z', '2026-09-01T18:00:00Z')).toBe(0);
    expect(daysBetween('2026-09-01T06:00:00Z', '2026-10-01T06:00:00Z')).toBe(30);
    expect(daysBetween('2026-10-01T06:00:00Z', '2026-09-28T06:00:00Z')).toBe(-3);
  });
});

describe('nairobiDayStartOf', () => {
  it('is midnight in Nairobi on the Kenyan calendar day of the instant', () => {
    expect(nairobiDayStartOf('2026-09-01T06:00:00Z')).toBe('2026-08-31T21:00:00.000Z');
    expect(nairobiDayStartOf('2026-08-31T21:00:00Z')).toBe('2026-08-31T21:00:00.000Z');
    expect(nairobiDayStartOf('2026-09-01T20:59:59.999Z')).toBe('2026-08-31T21:00:00.000Z');
  });

  it('is the next Kenyan day from 00:00 to 03:00 in Nairobi, while UTC is a day behind', () => {
    // 01:00 on 2 September in Nairobi is 22:00 on 1 September in UTC.
    expect(nairobiDayStartOf('2026-09-01T22:00:00Z')).toBe('2026-09-01T21:00:00.000Z');
  });
});

describe('addDays', () => {
  it('moves an instant by whole days', () => {
    expect(addDays('2026-09-01T09:00:00Z', 20)).toBe('2026-09-21T09:00:00.000Z');
    expect(addDays('2026-09-01T09:00:00Z', -1)).toBe('2026-08-31T09:00:00.000Z');
  });
});

describe('plural', () => {
  it('counts a noun', () => {
    expect(plural(1, 'day')).toBe('1 day');
    expect(plural(3, 'day')).toBe('3 days');
    expect(plural(0, 'item')).toBe('0 items');
  });
});
