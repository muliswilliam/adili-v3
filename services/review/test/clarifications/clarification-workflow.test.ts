import { fileURLToPath } from 'node:url';

import { WorkflowTestEnvironment } from '@adili/temporal/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { ClarificationActivities } from '../../src/clarifications/activities.js';
import type {
  ClarificationWorkflowInput,
  LetterOutcome,
  NotifyOutcome,
  NotifyRequest,
} from '../../src/clarifications/contract.js';
import { clarification } from '../../src/clarifications/workflows.js';

/**
 * `ClarificationWorkflow` against mocked activities in Temporal's time-skipping test environment:
 * the letter, then the notices, and the wait for the issue transaction to commit.
 */
const workflowsPath = fileURLToPath(new URL('../../src/processing/workflows.ts', import.meta.url));

type Activities = { [K in keyof ClarificationActivities]: ClarificationActivities[K] };

const input: ClarificationWorkflowInput = {
  tenant: 'psc',
  clarificationId: '0199b000-0000-7000-8000-0000000000c1',
};

function activities(overrides: Partial<Activities> = {}): Activities {
  return {
    requestLetter: vi.fn(() => Promise.resolve<LetterOutcome>('requested')),
    notifyDeclarant: vi.fn(() => Promise.resolve<NotifyOutcome>('sent')),
    ...overrides,
  };
}

describe('ClarificationWorkflow', () => {
  let env: WorkflowTestEnvironment;

  beforeAll(async () => {
    env = await WorkflowTestEnvironment.create();
  }, 120_000);

  afterAll(async () => {
    await env.teardown();
  });

  it('requests the letter, then tells the declarant by email and SMS', async () => {
    const calls: string[] = [];
    const mocks = activities({
      requestLetter: vi.fn(() => {
        calls.push('letter');
        return Promise.resolve<LetterOutcome>('requested');
      }),
      notifyDeclarant: vi.fn((request: NotifyRequest) => {
        calls.push(`${request.notice}-${request.channel}`);
        return Promise.resolve<NotifyOutcome>('sent');
      }),
    });

    const result = await env.execute(clarification, {
      workflowsPath,
      activities: mocks,
      args: [input],
    });

    expect(result).toEqual({ outcome: 'notified' });
    expect(calls).toEqual(['letter', 'issued-email', 'issued-sms']);
    expect(mocks.requestLetter).toHaveBeenCalledWith(input);
  }, 60_000);

  it('waits for the issue transaction to commit before the letter', async () => {
    const outcomes: LetterOutcome[] = ['not-issued', 'not-issued', 'requested'];
    const mocks = activities({
      requestLetter: vi.fn(() => Promise.resolve(outcomes.shift() ?? 'requested')),
    });

    const result = await env.execute(clarification, {
      workflowsPath,
      activities: mocks,
      args: [input],
    });

    expect(result).toEqual({ outcome: 'notified' });
    expect(mocks.requestLetter).toHaveBeenCalledTimes(3);
    expect(mocks.notifyDeclarant).toHaveBeenCalledTimes(2);
  }, 60_000);

  it('ends without notices when the clarification never gets issued', async () => {
    const mocks = activities({
      requestLetter: vi.fn(() => Promise.resolve<LetterOutcome>('not-issued')),
    });

    const result = await env.execute(clarification, {
      workflowsPath,
      activities: mocks,
      args: [input],
    });

    expect(result).toEqual({ outcome: 'not-issued' });
    expect(mocks.notifyDeclarant).not.toHaveBeenCalled();
  }, 60_000);
});
