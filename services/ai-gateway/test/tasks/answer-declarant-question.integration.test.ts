import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import { jobs } from '../../src/db/schema.js';
import type { StructuredResult } from '../../src/providers/port.js';
import type { AnswerInput, AnswerOutput } from '../../src/tasks/answer-declarant-question.js';
import { contractErrors } from '../support/contract.js';
import { actingFor, answerInput, hintsInput, usage } from '../support/inputs.js';
import { ScriptedProvider } from '../support/scripted-provider.js';
import { createTestApp, type TestApp } from '../support/test-app.js';

interface Job {
  id: string;
  status: string;
  reason: string | null;
  output: Record<string, unknown> | null;
  [key: string]: unknown;
}

const hints: AnswerOutput = {
  declined: false,
  blocks: hintsInput.context.residuals.map((residual) => ({
    text: 'Add it, or tick the box that says there is none.',
    passageIds: [],
    sectionLink: { sectionKey: residual.sectionKey, fieldPath: residual.fieldPath },
  })),
  followUps: [],
};

/**
 * Summary hints through the job endpoint (spec 11 S5): one hint per residual, labelled as help
 * rather than a reviewer's indicator; a hint set that misses a residual fails validation. An
 * answer to a question streams, so the job endpoint refuses it.
 */
describe('answer-declarant-question jobs', { timeout: 90_000 }, () => {
  let answer: AnswerOutput = hints;
  const provider = new ScriptedProvider(
    (): Promise<StructuredResult> =>
      Promise.resolve({ status: 'completed', model: 'claude-opus-5-5', output: answer, usage }),
    'external',
  );
  let t: TestApp;
  let auth: { authorization: string };

  beforeAll(async () => {
    t = await createTestApp({ provider });
    await t.seedDemoGate('demo');
    auth = { authorization: `Bearer ${await t.token({ clientId: 'declarations' })}` };
    return () => t.close();
  });

  const post = (input: AnswerInput) =>
    t.app.inject({
      method: 'POST',
      url: '/internal/v1/tasks/answer-declarant-question',
      headers: { ...auth, ...actingFor('demo'), 'idempotency-key': randomUUID() },
      payload: {
        dataClass: 'synthetic',
        subjectRef: `declaration:${randomUUID()}`,
        waitSeconds: 10,
        input,
      },
    });

  it('returns one hint per residual, labelled not legal advice', async () => {
    answer = hints;

    const response = await post(hintsInput);

    expect(response.statusCode).toBe(200);
    const job = response.json<Job>();
    expect(job).toMatchObject({ status: 'succeeded', output: hints });
    expect(job.output?.label).toMatchObject({
      task: 'answer-declarant-question',
      disclaimer: expect.stringMatching(/not legal advice/i) as string,
    });
    expect(contractErrors('Job', job)).toEqual([]);
  });

  it('fails a hint set that leaves a residual out, recording why', async () => {
    answer = { ...hints, blocks: hints.blocks.slice(1) };

    const job = (await post(hintsInput)).json<Job>();

    expect(job).toMatchObject({ status: 'failed', reason: 'validation', output: null });
    const [row] = await t.db.select().from(jobs).where(eq(jobs.id, job.id));
    expect(row?.violations).toContainEqual({ kind: 'hint-count', expected: 3, found: 2 });
  });

  it('refuses a question, which streams, before any provider call', async () => {
    const calls = provider.requests.length;

    const response = await post(answerInput);

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ type: 'task-streamed' });
    expect(provider.requests).toHaveLength(calls);
  });
});
