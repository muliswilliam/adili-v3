import { randomUUID } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { jobs } from '../../src/db/schema.js';
import { JobExecutor, ResultNotRecordedError } from '../../src/jobs/job-executor.js';
import { summarizeInput, summarizeOutput, usage } from '../support/inputs.js';
import { ScriptedProvider } from '../support/scripted-provider.js';
import { createTestApp, type TestApp } from '../support/test-app.js';

/**
 * A provider result the database refuses to record: the executor gives up before its attempt
 * deadline, having called the provider once, so the workflow fails the job rather than paying
 * for a second call.
 */
describe('a result that cannot be recorded', () => {
  const provider = new ScriptedProvider(() =>
    Promise.resolve({
      status: 'completed',
      model: 'claude-opus-5-5',
      output: summarizeOutput,
      usage,
    }),
  );
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ provider });
    // Stands in for a database that keeps failing the final write.
    await t.db.execute(sql`
      create function refuse_success() returns trigger language plpgsql as $$
      begin
        if new.status = 'succeeded' and new.subject_ref like '%:hang' then perform pg_sleep(60); end if;
        if new.status = 'succeeded' then raise exception 'injected write failure'; end if;
        return new;
      end $$`);
    await t.db.execute(sql`
      create trigger refuse_success before update on jobs
      for each row execute function refuse_success()`);
  });

  afterAll(async () => {
    await t.close();
  });

  async function queuedJob(subjectRef: string) {
    const id = randomUUID();
    await t.db.insert(jobs).values({
      id,
      tenant: 'demo',
      task: 'summarize-declaration',
      promptVersion: 1,
      dataClass: 'synthetic',
      subjectRef,
      caller: 'review',
      idempotencyKey: randomUUID(),
      requestHash: 'unrecorded',
      inputHash: 'unrecorded',
      input: summarizeInput,
      status: 'queued',
      provider: 'scripted',
      model: 'claude-opus-5-5',
    });
    return id;
  }

  it.each([
    ['keeps failing', 'review-case:fails'],
    ['hangs', 'review-case:hang'],
  ])(
    'calls the provider once, then gives up before the deadline when the write %s',
    async (_, subjectRef) => {
      const id = await queuedJob(subjectRef);
      const calls = provider.requests.length;
      const deadline = Date.now() + 8_000;

      const execution = t.app.get(JobExecutor).execute(id, deadline);

      await expect(execution).rejects.toBeInstanceOf(ResultNotRecordedError);
      expect(Date.now()).toBeLessThanOrEqual(deadline);
      expect(provider.requests.length).toBe(calls + 1);
      const [job] = await t.db.select().from(jobs).where(eq(jobs.id, id));
      expect(job?.status).toBe('running');
    },
  );
});
