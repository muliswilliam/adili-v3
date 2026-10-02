import { randomUUID } from 'node:crypto';

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { StructuredResult } from '../../src/providers/port.js';
import { contractErrors } from '../support/contract.js';
import { explainInput, taskCall, taskRequest, usage } from '../support/inputs.js';
import { ScriptedProvider } from '../support/scripted-provider.js';
import { createTestApp, type TestApp } from '../support/test-app.js';

interface Job {
  id: string;
  status: string;
  output: { items: { text: string }[] } | null;
}

const ref = explainInput.itemContext[0]?.ref;

/** A Swahili draft for the item the flag concerns (spec 07c S12). */
const draftInput = {
  kind: 'draft-clarification',
  commissionName: 'Public Service Commission',
  language: 'sw',
  selections: [
    {
      ref,
      flag: explainInput.flags[0],
      itemContext: explainInput.itemContext[0]?.context,
      requirement: 'explain-discrepancy',
    },
  ],
};

const draftOutput = {
  opening: null,
  items: [{ ref, requirement: 'explain-discrepancy', text: 'Eleza ongezeko la thamani.' }],
};

/**
 * `waitSeconds` on a task call (spec 07c S12, the review service's drafts): the job as it ended
 * within the wait (200), or as it is when the wait ran out (202), which the caller then polls or
 * asks again for with the same key.
 */
describe('waiting for a task', () => {
  let release: () => void = () => undefined;
  let held = false;
  const provider = new ScriptedProvider(async (): Promise<StructuredResult> => {
    if (held) await new Promise<void>((resolve) => (release = resolve));
    return { status: 'completed', model: 'claude-opus-5-5', output: draftOutput, usage };
  });
  let t: TestApp;
  let auth: { authorization: string };

  beforeAll(async () => {
    t = await createTestApp({ provider });
    auth = { authorization: `Bearer ${await t.token()}` };
    return () => t.close();
  });

  afterEach(() => {
    held = false;
    release();
  });

  const runTask = (payload: object, key = randomUUID()) => {
    const call = taskCall(payload);
    return t.app.inject({
      method: 'POST',
      url: '/internal/v1/tasks/draft-clarification',
      headers: { ...auth, ...call.headers, 'idempotency-key': key },
      payload: call.body,
    });
  };

  it('answers 200 with the draft when the job ends within the wait', async () => {
    const response = await runTask(taskRequest(draftInput, { waitSeconds: 30 }));

    expect(response.statusCode).toBe(200);
    const job = response.json<Job>();
    expect(job).toMatchObject({ status: 'succeeded' });
    expect(job.output?.items).toEqual([
      expect.objectContaining({ text: 'Eleza ongezeko la thamani.' }),
    ]);
    expect(contractErrors('Job', job)).toEqual([]);
  });

  it('answers 202 with the live job once the wait runs out; asking again with the key waits for its end', async () => {
    held = true;
    const key = randomUUID();
    // Another case's draft: not the first test's cached job.
    const subjectRef = `review-case:${randomUUID()}`;
    const started = Date.now();

    const response = await runTask(taskRequest(draftInput, { subjectRef, waitSeconds: 1 }), key);

    expect(response.statusCode).toBe(202);
    expect(Date.now() - started).toBeGreaterThanOrEqual(1_000);
    const live = response.json<Job>();
    expect(['queued', 'running']).toContain(live.status);
    expect(live.output).toBeNull();
    expect(contractErrors('Job', live)).toEqual([]);

    release();
    const again = await runTask(taskRequest(draftInput, { subjectRef, waitSeconds: 30 }), key);
    expect(again.statusCode).toBe(200);
    expect(again.json<Job>()).toMatchObject({ id: live.id, status: 'succeeded' });
  });
});
