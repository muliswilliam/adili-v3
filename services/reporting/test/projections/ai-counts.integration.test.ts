import { randomUUID } from 'node:crypto';

import { withTenant } from '@adili/data-access';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { aiFeedbackFacts, copilotCaseFacts } from '../../src/db/schema.js';
import { aiFeedbackRecorded, copilotUpdated } from '../support/events.js';
import { type ReportingApi, startReportingApi } from '../support/reporting-api.js';

/**
 * Spec 07c counts at the inbox seam: `review.copilot.updated.v1` makes a case AI-assisted from
 * its first `ready`, and `ai.feedback.recorded.v1` keeps one row per rating, the latest winning,
 * whatever order the events arrive in. Ids, statuses, ratings and reasons only.
 */
describe('AI counts projections (spec 07c)', () => {
  let api: ReportingApi;

  beforeAll(async () => {
    api = await startReportingApi();
    return () => api.close();
  });

  beforeEach(async () => {
    await api.reset();
  });

  it('a case is AI-assisted from its first ready copilot, in that financial year; its status follows the latest event', async () => {
    const caseId = randomUUID();
    const pending = copilotUpdated('psc', {
      caseId,
      status: 'pending',
      time: '2028-06-30T20:00:00Z',
    });
    const ready = copilotUpdated('psc', { caseId, status: 'ready', time: '2028-06-30T21:30:00Z' });
    const stale = copilotUpdated('psc', { caseId, status: 'stale', time: '2028-08-01T08:00:00Z' });
    const readyAgain = copilotUpdated('psc', {
      caseId,
      status: 'ready',
      time: '2028-08-01T08:05:00Z',
    });

    // Out of order: the later ready first.
    for (const event of [readyAgain, pending, stale, ready]) {
      expect(await api.deliver(event)).toBe(true);
    }
    expect(await api.deliver(ready)).toBe(false);

    const rows = await api.asPlatform((tx) => tx.select().from(copilotCaseFacts));
    expect(rows).toEqual([
      {
        caseId,
        tenant: 'psc',
        status: 'ready',
        statusAt: new Date('2028-08-01T08:05:00Z'),
        // 21:30 UTC on 30 June is 1 July in Nairobi: the 2028/2029 financial year.
        firstReadyAt: new Date('2028-06-30T21:30:00Z'),
        fy: 2028,
      },
    ]);

    // A copilot never ready is no AI-assisted case.
    const blocked = randomUUID();
    await api.deliver(
      copilotUpdated('tsc', {
        caseId: blocked,
        status: 'not-enabled',
        time: '2028-01-01T08:00:00Z',
      }),
    );
    const tsc = await withTenant(api.db, { tenant: 'tsc', subject: 'test' }, (tx) =>
      tx.select().from(copilotCaseFacts),
    );
    expect(tsc).toEqual([
      expect.objectContaining({ caseId: blocked, firstReadyAt: null, fy: null }),
    ]);
  });

  it('keeps one row per rating, the latest winning, under its Commission', async () => {
    const feedbackId = randomUUID();
    const first = aiFeedbackRecorded('psc', {
      feedbackId,
      rating: 'not-helpful',
      reason: 'unclear',
      recordedAt: '2028-02-01T08:00:00Z',
    });
    const changed = aiFeedbackRecorded('psc', {
      feedbackId,
      rating: 'helpful',
      recordedAt: '2028-02-01T09:00:00Z',
    });
    const other = aiFeedbackRecorded('psc', {
      feedbackId: randomUUID(),
      task: 'explain-flags',
      rating: 'not-helpful',
      reason: 'too-long',
      recordedAt: '2028-02-02T08:00:00Z',
    });

    // The change arrives before the first rating: the first does not undo it.
    for (const event of [changed, first, other]) {
      expect(await api.deliver(event)).toBe(true);
    }

    const rows = await api.asPlatform((tx) => tx.select().from(aiFeedbackFacts));
    expect(rows.map((row) => [row.feedbackId, row.task, row.rating, row.reason, row.fy])).toEqual(
      expect.arrayContaining([
        [feedbackId, 'summarize-declaration', 'helpful', null, 2027],
        [other.data.feedbackId, 'explain-flags', 'not-helpful', 'too-long', 2027],
      ]),
    );
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.feedbackId === feedbackId)?.recordedAt).toEqual(
      new Date('2028-02-01T09:00:00Z'),
    );

    // Another Commission sees none of them.
    const tsc = await withTenant(api.db, { tenant: 'tsc', subject: 'test' }, (tx) =>
      tx.select().from(aiFeedbackFacts),
    );
    expect(tsc).toEqual([]);
  });
});
