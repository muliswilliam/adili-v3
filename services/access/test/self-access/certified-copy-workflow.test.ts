import { fileURLToPath } from 'node:url';

import { WorkflowTestEnvironment } from '@adili/temporal/testing';
import { ApplicationFailure } from '@temporalio/common';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { UPSTREAM_REFUSED } from '../../src/activity-retry.js';
import type { CertifiedCopyActivities } from '../../src/self-access/activities.js';
import type { CertifiedCopyWorkflowInput, IssueOutcome } from '../../src/self-access/contract.js';
import { certifiedCopy } from '../../src/self-access/workflows.js';

/**
 * `CertifiedCopyWorkflow` against mocked activities in Temporal's time-skipping test environment
 * (S13): the copy issued and the declarant told; and what a failure after the retries leaves
 * (a `failed` copy, never one `pending` with no workflow behind it).
 */
const workflowsPath = fileURLToPath(new URL('../../src/workflows.ts', import.meta.url));

type Activities = { [K in keyof CertifiedCopyActivities]: CertifiedCopyActivities[K] };

const INPUT: CertifiedCopyWorkflowInput = {
  tenant: 'psc',
  copyId: '0199c000-0000-7000-8000-00000000c257',
  transactionId: '4242',
};

const refused = () => ApplicationFailure.nonRetryable('refused', UPSTREAM_REFUSED);

describe('CertifiedCopyWorkflow', () => {
  let env: WorkflowTestEnvironment;

  beforeAll(async () => {
    env = await WorkflowTestEnvironment.create();
  }, 120_000);

  afterAll(async () => {
    await env.teardown();
  });

  function activities(
    issue: () => Promise<IssueOutcome>,
    ready: () => Promise<'sent' | 'missing'> = () => Promise.resolve('sent'),
  ): Activities {
    return {
      issueCertifiedCopy: vi.fn(issue),
      certifiedCopyReady: vi.fn(ready),
      certifiedCopyFailed: vi.fn(() => Promise.resolve()),
    };
  }

  const options = (mocks: Activities) => ({
    workflowsPath,
    activities: mocks,
    args: [INPUT] as [CertifiedCopyWorkflowInput],
  });

  it('S13: issued, then the declarant is told it is ready', async () => {
    const mocks = activities(() => Promise.resolve('issued'));

    const result = await env.execute(certifiedCopy, options(mocks));

    expect(result).toEqual({ outcome: 'issued' });
    expect(mocks.issueCertifiedCopy).toHaveBeenCalledWith(INPUT);
    expect(mocks.certifiedCopyReady).toHaveBeenCalledWith(INPUT);
    expect(mocks.certifiedCopyFailed).not.toHaveBeenCalled();
  }, 60_000);

  it('no such version: the copy failed, nobody is told it is ready', async () => {
    const mocks = activities(() => Promise.resolve('not-found'));

    const result = await env.execute(certifiedCopy, options(mocks));

    expect(result).toEqual({ outcome: 'not-found' });
    expect(mocks.certifiedCopyReady).not.toHaveBeenCalled();
  }, 60_000);

  it('issuing refused (not retried): the copy is recorded failed, so it can be ordered again', async () => {
    const mocks = activities(() => Promise.reject(refused()));

    const result = await env.execute(certifiedCopy, options(mocks));

    expect(result).toEqual({ outcome: 'failed' });
    expect(mocks.issueCertifiedCopy).toHaveBeenCalledTimes(1);
    expect(mocks.certifiedCopyFailed).toHaveBeenCalledWith(INPUT);
    expect(mocks.certifiedCopyReady).not.toHaveBeenCalled();
  }, 60_000);

  it('the ready message failing after its retries leaves the copy issued', async () => {
    const mocks = activities(
      () => Promise.resolve('issued'),
      () => Promise.reject(refused()),
    );

    const result = await env.execute(certifiedCopy, options(mocks));

    expect(result).toEqual({ outcome: 'issued' });
    expect(mocks.certifiedCopyFailed).not.toHaveBeenCalled();
  }, 60_000);
});
