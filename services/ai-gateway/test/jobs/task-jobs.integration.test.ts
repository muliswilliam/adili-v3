import { randomUUID } from 'node:crypto';

import { outbox } from '@adili/events';
import { eq, inArray, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import { jobs } from '../../src/db/schema.js';
import { JobExecutor } from '../../src/jobs/job-executor.js';
import { JobWorkflows } from '../../src/jobs/job-workflows.js';
import { JobsJanitor } from '../../src/jobs/jobs-janitor.js';
import { contractErrors } from '../support/contract.js';
import {
  actingFor,
  explainInput,
  FLAG_ID,
  summarizeInput,
  summarizeOutput,
  taskCall,
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
    // The replay adapter stands in for an external provider: the demo tenant's rule lets it run.
    await t.seedDemoGate('demo');
    auth = { authorization: `Bearer ${await t.token()}` };
    return () => t.close();
  });

  const runTask = (
    task: string,
    payload: object,
    { key = randomUUID(), headers = auth }: { key?: string; headers?: Record<string, string> } = {},
  ) => {
    const call = taskCall(payload);
    return t.app.inject({
      method: 'POST',
      url: `/internal/v1/tasks/${task}`,
      headers: { ...call.headers, ...headers, 'idempotency-key': key },
      payload: call.body,
    });
  };

  const getJob = (id: string, headers: Record<string, string> = auth, tenant = 'demo') =>
    t.app.inject({
      method: 'GET',
      url: `/internal/v1/jobs/${id}`,
      headers: { ...actingFor(tenant), ...headers },
    });

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
      const call = taskCall(taskRequest(freshInput()));
      const response = await t.app.inject({
        method: 'POST',
        url: '/internal/v1/tasks/summarize-declaration',
        headers: { ...auth, ...call.headers },
        payload: call.body,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ type: 'idempotency-key-missing' });
    });

    it('requires the Idempotency-Key to be a UUID', async () => {
      const response = await runTask('summarize-declaration', taskRequest(freshInput()), {
        key: 'review-case-42-v3',
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ type: 'idempotency-key-invalid' });
    });

    it('treats an Idempotency-Key in either case as the same key', async () => {
      const input = freshInput();
      await recordSuccess(input);
      const key = randomUUID();
      const first = (
        await runTask('summarize-declaration', taskRequest(input), { key })
      ).json<Job>();

      const replay = await runTask('summarize-declaration', taskRequest(input), {
        key: key.toUpperCase(),
      });

      expect(replay.headers['idempotent-replayed']).toBe('true');
      expect(replay.json<Job>().id).toBe(first.id);
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

    it('counts input served from the prompt cache as input tokens', async () => {
      const input = freshInput();
      await t.record('summarize-declaration', input, {
        status: 'completed',
        model: 'claude-opus-5-5',
        output: summarizeOutput,
        usage: { inputTokens: 200, outputTokens: 300, cacheReadTokens: 900, cacheWriteTokens: 100 },
      });

      const { id } = (await runTask('summarize-declaration', taskRequest(input))).json<Job>();

      expect(await untilFinished(id)).toMatchObject({ usage: { tokensIn: 1200, tokensOut: 300 } });
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

    it('rejects text containing a NUL character, which Postgres cannot store', async () => {
      const input = {
        ...summarizeInput,
        document: { ...summarizeInput.document, note: 'before\u0000after' },
      };

      const response = await runTask('summarize-declaration', taskRequest(input));

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        errors: [{ path: 'input', message: expect.stringContaining('NUL') as string }],
      });
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

    it('hides a job from the caller acting for another tenant (ADR-013)', async () => {
      const { id } = (
        await runTask('summarize-declaration', taskRequest(freshInput()))
      ).json<Job>();

      expect((await getJob(id, auth, 'kcomm')).statusCode).toBe(404);
    });

    it('takes the tenant from X-Acting-Tenant, not the body', async () => {
      const input = freshInput();
      await recordSuccess(input);
      const missing = await t.app.inject({
        method: 'POST',
        url: '/internal/v1/tasks/summarize-declaration',
        headers: { ...auth, 'idempotency-key': randomUUID() },
        payload: taskRequest(input),
      });
      expect(missing.statusCode).toBe(400);

      // The body's tenant is not the contract's and is ignored: the job is the header's.
      const response = await t.app.inject({
        method: 'POST',
        url: '/internal/v1/tasks/summarize-declaration',
        headers: { ...auth, ...actingFor('kcomm'), 'idempotency-key': randomUUID() },
        payload: taskRequest(input, { tenant: 'demo' }),
      });
      const [job] = await t.db
        .select({ tenant: jobs.tenant })
        .from(jobs)
        .where(eq(jobs.id, response.json<Job>().id));
      expect(job?.tenant).toBe('kcomm');
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
    /** A job left behind by a crash: committed, but its workflow never ran or is gone. */
    async function insertStranded(status: 'queued' | 'running') {
      const id = randomUUID();
      await t.db.insert(jobs).values({
        id,
        tenant: 'demo',
        task: 'summarize-declaration',
        promptVersion: 1,
        dataClass: 'synthetic',
        subjectRef: `review-case:${randomUUID()}`,
        caller: 'review',
        idempotencyKey: randomUUID(),
        requestHash: 'stranded',
        inputHash: 'stranded',
        input: summarizeInput,
        status,
        provider: 'replay',
        model: 'claude-opus-5-5',
        createdAt: new Date(Date.now() - 5 * 60_000),
      });
      return id;
    }

    it('starts a job whose workflow start was lost', async () => {
      await recordSuccess(summarizeInput);
      const id = await insertStranded('queued');

      await t.app.get(JobsJanitor).sweep();

      expect(await untilFinished(id)).toMatchObject({ status: 'succeeded' });
    });

    it('fails a running job whose workflow is gone, so it leaves the cache', async () => {
      const id = await insertStranded('running');

      await t.app.get(JobsJanitor).sweep();

      expect((await getJob(id)).json<Job>()).toMatchObject({
        status: 'failed',
        reason: 'provider',
      });
    });

    it('purges outputs past the 24 hour retention, which then no longer serve the cache', async () => {
      const input = freshInput();
      await recordSuccess(input);
      const first = (await runTask('summarize-declaration', taskRequest(input))).json<Job>();
      await untilFinished(first.id);
      await t.db
        .update(jobs)
        .set({ finishedAt: sql`now() - interval '25 hours'` })
        .where(eq(jobs.id, first.id));

      await t.app.get(JobsJanitor).sweep();

      const purged = (await getJob(first.id)).json<Job>();
      expect(purged).toMatchObject({ status: 'succeeded', output: null });
      expect(purged.outputHash).toMatch(/^[0-9a-f]{64}$/);
      const again = (await runTask('summarize-declaration', taskRequest(input))).json<Job>();
      expect(again.id).not.toBe(first.id);
    });

    it('purges a clarification draft after 24 hours even when the service keeps outputs longer', async () => {
      const finished = async (task: 'draft-clarification' | 'summarize-declaration') => {
        const id = randomUUID();
        await t.db.insert(jobs).values({
          id,
          tenant: 'demo',
          task,
          promptVersion: 1,
          dataClass: 'synthetic',
          subjectRef: `review-case:${randomUUID()}`,
          caller: 'review',
          idempotencyKey: randomUUID(),
          requestHash: 'finished',
          inputHash: randomUUID(),
          status: 'succeeded',
          provider: 'replay',
          model: 'claude-opus-5-5',
          output: { drafted: 'text' },
          outputHash: 'hash',
          finishedAt: sql`now() - interval '25 hours'`,
        });
        return id;
      };
      const draft = await finished('draft-clarification');
      const summary = await finished('summarize-declaration');

      // A service configured to keep outputs for 30 days still drops drafts after 24 hours.
      await new JobsJanitor(t.serviceDb, t.app.get(JobWorkflows), t.app.get(JobExecutor), {
        outputRetentionHours: 30 * 24,
      }).sweep();

      const outputs = await t.db
        .select({ id: jobs.id, output: jobs.output, purgedAt: jobs.outputPurgedAt })
        .from(jobs)
        .where(inArray(jobs.id, [draft, summary]));
      expect(outputs.find((row) => row.id === draft)).toMatchObject({
        output: null,
        purgedAt: expect.any(Date) as Date,
      });
      expect(outputs.find((row) => row.id === summary)).toMatchObject({
        output: { drafted: 'text' },
        purgedAt: null,
      });
    });
  });
});
