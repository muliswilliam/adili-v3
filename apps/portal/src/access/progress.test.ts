import { describe, expect, it } from 'vitest';

import { IDS, seededRequest } from '../components/access/testing';
import { decisionClock } from './progress';

describe('decisionClock', () => {
  it('counts Kenyan calendar days, moving on at midnight in Nairobi', async () => {
    const request = {
      ...(await seededRequest(IDS.deciding)),
      // 23:00 on 1 Oct in Nairobi; due 23:00 on 31 Oct.
      submittedAt: '2026-10-01T20:00:00Z',
      decisionDeadlineAt: '2026-10-31T20:00:00Z',
    };

    // 00:30 on 2 Oct in Nairobi: day 1, though only 1.5 hours have passed.
    expect(decisionClock(request, Date.parse('2026-10-01T21:30:00Z'))).toEqual({
      day: 1,
      of: 30,
      daysLeft: 29,
      state: 'due',
    });
    // 00:30 on 31 Oct: due today, though 22.5 hours are left.
    expect(decisionClock(request, Date.parse('2026-10-30T21:30:00Z'))).toMatchObject({
      day: 30,
      daysLeft: 0,
      state: 'today',
    });
    // 00:30 on 1 Nov: a day late.
    expect(decisionClock(request, Date.parse('2026-10-31T21:30:00Z'))).toMatchObject({
      daysLeft: -1,
      state: 'late',
    });
  });

  it('stops once the request is decided or closed', async () => {
    expect(decisionClock(await seededRequest(IDS.denied), Date.now())).toBeNull();
  });
});
