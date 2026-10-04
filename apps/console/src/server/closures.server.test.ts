import { REVIEWER, SUPERVISOR } from '@adili/roles';
import createClient from 'openapi-fetch';
import { beforeEach, describe, expect, it } from 'vitest';

import { approveClosures, loadClosureSummary } from './closures.server';
import { unsignedMockToken } from './mock-http';
import type { paths } from './review/api.gen';
import {
  MOCK_CLOSURE_ENTITIES,
  MOCK_CLOSURE_FORMER_HOLDER,
  mockClosureCycles,
} from './review/closures-mock.server';
import { mockReviewFetch, resetReviewMock } from './review/mock.server';

const NOW_MS = Date.parse('2026-10-02T09:00:00Z');
const SLUG = 'tsc';
const CYCLES = mockClosureCycles(NOW_MS);

/** Every request the client sent, as the mock saw it. */
let sent: Request[] = [];

function as(roles: readonly string[], subject = 'a1b2c3d4-0000-4000-8000-000000000003') {
  return createClient<paths>({
    baseUrl: 'http://review.test',
    headers: {
      authorization: `Bearer ${unsignedMockToken({ subject, name: 'Lucy Wambui', roles })}`,
    },
    fetch: (request: Request) => {
      sent.push(request.clone());
      return mockReviewFetch(request);
    },
  });
}

const supervisor = () => as([SUPERVISOR]);

async function summary(filter: Parameters<typeof loadClosureSummary>[2]) {
  const result = await loadClosureSummary(supervisor(), SLUG, filter);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.data;
}

/** The sequence number of a CMP reference: CMP-TSC-2026-0000101-K is 101. */
const sequence = (reference: string | null) => Number(reference?.split('-')[3]);

beforeEach(() => {
  sent = [];
  resetReviewMock(NOW_MS, { closures: { chunkDelayMs: 0 } });
});

describe('loadClosureSummary (S3)', () => {
  it('counts the swept cycle: proposals waiting, sampled, approved and the sample rate', async () => {
    expect(await summary({ cycleYear: CYCLES.ready })).toEqual({
      cycleYear: CYCLES.ready,
      eligibleProposed: 1240,
      sampled: 25,
      approved: 312,
      sampleRate: 0.02,
      windowClosedAt: '2026-08-31T21:00:00.000Z',
      lastSweptAt: '2026-10-01T23:00:00.000Z',
    });
  });

  it('narrows the counts to a declaration type and a reporting entity', async () => {
    const biennial = await summary({ cycleYear: CYCLES.ready, type: 'biennial' });
    const initial = await summary({ cycleYear: CYCLES.ready, type: 'initial' });
    const final = await summary({ cycleYear: CYCLES.ready, type: 'final' });
    expect(biennial.eligibleProposed).toBe(868);
    expect(biennial.eligibleProposed + initial.eligibleProposed + final.eligibleProposed).toBe(
      1240,
    );
    const entity = await summary({
      cycleYear: CYCLES.ready,
      reportingEntityId: MOCK_CLOSURE_ENTITIES[0],
    });
    expect(entity.eligibleProposed).toBe(310);
  });

  it('has no sweep yet for a cycle whose clarification window is still open', async () => {
    const pending = await summary({ cycleYear: CYCLES.pending });
    expect(pending.lastSweptAt).toBeNull();
    expect(pending.eligibleProposed).toBe(0);
    expect(pending.windowClosedAt).toBe('2026-12-30T21:00:00.000Z');
  });

  it('has nothing left to approve once a cycle is closed', async () => {
    const closed = await summary({ cycleYear: CYCLES.closed });
    expect(closed.eligibleProposed).toBe(0);
    expect(closed.approved).toBe(980);
    expect(closed.lastSweptAt).not.toBeNull();
  });

  it('refuses a reviewer: bulk closure is for supervisors', async () => {
    const result = await loadClosureSummary(as([REVIEWER]), SLUG, { cycleYear: CYCLES.ready });
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 403, code: 'supervisor-required' } },
    });
  });
});

describe('approveClosures (S4)', () => {
  it('approves every waiting proposal in chunks of 100 with consecutive CMP numbers', async () => {
    const result = await approveClosures(supervisor(), SLUG, { cycleYear: CYCLES.ready }, 'k-1');
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.data).toMatchObject({ approved: 1240, skipped: 0, chunks: 13 });
    expect(result.data.firstReference).toMatch(/^CMP-TSC-2026-\d{7}-[0-9A-Z]$/);
    expect(sequence(result.data.lastReference) - sequence(result.data.firstReference)).toBe(1239);
    const after = await summary({ cycleYear: CYCLES.ready });
    expect(after).toMatchObject({ eligibleProposed: 0, approved: 1552, sampled: 25 });
  });

  it('sends the Idempotency-Key once', async () => {
    await approveClosures(supervisor(), SLUG, { cycleYear: CYCLES.ready }, 'k-once');
    const post = sent.find((request) => request.method === 'POST');
    expect(post?.headers.get('idempotency-key')).toBe('k-once');
  });

  it('approves only what the filters match', async () => {
    const result = await approveClosures(
      supervisor(),
      SLUG,
      { cycleYear: CYCLES.ready, type: 'final' },
      'k-final',
    );
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    const left = await summary({ cycleYear: CYCLES.ready });
    expect(left.eligibleProposed).toBe(1240 - result.data.approved);
    expect((await summary({ cycleYear: CYCLES.ready, type: 'final' })).eligibleProposed).toBe(0);
  });

  it('resumes under the same key after a chunk fails, skipping no numbers', async () => {
    resetReviewMock(NOW_MS, { closures: { chunkDelayMs: 0, failAtChunk: 4 } });
    const filter = { cycleYear: CYCLES.ready };
    const failed = await approveClosures(supervisor(), SLUG, filter, 'k-resume');
    expect(failed).toMatchObject({ ok: false, error: { kind: 'unavailable' } });
    // The three chunks before the failure stay approved.
    expect(await summary(filter)).toMatchObject({ eligibleProposed: 940, approved: 612 });

    const resumed = await approveClosures(supervisor(), SLUG, filter, 'k-resume');
    if (!resumed.ok) throw new Error(JSON.stringify(resumed.error));
    expect(resumed.data).toMatchObject({ approved: 1240, chunks: 13 });
    expect(sequence(resumed.data.lastReference) - sequence(resumed.data.firstReference)).toBe(1239);
  });

  it('refuses a key sent again with other filters (422) and changes nothing', async () => {
    resetReviewMock(NOW_MS, { closures: { chunkDelayMs: 0, failAtChunk: 2 } });
    await approveClosures(supervisor(), SLUG, { cycleYear: CYCLES.ready }, 'k-reuse');
    const before = await summary({ cycleYear: CYCLES.ready });
    const reused = await approveClosures(
      supervisor(),
      SLUG,
      { cycleYear: CYCLES.ready, type: 'final' },
      'k-reuse',
    );
    expect(reused).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 422 } },
    });
    expect(await summary({ cycleYear: CYCLES.ready })).toEqual(before);
  });

  it('leaves the closures of cases the approver once held for another supervisor', async () => {
    const held = as([SUPERVISOR], MOCK_CLOSURE_FORMER_HOLDER);
    const result = await approveClosures(held, SLUG, { cycleYear: CYCLES.ready }, 'k-held');
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.data).toMatchObject({ approved: 1237, skipped: 3 });
  });

  it('refuses a reviewer and changes nothing', async () => {
    const result = await approveClosures(as([REVIEWER]), SLUG, { cycleYear: CYCLES.ready }, 'k-r');
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 403, code: 'supervisor-required' } },
    });
    expect((await summary({ cycleYear: CYCLES.ready })).eligibleProposed).toBe(1240);
  });
});
