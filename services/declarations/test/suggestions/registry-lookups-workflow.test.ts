import { fileURLToPath } from 'node:url';

import { WorkflowTestEnvironment } from '@adili/temporal/testing';
import { ApplicationFailure } from '@temporalio/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type {
  LookupAttempt,
  LookupAttemptOutcome,
  LookupFailure,
  RegistryLookupsInput,
} from '../../src/suggestions/workflow/contract.js';
import { registryLookups } from '../../src/suggestions/workflow/workflows.js';

/**
 * `RegistryLookupsWorkflow` (spec 05b, #530) against mocked activities in Temporal's
 * time-skipping test environment: each set's first attempt waits on the transaction that recorded
 * the request and started the workflow; later attempts do not.
 */
const workflowsPath = fileURLToPath(
  new URL('../../src/suggestions/workflow/workflows.ts', import.meta.url),
);

const input: RegistryLookupsInput = {
  tenant: 'psc',
  declarationId: '0199a000-0000-7000-8000-00000000d001',
  personId: '0199a000-0000-7000-8000-00000000d002',
  subject: 'declarant-sub',
  personKey: 'officer',
  consentId: '0199a000-0000-7000-8000-00000000d003',
  sets: [
    { setId: '0199a000-0000-7000-8000-00000000d004', system: 'kra' },
    { setId: '0199a000-0000-7000-8000-00000000d005', system: 'ntsa' },
  ],
  transactionId: '987654',
};

let env: WorkflowTestEnvironment;

beforeAll(async () => {
  env = await WorkflowTestEnvironment.create();
}, 60_000);

afterAll(async () => {
  await env.teardown();
});

describe('registryLookups', () => {
  it("passes the starting transaction to each set's first attempt only", async () => {
    const attempts: LookupAttempt[] = [];
    // KRA answers at once; NTSA does not answer the first time, then does.
    const outcomes = new Map<string, LookupAttemptOutcome[]>([
      ['kra', ['recorded']],
      ['ntsa', ['retry', 'recorded']],
    ]);
    await env.execute(registryLookups, {
      workflowsPath,
      activities: {
        lookupRegistry: (attempt: LookupAttempt) => {
          attempts.push(attempt);
          return Promise.resolve(outcomes.get(attempt.system)?.shift() ?? 'recorded');
        },
        markLookupFailed: () => Promise.resolve(),
      },
      args: [input],
    });

    const bySystem = (system: string) =>
      attempts.filter((attempt) => attempt.system === system).map((a) => a.transactionId);
    expect(bySystem('kra')).toEqual(['987654']);
    expect(bySystem('ntsa')).toEqual(['987654', null]);
  }, 60_000);

  it('marks a set failed with the starting transaction, so the marking waits for it too', async () => {
    const marked: LookupFailure[] = [];
    await env.execute(registryLookups, {
      workflowsPath,
      activities: {
        lookupRegistry: () => Promise.reject(ApplicationFailure.nonRetryable('down', 'Test')),
        markLookupFailed: (ref: LookupFailure) => {
          marked.push(ref);
          return Promise.resolve();
        },
      },
      args: [input],
    });
    // The sets run in parallel: in either order.
    expect(marked.map((ref) => [ref.setId, ref.transactionId])).toEqual(
      expect.arrayContaining([
        [input.sets[0]?.setId, '987654'],
        [input.sets[1]?.setId, '987654'],
      ]),
    );
    expect(marked).toHaveLength(2);
  }, 60_000);

  it('a run started before #530, without a transaction, waits on none', async () => {
    const attempts: LookupAttempt[] = [];
    const before: RegistryLookupsInput = { ...input };
    delete before.transactionId;
    await env.execute(registryLookups, {
      workflowsPath,
      activities: {
        lookupRegistry: (attempt: LookupAttempt) => {
          attempts.push(attempt);
          return Promise.resolve('recorded' as const);
        },
        markLookupFailed: () => Promise.resolve(),
      },
      args: [before],
    });
    expect(attempts.map((attempt) => attempt.transactionId)).toEqual([null, null]);
  }, 60_000);
});
