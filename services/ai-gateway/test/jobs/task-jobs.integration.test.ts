import { randomUUID } from 'node:crypto';

import { outbox } from '@adili/events';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { jobs } from '../../src/db/schema.js';
import { JobsJanitor } from '../../src/jobs/jobs-janitor.js';
import { contractErrors } from '../support/contract.js';
import {
  explainInput,
  FLAG_ID,
  summarizeInput,
  summarizeOutput,
  taskRequest,
  usage,
} from '../support/inputs.js';
import { createTestApp, type TestApp } from '../support/test-app.js';

interface Job {
  id: string;
  status: string;
  reason: string | null;
  output: Record<string, unknown> | null;
  [key: string]: unknown;
}

/**
 * Drives `/internal/v1/tasks` and `/internal/v1/jobs` over HTTP against real Postgres and
 * compose Temporal, with the replay adapter serving recorded provider responses (spec 07c S1).
 */
describe('task jobs', () => {
  let t: TestApp;
  let auth: { authorization: string };

  beforeAll(async () => {
    t = await createTestApp();
    auth = { authorization: `Bearer ${await t.token()}` };
  });

  afterAll(async () => {
    await t.close();
  });

  const runTask = (
    task: string,
    payload: object,
    { key = randomUUID(), headers = auth }: { key?: string; headers?: Record<string, string> } = {},
  ) =>
    t.app.inject({
      method: 'POST',
      url: `/internal/v1/tasks/${task}`,
      headers: { ...headers, 'idempotency-key': key },
      payload,
    });

  const getJob = (id: string, headers = auth) =>
    t.app.inject({ method: 'GET', url: `/internal/v1/jobs/${id}`, headers });

  async function untilFinished(id: string): Promise<Job> {
    const deadline = Date.now() + 20_000;
    for (;;) {
      const job = (await getJob(id)).json<Job>();
      if (!['queued', 'running'].includes(job.status)) return job;
      if (Date.now() > deadline) throw new Error(`job ${id} still ${job.status}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  it('queues a job, runs it with the recorded response and serves the labelled output', async () => {
    await t.record('summarize-declaration', summarizeInput, {
      status: 'completed',
      model: 'claude-opus-5-5',
      output: summarizeOutput,
      usage,
    });

    const response = await runTask('summarize-declaration', taskRequest(summarizeInput));

    expect(response.statusCode).toBe(202);
    const queued = response.json<Job>();
    expect(queued).toMatchObject({
      task: 'summarize-declaration',
      tenant: 'demo',
      subjectRef: 'review-case:0199a8f0-3333-7000-8000-000000000003',
      status: 'queued',
      reason: null,
      promptVersion: 1,
      provider: 'replay',
      output: null,
    });
    expect(contractErrors('Job', queued)).toEqual([]);

    const job = await untilFinished(queued.id);
    expect(job).toMatchObject({
      status: 'succeeded',
      reason: null,
      usage: { tokensIn: 1200, tokensOut: 300 },
      output: {
        ...summarizeOutput,
        label: {
          aiAssisted: true,
          task: 'summarize-declaration',
          promptVersion: 1,
          provider: 'replay',
        },
      },
    });
    expect(job.outputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(job.finishedAt).not.toBeNull();
    expect(contractErrors('Job', job)).toEqual([]);
  });

  it('announces the finished job with hashes and counts only', async () => {
    const input = { ...summarizeInput, language: 'sw' };
    await t.record('summarize-declaration', input, {
      status: 'completed',
      model: 'claude-opus-5-5',
      output: summarizeOutput,
      usage,
    });
    const { id } = (await runTask('summarize-declaration', taskRequest(input))).json<Job>();
    const job = await untilFinished(id);

    const events = await t.db.select().from(outbox);
    const announced = events.filter((event) => event.envelope.subject === id);
    expect(announced).toHaveLength(1);
    expect(announced[0]?.envelope).toMatchObject({
      type: 'ai.job.completed.v1',
      tenant: 'demo',
      data: {
        jobId: id,
        task: 'summarize-declaration',
        subjectRef: 'review-case:0199a8f0-3333-7000-8000-000000000003',
        promptVersion: 1,
        provider: 'replay',
        inputHash: job.inputHash,
        outputHash: job.outputHash,
        tokensIn: 1200,
        tokensOut: 300,
        reason: null,
      },
    });
    const serialised = JSON.stringify(announced[0]?.envelope);
    expect(serialised).not.toContain('Machakos');
    expect(serialised).not.toContain('Test Declarant');
  });

  /** A summarize input unique to the test, so cached jobs of other tests never answer it. */
  let inputs = 0;
  function freshInput() {
    inputs += 1;
    return {
      ...summarizeInput,
      registryStatuses: [{ system: `test-${inputs}`, status: 'matched' }],
    };
  }

  async function recordSuccess(input: object) {
    await t.record('summarize-declaration', input, {
      status: 'completed',
      model: 'claude-opus-5-5',
      output: summarizeOutput,
      usage,
    });
  }

  describe('cache and idempotency', () => {
    it('returns the cached job for the same input and prompt version', async () => {
      const input = freshInput();
      await recordSuccess(input);
      const first = (await runTask('summarize-declaration', taskRequest(input))).json<Job>();
      await untilFinished(first.id);

      const again = await runTask('summarize-declaration', taskRequest(input));

      expect(again.statusCode).toBe(200);
      expect(again.json<Job>()).toMatchObject({ id: first.id, status: 'succeeded' });
      expect(again.headers['idempotent-replayed']).toBeUndefined();
    });

    it('returns the first job for a replayed Idempotency-Key', async () => {
      const input = freshInput();
      await recordSuccess(input);
      const key = randomUUID();
      const first = (
        await runTask('summarize-declaration', taskRequest(input), { key })
      ).json<Job>();
      await untilFinished(first.id);

      const replay = await runTask('summarize-declaration', taskRequest(input), { key });

      expect(replay.statusCode).toBe(200);
      expect(replay.headers['idempotent-replayed']).toBe('true');
      expect(replay.json<Job>()).toMatchObject({ id: first.id, status: 'succeeded' });
    });

    it('rejects an Idempotency-Key reused for a different request', async () => {
      const key = randomUUID();
      const input = freshInput();
      await recordSuccess(input);
      await runTask('summarize-declaration', taskRequest(input), { key });

      const reused = await runTask('summarize-declaration', taskRequest(freshInput()), { key });

      expect(reused.statusCode).toBe(422);
      expect(reused.json()).toMatchObject({ type: 'idempotency-key-reused' });
    });

    it('requires an Idempotency-Key', async () => {
      const response = await t.app.inject({
        method: 'POST',
        url: '/internal/v1/tasks/summarize-declaration',
        headers: auth,
        payload: taskRequest(freshInput()),
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ type: 'idempotency-key-missing' });
    });

    it('creates one job for concurrent equal requests', async () => {
      const input = freshInput();
      await recordSuccess(input);

      const responses = await Promise.all(
        Array.from({ length: 5 }, () => runTask('summarize-declaration', taskRequest(input))),
      );

      const ids = new Set(responses.map((response) => response.json<Job>().id));
      expect(responses.map((response) => response.statusCode)).not.toContain(500);
      expect(ids.size).toBe(1);
    });

    it('keeps cached jobs apart per subject and data class', async () => {
      const input = freshInput();
      await recordSuccess(input);
      const first = (await runTask('summarize-declaration', taskRequest(input))).json<Job>();

      const otherSubject = await runTask(
        'summarize-declaration',
        taskRequest(input, { subjectRef: 'review-case:0199a8f0-4444-7000-8000-000000000004' }),
      );
      const otherClass = await runTask(
        'summarize-declaration',
        taskRequest(input, { dataClass: 'restricted' }),
      );

      expect(otherSubject.json<Job>().id).not.toBe(first.id);
      expect(otherClass.json<Job>().id).not.toBe(first.id);
    });

    it('runs a new job for an input whose last job failed', async () => {
      const input = freshInput();
      const failed = (await runTask('summarize-declaration', taskRequest(input))).json<Job>();
      expect(await untilFinished(failed.id)).toMatchObject({ status: 'failed' });
      await recordSuccess(input);

      const retried = (await runTask('summarize-declaration', taskRequest(input))).json<Job>();

      expect(retried.id).not.toBe(failed.id);
      expect(await untilFinished(retried.id)).toMatchObject({ status: 'succeeded' });
    });
  });

  describe('waiting', () => {
    it('answers 200 with the finished job within waitSeconds', async () => {
      const input = freshInput();
      await recordSuccess(input);

      const response = await runTask(
        'summarize-declaration',
        taskRequest(input, { waitSeconds: 10 }),
      );

      expect(response.statusCode).toBe(200);
      expect(response.json<Job>()).toMatchObject({ status: 'succeeded' });
    });
  });

  describe('outcomes', () => {
    it('fails with reason validation when the output does not match the task schema', async () => {
      const input = freshInput();
      await t.record('summarize-declaration', input, {
        status: 'completed',
        model: 'claude-opus-5-5',
        output: { ...summarizeOutput, overview: 'x'.repeat(1201) },
        usage,
      });

      const { id } = (await runTask('summarize-declaration', taskRequest(input))).json<Job>();
      const job = await untilFinished(id);

      expect(job).toMatchObject({ status: 'failed', reason: 'validation', output: null });
      expect(job.outputHash).toBeNull();
      expect(contractErrors('Job', job)).toEqual([]);
      const [event] = (await t.db.select().from(outbox)).filter(
        (row) => row.envelope.subject === id,
      );
      expect(event?.envelope).toMatchObject({
        type: 'ai.job.failed.v1',
        data: { jobId: id, reason: 'validation', outputHash: null },
      });
    });

    it('fails with reason refused when the model declines', async () => {
      const input = freshInput();
      await t.record('summarize-declaration', input, {
        status: 'refused',
        model: 'claude-opus-5-5',
        refusal: { category: 'cyber', explanation: null },
        usage,
      });

      const { id } = (await runTask('summarize-declaration', taskRequest(input))).json<Job>();

      expect(await untilFinished(id)).toMatchObject({
        status: 'failed',
        reason: 'refused',
        usage: { tokensIn: 1200, tokensOut: 300 },
      });
    });

    it('fails with reason provider when no recorded response exists', async () => {
      const { id } = (
        await runTask('summarize-declaration', taskRequest(freshInput()))
      ).json<Job>();

      expect(await untilFinished(id)).toMatchObject({ status: 'failed', reason: 'provider' });
    });

    it('labels the output in the requested language', async () => {
      await t.record('explain-flags', explainInput, {
        status: 'completed',
        model: 'claude-opus-5-5',
        output: {
          explanations: [
            {
              flagId: FLAG_ID,
              meaning: 'Thamani ya kiwanja imepanda kwa asilimia 41.',
              whatToCheck: ['Linganisha na rekodi za ArdhiSasa.'],
              typicalResolution: 'Hati ya uthamini.',
              refs: [],
            },
          ],
        },
        usage,
      });

      const { id } = (await runTask('explain-flags', taskRequest(explainInput))).json<Job>();
      const job = await untilFinished(id);

      expect(job).toMatchObject({ status: 'succeeded', task: 'explain-flags' });
      expect((job.output?.label as { disclaimer: string }).disclaimer).toMatch(
        /^Imesaidiwa na AI\. Hivi ni viashiria, si matokeo/,
      );
      expect(contractErrors('Job', job)).toEqual([]);
    });

    it('keeps the input only while the job runs', async () => {
      const input = freshInput();
      await recordSuccess(input);
      const { id } = (await runTask('summarize-declaration', taskRequest(input))).json<Job>();
      await untilFinished(id);

      const [row] = await t.db.select().from(jobs).where(eq(jobs.id, id));

      expect(row?.input).toBeNull();
    });
  });

  describe('requests', () => {
    it('answers 404 for a task the gateway does not serve', async () => {
      const response = await runTask('extract-document', taskRequest(summarizeInput));

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ type: 'task-not-found' });
    });

    it('rejects an input that does not match the task', async () => {
      const response = await runTask('explain-flags', taskRequest(summarizeInput));

      expect(response.statusCode).toBe(400);
      expect(response.headers['content-type']).toContain('application/problem+json');
    });

    it('rejects an unknown prompt version', async () => {
      const response = await runTask(
        'summarize-declaration',
        taskRequest(freshInput(), { promptVersion: 99 }),
      );

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ type: 'prompt-version-unknown' });
    });
  });

  describe('access', () => {
    it('hides a job from other callers', async () => {
      const { id } = (
        await runTask('summarize-declaration', taskRequest(freshInput()))
      ).json<Job>();
      const other = { authorization: `Bearer ${await t.token({ clientId: 'reporting' })}` };

      expect((await getJob(id, other)).statusCode).toBe(404);
    });

    it('refuses callers without the ai scope', async () => {
      const unscoped = { authorization: `Bearer ${await t.token({ scope: 'profile' })}` };

      const response = await runTask('summarize-declaration', taskRequest(freshInput()), {
        headers: unscoped,
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('janitor', () => {
    it('starts a job whose workflow start was lost', async () => {
      await recordSuccess(summarizeInput);
      // As if the process died between committing the job and starting its workflow.
      const id = randomUUID();
      await t.db.insert(jobs).values({
        id,
        tenant: 'demo',
        task: 'summarize-declaration',
        promptVersion: 1,
        dataClass: 'synthetic',
        subjectRef: 'review-case:0199a8f0-6666-7000-8000-000000000006',
        caller: 'review',
        idempotencyKey: randomUUID(),
        requestHash: 'stranded',
        inputHash: 'stranded',
        input: summarizeInput,
        status: 'queued',
        provider: 'replay',
        model: 'claude-opus-5-5',
        createdAt: new Date(Date.now() - 5 * 60_000),
      });

      await t.app.get(JobsJanitor).sweep();

      expect(await untilFinished(id)).toMatchObject({ status: 'succeeded' });
    });

    it('purges outputs past retention, which then no longer serve the cache', async () => {
      const input = freshInput();
      await recordSuccess(input);
      const first = (await runTask('summarize-declaration', taskRequest(input))).json<Job>();
      await untilFinished(first.id);
      await t.db
        .update(jobs)
        .set({ finishedAt: sql`now() - interval '31 days'` })
        .where(eq(jobs.id, first.id));

      await t.app.get(JobsJanitor).sweep();

      const purged = (await getJob(first.id)).json<Job>();
      expect(purged).toMatchObject({ status: 'succeeded', output: null });
      expect(purged.outputHash).toMatch(/^[0-9a-f]{64}$/);
      const again = (await runTask('summarize-declaration', taskRequest(input))).json<Job>();
      expect(again.id).not.toBe(first.id);
    });
  });
});
