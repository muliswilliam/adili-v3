import { describe, expect, it } from 'vitest';

import { IDS, seededRequest } from '../components/access/testing';
import { decisionClock, requestStages } from './progress';

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

  it('runs for the Commission’s own decision period, not a fixed 30 days', async () => {
    const request = {
      ...(await seededRequest(IDS.deciding)),
      submittedAt: '2026-10-01T09:00:00Z',
      decisionDeadlineAt: '2026-10-22T09:00:00Z',
    };
    expect(decisionClock(request, Date.parse('2026-10-02T09:00:00Z'))).toMatchObject({
      day: 1,
      of: 21,
      daysLeft: 20,
    });
  });

  it('stops once the request is decided or closed', async () => {
    expect(decisionClock(await seededRequest(IDS.denied), Date.now())).toBeNull();
  });
});

describe('requestStages', () => {
  it('dates the officer identified by its register entry', async () => {
    const request = await seededRequest(IDS.deciding);
    const identifiedAt = '2026-09-21T07:30:00Z';
    const stages = requestStages(
      {
        ...request,
        timeline: [
          ...request.timeline.filter((entry) => entry.kind !== 'identified'),
          {
            id: 'identified-1',
            kind: 'identified',
            at: identifiedAt,
            actor: null,
            summary: 'Officer identified',
            reference: request.reference,
            inWriting: false,
          },
        ],
      },
      Date.now(),
    );
    expect(stages.find((stage) => stage.id === 'identified')).toMatchObject({
      state: 'done',
      detail: '21 Sep 2026',
    });
  });

  it('names no fixed window before the officer is notified', async () => {
    const request = await seededRequest(IDS.submitted);
    const notified = requestStages(request, Date.parse(request.submittedAt)).find(
      (stage) => stage.id === 'notified',
    );
    expect(notified).toMatchObject({
      state: 'upcoming',
      detail: 'They then have a window to respond',
    });
  });
});
