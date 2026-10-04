import { Logger } from '@nestjs/common';
import type { Database } from '@adili/data-access';
import type { EventPublisher } from '@adili/events';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { Job, schema } from '../../src/db/schema.js';
import type { Admission } from '../../src/jobs/admission.js';
import type { DocumentFetcher } from '../../src/documents/document-fetcher.js';
import { JobExecutor } from '../../src/jobs/job-executor.js';
import { CircuitBreaker } from '../../src/policy/circuit-breaker.js';
import { GenAiTelemetry } from '../../src/policy/telemetry.js';
import { ProviderRegistry } from '../../src/providers/providers.module.js';
import { summarizeInput } from '../support/inputs.js';
import { ScriptedProvider } from '../support/scripted-provider.js';

const job = {
  id: '0192f1a0-5a11-7000-8000-00000000a001',
  tenant: 'demo',
  task: 'summarize-declaration',
  promptVersion: 1,
  dataClass: 'synthetic',
  provider: 'scripted',
  model: 'claude-opus-5-5',
  status: 'running',
  input: summarizeInput,
} as unknown as Job;

/** A database that hands `execute` the job as started; nothing else is reached in these tests. */
function startingDatabase(row: Job): Database<typeof schema> {
  const chain = {
    set: () => chain,
    where: () => chain,
    returning: () => Promise.resolve([row]),
  };
  const tx = { execute: () => Promise.resolve(), update: () => chain };
  return {
    transaction: (work: (transaction: typeof tx) => Promise<unknown>) => work(tx),
  } as unknown as Database<typeof schema>;
}

describe('JobExecutor', () => {
  beforeAll(() => {
    const quiet = [
      vi.spyOn(Logger.prototype, 'log').mockReturnValue(undefined),
      vi.spyOn(Logger.prototype, 'warn').mockReturnValue(undefined),
    ];
    return () => {
      for (const spy of quiet) spy.mockRestore();
    };
  });

  it('releases the half-open probe when the request cannot be built', async () => {
    let now = 0;
    const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1000, now: () => now });
    breaker.recordFailure('scripted');
    now += 1000;
    const provider = new ScriptedProvider(() => Promise.reject(new Error('never called')));
    const admission = { refusal: () => Promise.resolve(undefined) } as unknown as Admission;
    const executor = new JobExecutor(
      startingDatabase({ ...job, params: { maxOutputTokens: 'lots' } }),
      new ProviderRegistry([provider]),
      admission,
      breaker,
      new GenAiTelemetry(),
      {} as EventPublisher,
      {} as DocumentFetcher,
    );

    await expect(executor.execute(job.id, Date.now() + 60_000)).rejects.toThrow(
      /Invalid routing parameters/,
    );

    expect(provider.requests).toHaveLength(0);
    // The probe is free again: the next attempt may call the provider.
    expect(breaker.tryAcquire('scripted')).toBe(true);
  });
  it('releases the half-open probe when telemetry throws before the call (review Q18)', async () => {
    let now = 0;
    const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1000, now: () => now });
    breaker.recordFailure('scripted');
    now += 1000;
    const provider = new ScriptedProvider(() => Promise.reject(new Error('never called')));
    const admission = { refusal: () => Promise.resolve(undefined) } as unknown as Admission;
    const telemetry = new GenAiTelemetry();
    vi.spyOn(telemetry, 'identifiersMinimised').mockImplementation(() => {
      throw new Error('metrics exporter down');
    });
    const executor = new JobExecutor(
      startingDatabase({ ...job, params: {} }),
      new ProviderRegistry([provider]),
      admission,
      breaker,
      telemetry,
      {} as EventPublisher,
      {} as DocumentFetcher,
    );

    await expect(executor.execute(job.id, Date.now() + 60_000)).rejects.toThrow(
      /metrics exporter down/,
    );

    expect(provider.requests).toHaveLength(0);
    expect(breaker.tryAcquire('scripted')).toBe(true);
  });
});
