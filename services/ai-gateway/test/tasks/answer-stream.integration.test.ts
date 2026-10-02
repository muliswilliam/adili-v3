import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import { auditRecords, jobs } from '../../src/db/schema.js';
import { Budgets } from '../../src/policy/budgets.js';
import { ProviderError } from '../../src/providers/port.js';
import type { AnswerInput } from '../../src/tasks/answer-declarant-question.js';
import { contractErrors } from '../support/contract.js';
import { actingFor, answerInput, hintsInput } from '../support/inputs.js';
import { ScriptedStreamProvider, type StreamScript } from '../support/scripted-provider.js';
import { createTestApp, type TestApp } from '../support/test-app.js';

interface Job {
  id: string;
  status: string;
  reason: string | null;
  output: Record<string, unknown> | null;
  [key: string]: unknown;
}

type Frame =
  | { event: 'delta'; data: { text: string } }
  | { event: 'final'; data: { job: Job } }
  | { event: 'error'; data: { reason: string } };

/** The events of an SSE body, comments (heartbeats) skipped. */
function frames(body: string): Frame[] {
  return body
    .split('\n\n')
    .filter((chunk) => chunk.trim() !== '' && !chunk.startsWith(':'))
    .map((chunk) => {
      const event = /^event: (.+)$/m.exec(chunk)?.[1];
      const data = /^data: (.+)$/m.exec(chunk)?.[1];
      return { event, data: JSON.parse(data ?? 'null') as unknown } as Frame;
    });
}

const prose = (all: Frame[]) =>
  all.flatMap((frame) => (frame.event === 'delta' ? [frame.data.text] : [])).join('');
const finalJob = (all: Frame[]) => {
  const last = all.at(-1);
  if (last?.event !== 'final') throw new Error(`Ended with ${JSON.stringify(last)}`);
  return last.data.job;
};

const ANSWER = [
  '<block>Yes. Joint assets should be declared',
  ', including a vehicle you co-own. <cite ids="p-note-13"/>',
  ' <link section="statement:officer" field="/assets"/></block>',
  '<followup>How do I show my share?</followup>',
];

const answered = (chunks = ANSWER): StreamScript => ({ chunks, end: { status: 'completed' } });

/**
 * Ask Adili's answers over the stream endpoint (spec 11 S2-S4, S11): the blocks' prose as SSE
 * deltas, then the job with the validated answer; an answer that cites what the input does not
 * hold, or breaks the grammar, is replaced by a decline recorded with why.
 */
describe('answer-declarant-question stream', { timeout: 90_000 }, () => {
  const provider = new ScriptedStreamProvider('external');
  let t: TestApp;
  let auth: { authorization: string };

  beforeAll(async () => {
    t = await createTestApp({ provider });
    await t.seedDemoGate('demo');
    auth = { authorization: `Bearer ${await t.token({ clientId: 'declarations' })}` };
    return () => t.close();
  });

  const request = (
    input: AnswerInput,
    key: string = randomUUID(),
    subjectRef = `conversation:${randomUUID()}`,
  ) => ({
    method: 'POST' as const,
    url: '/internal/v1/tasks/answer-declarant-question/stream',
    headers: { ...auth, ...actingFor('demo'), 'idempotency-key': key },
    payload: { dataClass: 'synthetic' as const, subjectRef, input },
  });

  const stream = async (input: AnswerInput = answerInput, key?: string, subjectRef?: string) => {
    const response = await t.app.inject(request(input, key, subjectRef));
    return { response, frames: frames(response.body) };
  };

  const row = async (id: string) => (await t.db.select().from(jobs).where(eq(jobs.id, id)))[0];

  it('streams the prose, then the job with the validated answer', async () => {
    provider.scripts = [answered()];

    const { response, frames: all } = await stream();

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^text\/event-stream/);
    expect(prose(all)).toBe(
      'Yes. Joint assets should be declared, including a vehicle you co-own.',
    );
    const job = finalJob(all);
    expect(job).toMatchObject({
      status: 'succeeded',
      task: 'answer-declarant-question',
      output: {
        declined: false,
        blocks: [
          {
            text: 'Yes. Joint assets should be declared, including a vehicle you co-own.',
            passageIds: ['p-note-13'],
            sectionLink: { sectionKey: 'statement:officer', fieldPath: '/assets' },
          },
        ],
        followUps: ['How do I show my share?'],
        label: { disclaimer: expect.stringMatching(/not legal advice/i) as string },
      },
    });
    expect(contractErrors('Job', job)).toEqual([]);
    expect(await row(job.id)).toMatchObject({ status: 'succeeded', input: null, tokensOut: 120 });
  });

  it('asks the provider for tagged text with the input as untrusted data, minimised', async () => {
    provider.scripts = [answered()];
    const question = 'My ID is 12345678. Do I declare a matatu I co-own?';

    await stream({ ...answerInput, question });

    const sent = provider.requests.at(-1);
    expect(sent).not.toHaveProperty('schema');
    expect(sent?.system).toContain('<cite ids=');
    const content = sent?.messages[0]?.content as string;
    expect(content).toContain('<untrusted-input>');
    expect(content).not.toContain('12345678');
  });

  it('answers in Swahili with the Swahili label, citations unchanged', async () => {
    provider.scripts = [
      answered([
        '<block>Ndiyo. Mali ya pamoja inapaswa kutangazwa. <cite ids="p-note-13"/></block>',
      ]),
    ];

    const job = finalJob((await stream({ ...answerInput, language: 'sw' })).frames);

    expect(job.output).toMatchObject({
      blocks: [{ passageIds: ['p-note-13'] }],
      label: { disclaimer: expect.stringMatching(/si ushauri wa kisheria/i) as string },
    });
  });

  it('replaces an answer citing a passage the input does not hold with a decline, recording why', async () => {
    provider.scripts = [
      answered([
        '<block>Declare it. <cite ids="p-note-13"/></block><block>Also this. <cite ids="p-77"/></block>',
      ]),
    ];

    const { frames: all } = await stream();

    expect(prose(all)).toBe('Declare it.\n\nAlso this.');
    const job = finalJob(all);
    expect(job).toMatchObject({
      status: 'succeeded',
      output: { declined: true, blocks: [], followUps: [] },
    });
    expect(contractErrors('Job', job)).toEqual([]);
    const violations = [{ kind: 'unknown-passage', block: 1 }];
    expect((await row(job.id))?.violations).toEqual(violations);
    const [audit] = await t.db.select().from(auditRecords).where(eq(auditRecords.jobId, job.id));
    expect(audit).toMatchObject({ outcome: 'succeeded', violations });
    expect(JSON.stringify(audit)).not.toContain('p-77');
  });

  it('declines text that breaks the grammar, and a cut-off answer', async () => {
    provider.scripts = [answered(['Sure! Here is the answer: you must declare it.'])];
    const broken = finalJob((await stream()).frames);
    expect(broken.output).toMatchObject({ declined: true, blocks: [] });
    expect((await row(broken.id))?.violations).toContainEqual({ kind: 'text-outside-block' });

    provider.scripts = [{ chunks: ['<block>Joint assets should'], end: { status: 'truncated' } }];
    const cut = finalJob((await stream()).frames);
    expect(cut.output).toMatchObject({ declined: true, blocks: [] });
    expect((await row(cut.id))?.violations).toEqual([{ kind: 'truncated' }]);
  });

  it('stores at most twenty violations of a declined answer', async () => {
    provider.scripts = [
      answered(Array.from({ length: 30 }, (_, i) => `<block>Point ${i}.</block>`)),
    ];

    const job = finalJob((await stream()).frames);

    expect(job.output).toMatchObject({ declined: true, blocks: [] });
    const violations = (await row(job.id))?.violations;
    expect(violations).toHaveLength(20);
    expect(violations?.[19]).toEqual({ kind: 'uncited-block', block: 19 });
    const [audit] = await t.db.select().from(auditRecords).where(eq(auditRecords.jobId, job.id));
    expect(audit?.violations).toEqual(violations);
  });

  it('passes a decline through without streaming anything', async () => {
    provider.scripts = [answered(['<declined/>'])];

    const { frames: all } = await stream();

    expect(all.map((frame) => frame.event)).toEqual(['final']);
    expect(finalJob(all).output).toMatchObject({ declined: true, blocks: [], followUps: [] });
  });

  it('ends with an error frame when the model refuses', async () => {
    provider.scripts = [{ chunks: [], end: { status: 'refused' } }];

    const { frames: all } = await stream();

    expect(all).toEqual([{ event: 'error', data: { reason: 'refused' } }]);
    const [job] = await t.db.select().from(jobs).where(eq(jobs.status, 'failed'));
    expect(job?.reason).toBe('refused');
  });

  it('retries a transient provider failure before anything streamed', async () => {
    const unavailable = new ProviderError('unavailable', 'scripted', 'overloaded');
    provider.scripts = [{ chunks: [], end: { error: unavailable } }, answered()];
    const calls = provider.requests.length;

    const { frames: all } = await stream();

    expect(finalJob(all).status).toBe('succeeded');
    expect(provider.requests.length - calls).toBe(2);
  });

  it('fails with an error frame when the provider fails mid-stream, without retrying', async () => {
    const unavailable = new ProviderError('unavailable', 'scripted', 'connection reset');
    provider.scripts = [{ chunks: ANSWER.slice(0, 2), end: { error: unavailable } }];
    const calls = provider.requests.length;
    const key = randomUUID();

    const { frames: all } = await stream(answerInput, key);

    expect(all.at(-1)).toEqual({ event: 'error', data: { reason: 'provider' } });
    expect(prose(all)).not.toBe('');
    expect(provider.requests.length - calls).toBe(1);
    const [job] = await t.db.select().from(jobs).where(eq(jobs.idempotencyKey, key));
    // No final result, so no usage from the provider: the job is charged an estimate.
    expect(job).toMatchObject({ status: 'failed', reason: 'provider' });
    expect(job?.tokensIn).toBeGreaterThan(0);
    expect(job?.tokensOut).toBeGreaterThan(0);
    expect(job?.costMicros).toBeGreaterThan(0);
  });

  it('declines streamed text holding a token the input never had, mid-stream', async () => {
    provider.scripts = [
      answered([
        '<block>Declare the matatu [[PERSON_9]] ',
        'co-owns. <cite ids="p-note-13"/></block>',
        '<followup>How do I show my share?</followup>',
      ]),
    ];

    const { frames: all } = await stream();

    expect(prose(all)).not.toContain('[[PERSON_9]]');
    const job = finalJob(all);
    expect(job).toMatchObject({
      status: 'succeeded',
      output: { declined: true, blocks: [], followUps: [] },
    });
    expect(await row(job.id)).toMatchObject({
      violations: [{ kind: 'unknown-token' }],
      tokensIn: expect.any(Number) as number,
    });
  });

  it('serves an equal request from the cache as one delta and the cached job', async () => {
    provider.scripts = [answered()];
    const subjectRef = `conversation:${randomUUID()}`;
    const first = await t.app.inject(request(answerInput, randomUUID(), subjectRef));
    const calls = provider.requests.length;

    const again = frames((await t.app.inject(request(answerInput, randomUUID(), subjectRef))).body);

    expect(provider.requests).toHaveLength(calls);
    expect(again.map((frame) => frame.event)).toEqual(['delta', 'final']);
    expect(prose(again)).toBe(prose(frames(first.body)));
    expect(finalJob(again).id).toBe(finalJob(frames(first.body)).id);
  });

  it('calls the provider again for an equal request after an answer that failed its checks', async () => {
    provider.scripts = [answered(['Sure! Here is the answer: you must declare it.']), answered()];
    const subjectRef = `conversation:${randomUUID()}`;
    const declined = finalJob((await stream(answerInput, randomUUID(), subjectRef)).frames);
    expect(declined.output).toMatchObject({ declined: true });
    const calls = provider.requests.length;

    const again = finalJob((await stream(answerInput, randomUUID(), subjectRef)).frames);

    expect(provider.requests.length - calls).toBe(1);
    expect(again.id).not.toBe(declined.id);
    expect(again).toMatchObject({ status: 'succeeded', output: { declined: false } });
  });

  describe('idempotency', () => {
    it('answers a finished key with its final frame only, and a reused key with 422', async () => {
      provider.scripts = [answered()];
      const key = randomUUID();
      const subjectRef = `conversation:${randomUUID()}`;
      const first = finalJob((await stream(answerInput, key, subjectRef)).frames);

      const replay = await stream(answerInput, key, subjectRef);
      expect(replay.frames).toEqual([{ event: 'final', data: { job: first } }]);

      const reused = await stream({ ...answerInput, question: 'Something else?' }, key, subjectRef);
      expect(reused.response.statusCode).toBe(422);
    });

    it('refuses a key whose stream is still running with 409', async () => {
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let started: () => void = () => undefined;
      const streaming = new Promise<void>((resolve) => {
        started = resolve;
      });
      provider.scripts = [
        {
          ...answered(),
          beforeChunk: async (index) => {
            if (index !== 1) return;
            started();
            await held;
          },
        },
      ];
      const key = randomUUID();
      const subjectRef = `conversation:${randomUUID()}`;
      const running = t.app.inject(request(answerInput, key, subjectRef));
      await streaming;

      try {
        const second = await t.app.inject(request(answerInput, key, subjectRef));

        expect(second.statusCode).toBe(409);
        expect(second.json()).toMatchObject({ type: 'job-in-progress' });
      } finally {
        release();
      }
      expect(finalJob(frames((await running).body)).status).toBe('succeeded');
    });
  });

  describe('refused before the stream opens', () => {
    it('refuses hints, which run as jobs', async () => {
      const { response } = await stream(hintsInput);

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ type: 'task-not-streamed' });
    });

    it('refuses an invalid request', async () => {
      const { response } = await stream({ ...answerInput, question: null });

      expect(response.statusCode).toBe(400);
    });

    it('refuses a tenant the classification gate blocks, recording the blocked job', async () => {
      const response = await t.app.inject({
        ...request(answerInput),
        headers: { ...auth, ...actingFor('kcomm'), 'idempotency-key': randomUUID() },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ type: 'task-blocked', reason: 'policy' });
      const [job] = await t.db.select().from(jobs).where(eq(jobs.tenant, 'kcomm'));
      expect(job).toMatchObject({ status: 'blocked', reason: 'policy' });
    });
  });

  it('fails the job when the caller disconnects mid-stream, charging an estimate', async () => {
    let started: () => void = () => undefined;
    const streaming = new Promise<void>((resolve) => {
      started = resolve;
    });
    provider.scripts = [
      {
        ...answered(),
        beforeChunk: async (index) => {
          if (index !== 1) return;
          started();
          await new Promise((resolve) => setTimeout(resolve, 2_000));
        },
      },
    ];
    const budgets = t.app.get(Budgets);
    const before = await budgets.usage('demo');
    await t.app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = t.app.getHttpServer().address() as AddressInfo;
    const caller = new AbortController();
    const key = randomUUID();
    const response = await fetch(
      `http://127.0.0.1:${port}/internal/v1/tasks/answer-declarant-question/stream`,
      {
        method: 'POST',
        headers: {
          ...auth,
          ...actingFor('demo'),
          'idempotency-key': key,
          'content-type': 'application/json',
        },
        body: JSON.stringify(request(answerInput, key).payload),
        signal: caller.signal,
      },
    );
    expect(response.status).toBe(200);
    await streaming;

    caller.abort();

    await expect
      .poll(
        async () => {
          const [job] = await t.db.select().from(jobs).where(eq(jobs.idempotencyKey, key));
          return job && { status: job.status, reason: job.reason };
        },
        { timeout: 10_000 },
      )
      .toEqual({ status: 'failed', reason: 'provider' });
    // The call is paid for without a final result: charged an estimate, which the budget counts.
    const [job] = await t.db.select().from(jobs).where(eq(jobs.idempotencyKey, key));
    expect(job?.tokensIn).toBeGreaterThan(0);
    expect(job?.tokensOut).toBeGreaterThan(0);
    expect(job?.costMicros).toBeGreaterThan(0);
    const after = await budgets.usage('demo');
    expect(after.tokensUsed - before.tokensUsed).toBe((job?.tokensIn ?? 0) + (job?.tokensOut ?? 0));
    expect(after.costMicros - before.costMicros).toBe(job?.costMicros);
    // The only test on a real socket: the app closes once it is gone.
    t.app.getHttpServer().closeAllConnections();
  });
});
