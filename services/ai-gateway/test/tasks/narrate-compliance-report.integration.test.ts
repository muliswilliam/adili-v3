import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import { auditRecords, jobs } from '../../src/db/schema.js';
import type { StructuredResult } from '../../src/providers/port.js';
import type { NarrateOutput } from '../../src/tasks/narrate-compliance-report.js';
import { contractErrors } from '../support/contract.js';
import { narrateInput, narrateOutput, usage } from '../support/inputs.js';
import { ScriptedProvider } from '../support/scripted-provider.js';
import { createTestApp, type TestApp } from '../support/test-app.js';

interface Job {
  id: string;
  status: string;
  reason: string | null;
  output: Record<string, unknown> | null;
  [key: string]: unknown;
}

/**
 * The narrative task through the internal API (spec 09b S2): a draft whose figures and citations
 * are all in the aggregates succeeds; one that states a figure the input does not hold fails
 * validation, storing no output and recording why on the job and its audit record.
 */
describe('narrate-compliance-report', { timeout: 90_000 }, () => {
  let answer: NarrateOutput = narrateOutput;
  const provider = new ScriptedProvider(
    (): Promise<StructuredResult> =>
      Promise.resolve({ status: 'completed', model: 'claude-opus-5-5', output: answer, usage }),
    'external',
  );
  let t: TestApp;
  let auth: { authorization: string };

  beforeAll(async () => {
    t = await createTestApp({ provider });
    // External providers see no tenant's data by default; synthetic data opens as in the demo.
    await t.seedDemoGate('eacc');
    auth = { authorization: `Bearer ${await t.token()}` };
    return () => t.close();
  });

  const run = async (): Promise<Job> => {
    const response = await t.app.inject({
      method: 'POST',
      url: '/internal/v1/tasks/narrate-compliance-report',
      headers: { ...auth, 'idempotency-key': randomUUID() },
      payload: {
        tenant: 'eacc',
        dataClass: 'synthetic',
        subjectRef: `ncr:${randomUUID()}`,
        waitSeconds: 10,
        input: narrateInput,
      },
    });
    expect(response.statusCode).toBe(200);
    return response.json<Job>();
  };

  it('returns the drafted paragraphs with their citations', async () => {
    answer = narrateOutput;

    const job = await run();

    expect(job).toMatchObject({ status: 'succeeded', output: narrateOutput });
    expect(contractErrors('Job', job)).toEqual([]);
  });

  it('sends Commission names as they are: public bodies, not identifiers to minimise', async () => {
    answer = narrateOutput;

    await run();

    const content = provider.requests.at(-1)?.messages[0]?.content as string;
    expect(content).toContain('"commissionName":"Teachers Service Commission"');
    expect(content).not.toContain('[[PERSON_');
  });

  it('fails a paragraph with a foreign number with reason validation, recording why', async () => {
    answer = {
      paragraphs: narrateOutput.paragraphs.map((each, index) =>
        index === 0 ? { ...each, text: 'In FY2025/26, 11,950 declarations were filed.' } : each,
      ),
    };

    const job = await run();

    expect(job).toMatchObject({ status: 'failed', reason: 'validation', output: null });
    expect(contractErrors('Job', job)).toEqual([]);
    expect(job).not.toHaveProperty('violations');
    const violations = [{ kind: 'foreign-number', paragraph: 0 }];
    const [row] = await t.db.select().from(jobs).where(eq(jobs.id, job.id));
    expect(row?.violations).toEqual(violations);
    const [audit] = await t.db.select().from(auditRecords).where(eq(auditRecords.jobId, job.id));
    expect(audit).toMatchObject({ outcome: 'failed', reason: 'validation', violations });
  });

  it('stores no model text in violations, and at most twenty of them', async () => {
    const prose = 'commission.tsc.nonFilerRate rose to 17.4%';
    answer = {
      paragraphs: narrateOutput.paragraphs.map((each, index) =>
        index === 0 ? { ...each, aggregateRefs: Array.from({ length: 30 }, () => prose) } : each,
      ),
    };

    const job = await run();

    expect(job).toMatchObject({ status: 'failed', reason: 'validation' });
    const [row] = await t.db.select().from(jobs).where(eq(jobs.id, job.id));
    expect(row?.violations).toHaveLength(20);
    expect(row?.violations?.[19]).toEqual({ kind: 'unknown-ref', paragraph: 0, index: 19 });
    const [audit] = await t.db.select().from(auditRecords).where(eq(auditRecords.jobId, job.id));
    expect(audit?.violations).toEqual(row?.violations);
    expect(JSON.stringify([row?.violations, audit?.violations])).not.toContain('17.4');
  });
});
