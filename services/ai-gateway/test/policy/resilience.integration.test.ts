import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

import { v7 as uuidv7 } from 'uuid';
import { beforeAll, describe, expect, it } from 'vitest';

import { routes } from '../../src/db/schema.js';
import { ProviderError, type StructuredResult } from '../../src/providers/port.js';
import { summarizeInput, summarizeOutput, usage } from '../support/inputs.js';
import { ScriptedProvider } from '../support/scripted-provider.js';
import { createTestApp, type TestApp } from '../support/test-app.js';

interface Job {
  id: string;
  status: string;
  reason: string | null;
}

/** Longer than the test: once open, the breaker stays open (the probe is a unit test). */
const COOLDOWN_MS = 10 * 60_000;
/**
 * Four attempts with 2, 4 and 8 s between them (`EXECUTE_RETRY`), with a wide margin: compose
 * Temporal shared by parallel test runs can take tens of seconds to dispatch a retry.
 */
const RETRIES_MS = 90_000;
const RETRY_TEST = { timeout: RETRIES_MS + 10_000 };

/**
 * Retries, the circuit breaker, refusals and timeouts (spec 07c S6). The breaker opens after five
 * consecutive transport failures of a provider; every job here retries up to four times.
 */
describe('resilience', () => {
  let mode: 'ok' | 'down' | 'refuse' = 'ok';
  const provider = new ScriptedProvider((): Promise<StructuredResult> => {
    if (mode === 'down') {
      return Promise.reject(new ProviderError('unavailable', 'scripted', 'Service unavailable'));
    }
    if (mode === 'refuse') {
      return Promise.resolve({
        status: 'refused',
        model: 'claude-opus-5-5',
        usage,
        refusal: { category: null, explanation: null },
      });
    }
    return Promise.resolve({
      status: 'completed',
      model: 'claude-opus-5-5',
      output: summarizeOutput,
      usage,
    });
  });
  const slow = new ScriptedProvider(
    async () => {
      await sleep(2_000);
      return { status: 'completed', model: 'slow-model', output: summarizeOutput, usage };
    },
    'self-hosted',
    'slow',
  );
  let t: TestApp;
  let auth: { authorization: string };

  beforeAll(async () => {
    t = await createTestApp({
      provider,
      extraProviders: [slow],
      breaker: { failureThreshold: 5, cooldownMs: COOLDOWN_MS },
    });
    auth = { authorization: `Bearer ${await t.token()}` };
    return () => t.close();
  });

  async function run(tenant = 'demo'): Promise<Job> {
    const response = await t.app.inject({
      method: 'POST',
      url: '/internal/v1/tasks/summarize-declaration',
      headers: { ...auth, 'idempotency-key': randomUUID() },
      payload: {
        tenant,
        dataClass: 'synthetic',
        subjectRef: `review-case:${randomUUID()}`,
        input: summarizeInput,
      },
    });
    let job = response.json<Job>();
    const deadline = Date.now() + RETRIES_MS;
    while (['queued', 'running'].includes(job.status)) {
      if (Date.now() > deadline) throw new Error(`job ${job.id} still ${job.status}`);
      await sleep(100);
      job = (
        await t.app.inject({ method: 'GET', url: `/internal/v1/jobs/${job.id}`, headers: auth })
      ).json<Job>();
    }
    return job;
  }

  it('fails a refused job with reason refused', async () => {
    mode = 'refuse';

    expect(await run()).toMatchObject({ status: 'failed', reason: 'refused' });
  });

  it('retries transport errors, then fails the job with reason provider', RETRY_TEST, async () => {
    mode = 'down';
    const before = provider.requests.length;

    expect(await run()).toMatchObject({ status: 'failed', reason: 'provider' });
    expect(provider.requests.length - before).toBe(4);
  });

  it(
    'opens the breaker after five failures: calls fail fast with provider-unavailable',
    RETRY_TEST,
    async () => {
      // The previous job's four failures, and this job's first attempt, make five.
      const before = provider.requests.length;

      expect(await run()).toMatchObject({ status: 'failed', reason: 'provider-unavailable' });
      expect(provider.requests.length - before).toBe(1);

      mode = 'ok';
      expect(await run()).toMatchObject({ status: 'failed', reason: 'provider-unavailable' });
      expect(provider.requests.length - before).toBe(1);
    },
  );

  it(
    "times a call out at the route's timeout, retries, then fails with reason timeout",
    RETRY_TEST,
    async () => {
      await t.db.insert(routes).values({
        id: uuidv7(),
        tenant: 'slowtenant',
        task: 'summarize-declaration',
        provider: 'slow',
        model: 'slow-model',
        params: { timeoutMs: 200 },
        changedBy: 'platform-admin-1',
      });

      expect(await run('slowtenant')).toMatchObject({ status: 'failed', reason: 'timeout' });
      expect(slow.requests).toHaveLength(4);
    },
  );
});
