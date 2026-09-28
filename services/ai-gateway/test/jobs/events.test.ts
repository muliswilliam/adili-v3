import { describe, expect, it } from 'vitest';

import type { Job } from '../../src/db/schema.js';
import { jobFinished } from '../../src/jobs/events.js';

const job: Job = {
  id: '0199a8f0-7777-7000-8000-000000000007',
  tenant: 'demo',
  task: 'explain-flags',
  promptVersion: 1,
  dataClass: 'highly-confidential',
  subjectRef: 'review-case:0199a8f0-3333-7000-8000-000000000003',
  caller: 'review',
  idempotencyKey: 'key',
  requestHash: 'request',
  inputHash: 'input',
  input: null,
  status: 'succeeded',
  reason: null,
  provider: 'replay',
  model: 'claude-opus-5-5',
  output: null,
  outputHash: 'output',
  outputPurgedAt: null,
  tokensIn: 0,
  tokensOut: 0,
  costMicros: 0,
  latencyMs: 0,
  createdAt: new Date(),
  startedAt: null,
  finishedAt: new Date(),
};

describe('jobFinished', () => {
  it.each([
    ['succeeded', 'ai.job.completed.v1', null],
    ['failed', 'ai.job.failed.v1', 'validation'],
    ['blocked', 'ai.job.blocked.v1', 'policy'],
  ] as const)('announces a %s job as %s', (status, type, reason) => {
    const event = jobFinished({ ...job, status, reason });

    expect(event).toMatchObject({ type, subject: job.id, tenant: 'demo', data: { reason } });
  });

  it('refuses a job that has not finished', () => {
    expect(() => jobFinished({ ...job, status: 'running' })).toThrow(/has not finished/);
  });
});
