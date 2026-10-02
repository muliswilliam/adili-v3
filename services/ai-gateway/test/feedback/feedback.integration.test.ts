import { randomUUID } from 'node:crypto';

import { outbox } from '@adili/events';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import { feedback } from '../../src/db/schema.js';
import { contractErrors } from '../support/contract.js';
import {
  explainInput,
  summarizeInput,
  summarizeOutput,
  taskRequest,
  usage,
} from '../support/inputs.js';
import { createTestApp, type TestApp } from '../support/test-app.js';

interface Job {
  id: string;
  status: string;
}

/**
 * Reviewers' ratings of job outputs over HTTP (spec 07c S13): recorded for the caller's own
 * succeeded jobs, one per reviewer per job, each announced by `ai.feedback.recorded.v1` with the
 * rating and reason only.
 */
describe('feedback', () => {
  let t: TestApp;
  let auth: { authorization: string };
  let succeeded: string;

  const rate = (jobId: string, payload: object, headers = auth) =>
    t.app.inject({
      method: 'PUT',
      url: `/internal/v1/jobs/${jobId}/feedback`,
      headers,
      payload,
    });

  const announced = async (jobId: string) =>
    (await t.db.select().from(outbox))
      .map((row) => row.envelope)
      .filter((envelope) => envelope.type === 'ai.feedback.recorded.v1')
      .filter((envelope) => (envelope.data as { jobId: string }).jobId === jobId);

  beforeAll(async () => {
    t = await createTestApp();
    await t.seedDemoGate('demo');
    auth = { authorization: `Bearer ${await t.token()}` };
    await t.record('summarize-declaration', summarizeInput, {
      status: 'completed',
      model: 'claude-opus-5-5',
      output: summarizeOutput,
      usage,
    });
    const response = await t.app.inject({
      method: 'POST',
      url: '/internal/v1/tasks/summarize-declaration',
      headers: { ...auth, 'idempotency-key': randomUUID() },
      payload: taskRequest(summarizeInput, { waitSeconds: 30 }),
    });
    const job = response.json<Job>();
    expect(job.status).toBe('succeeded');
    succeeded = job.id;
    return () => t.close();
  }, 60_000);

  it('records a rating, announces it without the note or the reviewer, and replaces it on a repeat', async () => {
    const first = await rate(succeeded, {
      reviewerSubject: 'reviewer-a',
      rating: 'not-helpful',
      reason: 'missed-something',
      note: 'It left out the second plot.',
    });
    expect(first.statusCode).toBe(200);
    const body = first.json<Record<string, unknown>>();
    expect(body).toEqual({
      jobId: succeeded,
      reviewerSubject: 'reviewer-a',
      rating: 'not-helpful',
      reason: 'missed-something',
      note: 'It left out the second plot.',
      at: expect.any(String) as string,
    });
    expect(contractErrors('Feedback', body)).toEqual([]);

    const [event] = await announced(succeeded);
    expect(event).toMatchObject({
      type: 'ai.feedback.recorded.v1',
      tenant: 'demo',
      data: {
        jobId: succeeded,
        task: 'summarize-declaration',
        tenant: 'demo',
        rating: 'not-helpful',
        reason: 'missed-something',
      },
    });
    expect(JSON.stringify(event)).not.toContain('second plot');
    expect(JSON.stringify(event)).not.toContain('reviewer-a');

    // The same reviewer rates again: one rating, updated, announced again under the same id.
    const again = await rate(succeeded, {
      reviewerSubject: 'reviewer-a',
      rating: 'helpful',
      reason: null,
      note: null,
    });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ rating: 'helpful', reason: null, note: null });
    // Another reviewer has their own rating.
    expect(
      (
        await rate(succeeded, {
          reviewerSubject: 'reviewer-b',
          rating: 'helpful',
          reason: null,
          note: null,
        })
      ).statusCode,
    ).toBe(200);

    const rows = await t.db.select().from(feedback).where(eq(feedback.jobId, succeeded));
    expect(rows.map((row) => [row.reviewerSubject, row.rating]).sort()).toEqual([
      ['reviewer-a', 'helpful'],
      ['reviewer-b', 'helpful'],
    ]);
    const events = await announced(succeeded);
    expect(events).toHaveLength(3);
    const ids = events.map((e) => (e.data as { feedbackId: string }).feedbackId);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).not.toBe(ids[0]);
    expect(events[1]?.data).toMatchObject({ rating: 'helpful', reason: null });
  });

  it("is 404 for another caller's job, a job without an output and an unknown job", async () => {
    const input = { reviewerSubject: 'reviewer-a', rating: 'helpful', reason: null, note: null };
    const other = { authorization: `Bearer ${await t.token({ clientId: 'declarations' })}` };
    expect((await rate(succeeded, input, other)).statusCode).toBe(404);

    // A job that failed (no recorded response for this input) has nothing to rate.
    const failedInput = { ...explainInput, language: 'sw' };
    const response = await t.app.inject({
      method: 'POST',
      url: '/internal/v1/tasks/explain-flags',
      headers: { ...auth, 'idempotency-key': randomUUID() },
      payload: taskRequest(failedInput, { waitSeconds: 30 }),
    });
    const failed = response.json<Job>();
    expect(failed.status).toBe('failed');
    expect((await rate(failed.id, input)).statusCode).toBe(404);

    expect((await rate(randomUUID(), input)).statusCode).toBe(404);
    expect(await announced(failed.id)).toEqual([]);
  }, 60_000);

  it('refuses an invalid rating and a caller without the ai scope', async () => {
    const invalid = [
      { reviewerSubject: '', rating: 'helpful', reason: null, note: null },
      { reviewerSubject: 'reviewer-a', rating: 'meh', reason: null, note: null },
      { reviewerSubject: 'reviewer-a', rating: 'not-helpful', reason: 'boring', note: null },
      { reviewerSubject: 'reviewer-a', rating: 'helpful', reason: null, note: 'x'.repeat(1001) },
      { reviewerSubject: 'reviewer-a', rating: 'helpful' },
    ];
    for (const payload of invalid) {
      expect((await rate(succeeded, payload)).statusCode).toBe(400);
    }
    const noScope = { authorization: `Bearer ${await t.token({ scope: 'profile' })}` };
    const input = { reviewerSubject: 'reviewer-a', rating: 'helpful', reason: null, note: null };
    expect((await rate(succeeded, input, noScope)).statusCode).toBe(403);
  });
});
