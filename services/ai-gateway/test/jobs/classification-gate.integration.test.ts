import { randomUUID } from 'node:crypto';

import { outbox } from '@adili/events';
import { beforeAll, describe, expect, it } from 'vitest';

import { jobs } from '../../src/db/schema.js';
import { JobsJanitor } from '../../src/jobs/jobs-janitor.js';
import { contractErrors } from '../support/contract.js';
import { summarizeInput, summarizeOutput, taskRequest, usage } from '../support/inputs.js';
import { ScriptedProvider } from '../support/scripted-provider.js';
import { createTestApp, type TestApp } from '../support/test-app.js';

interface Job {
  id: string;
  status: string;
  [key: string]: unknown;
}

/**
 * The gate with an external provider (spec 07c S2): by default it sees nothing; the demo tenant's
 * seeded rule lets synthetic data, and only that, reach it.
 */
describe('classification gate', () => {
  const external = new ScriptedProvider(
    () =>
      Promise.resolve({
        status: 'completed',
        model: 'claude-opus-5-5',
        output: summarizeOutput,
        usage,
      }),
    'external',
  );
  let t: TestApp;
  let auth: { authorization: string };

  beforeAll(async () => {
    t = await createTestApp({ provider: external });
    await t.seedDemoGate('demo');
    auth = { authorization: `Bearer ${await t.token()}` };
    return () => t.close();
  });

  const runTask = (payload: object) =>
    t.app.inject({
      method: 'POST',
      url: '/internal/v1/tasks/summarize-declaration',
      headers: { ...auth, 'idempotency-key': randomUUID() },
      payload,
    });

  it.each(['restricted', 'highly-confidential'])(
    'blocks %s data for an external provider without contacting it',
    async (dataClass) => {
      const before = external.requests.length;

      const response = await runTask(taskRequest(summarizeInput, { dataClass }));

      expect(response.statusCode).toBe(200);
      const job = response.json<Job>();
      expect(job).toMatchObject({ status: 'blocked', reason: 'policy', output: null });
      expect(contractErrors('Job', job)).toEqual([]);
      expect(external.requests.length).toBe(before);
      const [event] = (await t.db.select().from(outbox)).filter(
        (row) => row.envelope.subject === job.id,
      );
      expect(event?.envelope).toMatchObject({
        type: 'ai.job.blocked.v1',
        data: { jobId: job.id, reason: 'policy' },
      });
    },
  );

  it("lets the demo tenant's synthetic data through to an external provider", async () => {
    const response = await runTask(taskRequest(summarizeInput, { waitSeconds: 10 }));

    expect(response.json<Job>()).toMatchObject({ status: 'succeeded' });
  });

  it.each(['synthetic', 'restricted', 'highly-confidential'])(
    'blocks %s data for an external provider for a tenant without a rule',
    async (dataClass) => {
      const before = external.requests.length;

      const response = await runTask(
        taskRequest(summarizeInput, { tenant: 'newcomm', dataClass, waitSeconds: 10 }),
      );

      expect(response.json<Job>()).toMatchObject({ status: 'blocked', reason: 'policy' });
      expect(external.requests.length).toBe(before);
    },
  );

  it('blocks a queued job at execution when the gate no longer admits it', async () => {
    const before = external.requests.length;
    // Queued before the policy changed (or written by hand): the gate is checked again.
    const id = randomUUID();
    await t.db.insert(jobs).values({
      id,
      tenant: 'demo',
      task: 'summarize-declaration',
      promptVersion: 1,
      dataClass: 'restricted',
      subjectRef: `review-case:${randomUUID()}`,
      caller: 'review',
      idempotencyKey: randomUUID(),
      requestHash: 'queued',
      inputHash: 'queued',
      input: summarizeInput,
      status: 'queued',
      provider: 'scripted',
      model: 'claude-opus-5-5',
      createdAt: new Date(Date.now() - 5 * 60_000),
    });

    await t.app.get(JobsJanitor).sweep();

    const deadline = Date.now() + 20_000;
    let job: Job;
    do {
      await new Promise((resolve) => setTimeout(resolve, 100));
      job = (
        await t.app.inject({ method: 'GET', url: `/internal/v1/jobs/${id}`, headers: auth })
      ).json<Job>();
    } while (['queued', 'running'].includes(job.status) && Date.now() < deadline);
    expect(job).toMatchObject({ status: 'blocked', reason: 'policy' });
    expect(external.requests.length).toBe(before);
  });
});
