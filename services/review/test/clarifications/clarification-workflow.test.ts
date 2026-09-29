import { fileURLToPath } from 'node:url';

import { WorkflowTestEnvironment } from '@adili/temporal/testing';
import { Context } from '@temporalio/activity';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { ClarificationActivities } from '../../src/clarifications/activities.js';
import type {
  ClarificationClock,
  ClarificationSignal,
  ClarificationWorkflowInput,
  LetterOutcome,
  NotifyOutcome,
  NotifyRequest,
} from '../../src/clarifications/contract.js';
import { clarification } from '../../src/clarifications/workflows.js';

/**
 * `ClarificationWorkflow` against mocked activities in Temporal's time-skipping test environment:
 * the letter, then the notices, the wait for the issue transaction to commit, and (S13) the clock
 * set from the issue time and the Commission's reply window: the day-20 reminder, `overdue` at the
 * due date, and the signals that end it.
 */
const workflowsPath = fileURLToPath(new URL('../../src/processing/workflows.ts', import.meta.url));

type Activities = { [K in keyof ClarificationActivities]: ClarificationActivities[K] };

const DAY_MS = 24 * 60 * 60 * 1000;

const input: ClarificationWorkflowInput = {
  tenant: 'psc',
  clarificationId: '0199b000-0000-7000-8000-0000000000c1',
};

describe('ClarificationWorkflow', () => {
  let env: WorkflowTestEnvironment;

  beforeAll(async () => {
    env = await WorkflowTestEnvironment.create();
  }, 120_000);

  afterAll(async () => {
    await env.teardown();
  });

  /** The workflow time an activity was scheduled at (time-skipping moves it, not the wall clock). */
  const scheduledAt = () => Context.current().info.currentAttemptScheduledTimestampMs;

  /** Sends `signal` to the workflow running the current activity, as the review service would. */
  const signalOwnWorkflow = (signal: ClarificationSignal) => {
    const { workflowExecution } = Context.current().info;
    if (!workflowExecution) throw new Error('Not an activity of a workflow');
    return env.env.client.workflow.getHandle(workflowExecution.workflowId).signal(signal);
  };

  interface Recorded {
    calls: string[];
    /** Workflow time of each call, by name. */
    at: Map<string, number>;
    /** The issue time `clarificationClock` answered. */
    issuedAt: () => number;
  }

  /**
   * Activities that record what ran and when. `clarificationClock` answers the time it was
   * called as the issue time, with `replyWindowDays`; `on` runs extra work inside an activity.
   */
  function activities(
    options: {
      replyWindowDays?: number;
      overrides?: Partial<Activities>;
      on?: Partial<Record<string, () => Promise<void>>>;
    } = {},
  ): { mocks: Activities; recorded: Recorded } {
    const calls: string[] = [];
    const at = new Map<string, number>();
    let issuedAt = 0;
    const record = async (name: string) => {
      calls.push(name);
      at.set(name, scheduledAt());
      await options.on?.[name]?.();
    };
    const mocks: Activities = {
      requestLetter: vi.fn(async (): Promise<LetterOutcome> => {
        await record('letter');
        return 'requested';
      }),
      notifyDeclarant: vi.fn(async (request: NotifyRequest): Promise<NotifyOutcome> => {
        await record(`${request.notice}-${request.channel}`);
        return 'sent';
      }),
      clarificationClock: vi.fn(async (): Promise<ClarificationClock> => {
        issuedAt = scheduledAt();
        await record('clock');
        return {
          issuedAt: new Date(issuedAt).toISOString(),
          replyWindowDays: options.replyWindowDays ?? 30,
        };
      }),
      recordReminder: vi.fn(async () => {
        await record('reminder-recorded');
        return true;
      }),
      markOverdue: vi.fn(async () => {
        await record('overdue');
        return true;
      }),
      ...options.overrides,
    };
    return { mocks, recorded: { calls, at, issuedAt: () => issuedAt } };
  }

  const run = (mocks: Activities) =>
    env.execute(clarification, { workflowsPath, activities: mocks, args: [input] });

  /** Days after the issue time that `name` ran, to the minute. */
  const dayOf = (recorded: Recorded, name: string) =>
    Math.round((((recorded.at.get(name) ?? 0) - recorded.issuedAt()) / DAY_MS) * 1440) / 1440;

  it('requests the letter, then tells the declarant by email and SMS', async () => {
    const { mocks, recorded } = activities();

    await run(mocks);

    expect(recorded.calls.slice(0, 3)).toEqual(['letter', 'issued-email', 'issued-sms']);
    expect(mocks.requestLetter).toHaveBeenCalledWith(input);
    expect(mocks.clarificationClock).toHaveBeenCalledWith(input);
  }, 60_000);

  it('S13: at day 20 reminds the declarant by email and SMS; at day 30 without a response marks it overdue', async () => {
    const { mocks, recorded } = activities();

    const result = await run(mocks);

    expect(result).toEqual({ outcome: 'overdue' });
    expect(recorded.calls).toEqual([
      'letter',
      'issued-email',
      'issued-sms',
      'clock',
      'reminder-email',
      'reminder-sms',
      'reminder-recorded',
      'overdue',
    ]);
    expect(dayOf(recorded, 'reminder-email')).toBe(20);
    expect(dayOf(recorded, 'reminder-recorded')).toBe(20);
    expect(dayOf(recorded, 'overdue')).toBe(30);
    expect(mocks.notifyDeclarant).toHaveBeenCalledWith({
      ...input,
      notice: 'reminder',
      channel: 'sms',
    });
    expect(mocks.markOverdue).toHaveBeenCalledWith(input);
  }, 60_000);

  it("S13: the due date follows the Commission's reply window (45 days)", async () => {
    const { mocks, recorded } = activities({ replyWindowDays: 45 });

    const result = await run(mocks);

    expect(result).toEqual({ outcome: 'overdue' });
    expect(dayOf(recorded, 'reminder-email')).toBe(20);
    expect(dayOf(recorded, 'overdue')).toBe(45);
  }, 60_000);

  it('S13: a reply window of 20 days or less has no reminder, only the due date', async () => {
    const { mocks, recorded } = activities({ replyWindowDays: 14 });

    const result = await run(mocks);

    expect(result).toEqual({ outcome: 'overdue' });
    expect(recorded.calls).not.toContain('reminder-email');
    expect(dayOf(recorded, 'overdue')).toBe(14);
  }, 60_000);

  it('S13: `responded` before day 20 ends the clock: no reminder, no overdue', async () => {
    const { mocks, recorded } = activities({
      on: { clock: () => signalOwnWorkflow('responded') },
    });

    const result = await run(mocks);

    expect(result).toEqual({ outcome: 'responded' });
    expect(recorded.calls).toEqual(['letter', 'issued-email', 'issued-sms', 'clock']);
    expect(mocks.markOverdue).not.toHaveBeenCalled();
  }, 60_000);

  it('S13: `responded` after the reminder ends the clock before the due date', async () => {
    const { mocks, recorded } = activities({
      on: { 'reminder-recorded': () => signalOwnWorkflow('responded') },
    });

    const result = await run(mocks);

    expect(result).toEqual({ outcome: 'responded' });
    expect(recorded.calls.at(-1)).toBe('reminder-recorded');
    expect(mocks.markOverdue).not.toHaveBeenCalled();
  }, 60_000);

  it.each(['withdrawn', 'resolved'] as const)(
    'S13: `%s` ends the clock: no reminder, no overdue',
    async (signal) => {
      const { mocks, recorded } = activities({ on: { clock: () => signalOwnWorkflow(signal) } });

      const result = await run(mocks);

      expect(result).toEqual({ outcome: signal });
      expect(recorded.calls).not.toContain('reminder-email');
      expect(mocks.markOverdue).not.toHaveBeenCalled();
    },
    60_000,
  );

  it('withdrawn before the notices: the declarant is not told', async () => {
    const { mocks, recorded } = activities({
      on: { letter: () => signalOwnWorkflow('withdrawn') },
    });

    const result = await run(mocks);

    expect(result).toEqual({ outcome: 'withdrawn' });
    expect(recorded.calls).toEqual(['letter']);
  }, 60_000);

  it('ends when the clarification was withdrawn before its letter', async () => {
    const { mocks } = activities({
      overrides: { requestLetter: vi.fn(() => Promise.resolve<LetterOutcome>('withdrawn')) },
    });

    const result = await run(mocks);

    expect(result).toEqual({ outcome: 'withdrawn' });
    expect(mocks.notifyDeclarant).not.toHaveBeenCalled();
  }, 60_000);

  it('waits for the issue transaction to commit before the letter', async () => {
    const outcomes: LetterOutcome[] = ['not-issued', 'not-issued', 'requested'];
    const { mocks } = activities({
      overrides: {
        requestLetter: vi.fn(() => Promise.resolve(outcomes.shift() ?? 'requested')),
      },
    });

    await run(mocks);

    expect(mocks.requestLetter).toHaveBeenCalledTimes(3);
    expect(mocks.notifyDeclarant).toHaveBeenCalledWith({
      ...input,
      notice: 'issued',
      channel: 'email',
    });
  }, 60_000);

  it('ends without notices when the clarification never gets issued', async () => {
    const { mocks } = activities({
      overrides: { requestLetter: vi.fn(() => Promise.resolve<LetterOutcome>('not-issued')) },
    });

    const result = await run(mocks);

    expect(result).toEqual({ outcome: 'not-issued' });
    expect(mocks.notifyDeclarant).not.toHaveBeenCalled();
  }, 60_000);
});
