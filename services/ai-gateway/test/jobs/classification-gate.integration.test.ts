import { randomUUID } from 'node:crypto';

import { outbox } from '@adili/events';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { contractErrors } from '../support/contract.js';
import { summarizeInput, summarizeOutput, taskRequest, usage } from '../support/inputs.js';
import { ScriptedProvider } from '../support/scripted-provider.js';
import { createTestApp, type TestApp } from '../support/test-app.js';

interface Job {
  id: string;
  status: string;
  [key: string]: unknown;
}

/** The default gate with an external provider (spec 07c S2): only synthetic data reaches it. */
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
    auth = { authorization: `Bearer ${await t.token()}` };
  });

  afterAll(async () => {
    await t.close();
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

  it('lets synthetic data through to an external provider', async () => {
    const response = await runTask(taskRequest(summarizeInput, { waitSeconds: 10 }));

    expect(response.json<Job>()).toMatchObject({ status: 'succeeded' });
  });
});
