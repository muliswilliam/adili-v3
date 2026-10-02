import { randomUUID } from 'node:crypto';

import { withTenant } from '@adili/data-access';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { aiFeedbackFacts, copilotCaseFacts } from '../../src/db/schema.js';
import { contractErrors, okResponse } from '../support/contract.js';
import { aiFeedbackRecorded, copilotUpdated } from '../support/events.js';
import { type Caller, type ReportingApi, startReportingApi } from '../support/reporting-api.js';

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
      block: `flag:${randomUUID()}`,
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

  it('story 19: EACC reads the AI-assisted cases and ratings per Commission for a year, counts only', async () => {
    const analyst: Caller = { sub: 'eacc-analyst-1', tenant: 'eacc', roles: ['eacc-analyst'] };
    const ready = (tenant: string, time: string) =>
      copilotUpdated(tenant, { caseId: randomUUID(), status: 'ready', time });
    const rated = (
      tenant: string,
      task: string,
      rating: 'helpful' | 'not-helpful',
      reason: string | null,
      recordedAt = '2028-02-01T08:00:00Z',
    ) => aiFeedbackRecorded(tenant, { feedbackId: randomUUID(), task, rating, reason, recordedAt });
    for (const event of [
      ready('psc', '2028-01-10T08:00:00Z'),
      ready('psc', '2028-03-10T08:00:00Z'),
      ready('tsc', '2028-03-10T08:00:00Z'),
      // Another year's, and a copilot never ready.
      ready('psc', '2028-08-10T08:00:00Z'),
      copilotUpdated('psc', {
        caseId: randomUUID(),
        status: 'pending',
        time: '2028-01-10T08:00:00Z',
      }),
      rated('psc', 'summarize-declaration', 'helpful', null),
      rated('psc', 'summarize-declaration', 'not-helpful', 'unclear'),
      rated('psc', 'explain-flags', 'not-helpful', 'too-long'),
      rated('psc', 'explain-flags', 'not-helpful', 'too-long'),
      rated('ncpwd', 'draft-clarification', 'helpful', null),
      rated('psc', 'explain-flags', 'helpful', null, '2028-08-01T08:00:00Z'),
    ]) {
      expect(await api.deliver(event)).toBe(true);
    }

    const response = await api.get('/v1/eacc/ai-usage/2027', analyst);
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<unknown>();
    expect(contractErrors(okResponse('/v1/eacc/ai-usage/{fy}', 'get'), body)).toEqual([]);
    const reasons = (counts: Record<string, number> = {}) => ({
      inaccurate: 0,
      'missed-something': 0,
      unclear: 0,
      'too-long': 0,
      other: 0,
      ...counts,
    });
    expect(body).toEqual({
      fy: 2027,
      commissions: [
        {
          tenant: 'ncpwd',
          aiAssistedCases: 0,
          ratings: [{ task: 'draft-clarification', helpful: 1, notHelpful: 0, reasons: reasons() }],
        },
        {
          tenant: 'psc',
          aiAssistedCases: 2,
          ratings: [
            {
              task: 'explain-flags',
              helpful: 0,
              notHelpful: 2,
              reasons: reasons({ 'too-long': 2 }),
            },
            {
              task: 'summarize-declaration',
              helpful: 1,
              notHelpful: 1,
              reasons: reasons({ unclear: 1 }),
            },
          ],
        },
        { tenant: 'tsc', aiAssistedCases: 1, ratings: [] },
      ],
    });

    // Commission staff, and an EACC role of another tenant, get 403; a bad year 400.
    for (const caller of [
      { sub: 'supervisor-psc', tenant: 'psc', roles: ['supervisor'] },
      { sub: 'admin-psc', tenant: 'psc', roles: ['commission-admin'] },
      { sub: 'odd-1', tenant: 'psc', roles: ['eacc-analyst'] },
    ] satisfies Caller[]) {
      expect((await api.get('/v1/eacc/ai-usage/2027', caller)).statusCode).toBe(403);
    }
    expect((await api.get('/v1/eacc/ai-usage/1999', analyst)).statusCode).toBe(400);
  });
});
