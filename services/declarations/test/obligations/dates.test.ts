import { describe, expect, it } from 'vitest';

import { addDays, atMonthDay, nairobiDate, parseCivilDate } from '../../src/obligations/dates.js';

describe('civil dates', () => {
  it.each([
    // [from, days, expected]
    ['2027-03-10', 30, '2027-04-09'],
    ['2027-01-31', 30, '2027-03-02'], // month end, February has 28 days in 2027
    ['2027-02-09', 30, '2027-03-11'],
    ['2028-01-30', 30, '2028-02-29'], // lands on the leap day
    ['2028-02-29', 30, '2028-03-30'], // starts on the leap day
    ['2027-12-15', 30, '2028-01-14'], // year boundary
    ['2027-12-31', 1, '2028-01-01'],
    ['2027-12-31', -30, '2027-12-01'],
    ['2027-11-01', -120, '2027-07-04'],
  ])('%s + %i days is %s', (from, days, expected) => {
    expect(addDays(from, days)).toBe(expected);
  });

  it('places a month-day in a year', () => {
    expect(atMonthDay(2027, '11-01')).toBe('2027-11-01');
    expect(atMonthDay(2029, '12-31')).toBe('2029-12-31');
  });

  it('refuses dates that do not exist', () => {
    expect(() => parseCivilDate('2027-02-29')).toThrow(/2027-02-29/);
    expect(() => parseCivilDate('2027-13-01')).toThrow();
    expect(() => parseCivilDate('27-01-01')).toThrow();
    expect(() => atMonthDay(2027, '02-29')).toThrow();
    expect(parseCivilDate('2028-02-29')).toEqual({ year: 2028, month: 2, day: 29 });
  });

  it("reads today's date in Nairobi (UTC+3, no daylight saving)", () => {
    expect(nairobiDate(new Date('2027-10-31T20:59:59Z'))).toBe('2027-10-31');
    expect(nairobiDate(new Date('2027-10-31T21:00:00Z'))).toBe('2027-11-01');
    expect(nairobiDate(new Date('2027-12-31T21:30:00Z'))).toBe('2028-01-01');
  });
});
