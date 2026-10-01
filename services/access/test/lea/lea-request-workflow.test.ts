import { fileURLToPath } from 'node:url';

import { WorkflowTestEnvironment } from '@adili/temporal/testing';
import { Context } from '@temporalio/activity';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { LeaRequestActivities } from '../../src/lea/activities.js';
import type {
  LeaBreachOutcome,
  LeaDecisionNoticeOutcome,
  LeaDecisionState,
  LeaPackageOutcome,
  LeaReminderOutcome,
  LeaRequestSignal,
  LeaRequestWorkflowInput,
} from '../../src/lea/contract.js';
import { leaRequest } from '../../src/lea/workflows.js';

/**
 * `LeaRequestWorkflow` against mocked activities in Temporal's time-skipping test environment
 * (S11): the access officers' reminder at day ten and the breach flag at the fourteen-day
 * deadline while the request is undecided; after a grant the officer, then the declarant, told,
 * and the package issued, announced and expired; after a denial the officer only; and the
 * signals, or the request read every six hours, that tell it the decision.
 */
const workflowsPath = fileURLToPath(new URL('../../src/workflows.ts', import.meta.url));

type Activities = { [K in keyof LeaRequestActivities]: LeaRequestActivities[K] };

const DAY_MS = 24 * 60 * 60 * 1000;
const DECISION_DAYS = 14;
const DOWNLOAD_DAYS = 14;
const GRANT_STEPS = [
  'decision-notice',
  'notify-declarant',
  'issue-package',
  'package-ready',
  'expire-package',
];
const REQUEST_ID = '0199c000-0000-7000-8000-00000000a264';

describe('LeaRequestWorkflow', () => {
  let env: WorkflowTestEnvironment;

  beforeAll(async () => {
    env = await WorkflowTestEnvironment.create();
  }, 120_000);

  afterAll(async () => {
    await env.teardown();
  });

  const scheduledAt = () => Context.current().info.currentAttemptScheduledTimestampMs;

  const signalOwnWorkflow = (signal: LeaRequestSignal) => {
    const { workflowExecution } = Context.current().info;
    if (!workflowExecution) throw new Error('Not an activity of a workflow');
    return env.env.client.workflow.getHandle(workflowExecution.workflowId).signal(signal);
  };

  /** The request, received `daysAgo` days before the test server's current time. */
  async function inputReceived(daysAgo = 0): Promise<LeaRequestWorkflowInput> {
    const receivedAt = (await env.now()).getTime() - daysAgo * DAY_MS;
    return {
      tenant: 'psc',
      requestId: REQUEST_ID,
      receivedAt: new Date(receivedAt).toISOString(),
      deadlineAt: new Date(receivedAt + DECISION_DAYS * DAY_MS).toISOString(),
    };
  }

  interface Recorded {
    calls: string[];
    at: Map<string, number>;
  }

  function activities(
    options: {
      decided?: LeaDecisionNoticeOutcome;
      issued?: 'nothing-to-disclose' | 'missing';
      reminder?: LeaReminderOutcome;
      breach?: LeaBreachOutcome;
      /** What `leaDecisionState` reads, call by call; `undecided` after. */
      decisionStates?: LeaDecisionState[];
      on?: Partial<Record<string, () => Promise<void>>>;
    } = {},
  ): { mocks: Activities; recorded: Recorded } {
    const calls: string[] = [];
    const at = new Map<string, number>();
    const record = async (name: string) => {
      calls.push(name);
      at.set(name, scheduledAt());
      await options.on?.[name]?.();
    };
    const states = [...(options.decisionStates ?? [])];
    const mocks: Activities = {
      // Not recorded: it runs every six hours while the decision is awaited.
      leaDecisionState: vi.fn(async (): Promise<LeaDecisionState> => {
        await options.on?.['decision-state']?.();
        return states.shift() ?? 'undecided';
      }),
      remindLeaOfficers: vi.fn(async (): Promise<LeaReminderOutcome> => {
        await record('remind');
        return options.reminder ?? 'sent';
      }),
      flagLeaBreach: vi.fn(async (): Promise<LeaBreachOutcome> => {
        await record('breach');
        return options.breach ?? 'flagged';
      }),
      leaDecisionNotice: vi.fn(async (): Promise<LeaDecisionNoticeOutcome> => {
        await record('decision-notice');
        return options.decided ?? 'granted';
      }),
      notifyDeclarantOfLeaGrant: vi.fn(async () => {
        await record('notify-declarant');
        return 'notified' as const;
      }),
      issueLeaPackage: vi.fn(async (): Promise<LeaPackageOutcome> => {
        await record('issue-package');
        if (options.issued) return { outcome: options.issued };
        return {
          outcome: 'issued',
          downloadExpiresAt: new Date(scheduledAt() + DOWNLOAD_DAYS * DAY_MS).toISOString(),
        };
      }),
      leaPackageReady: vi.fn(async () => {
        await record('package-ready');
        return 'sent' as const;
      }),
      expireLeaPackage: vi.fn(async () => {
        await record('expire-package');
        return 'expired' as const;
      }),
    };
    return { mocks, recorded: { calls, at } };
  }

  const options = (mocks: Activities, input: LeaRequestWorkflowInput) => ({
    workflowsPath,
    activities: mocks,
    args: [input] as [LeaRequestWorkflowInput],
  });

  /** Days after receipt that `name` ran, to the minute. */
  const dayOf = (input: LeaRequestWorkflowInput, recorded: Recorded, name: string) =>
    Math.round(
      (((recorded.at.get(name) ?? Number.NaN) - new Date(input.receivedAt).getTime()) / DAY_MS) *
        1440,
    ) / 1440;

  it('S11: undecided, the access officers are reminded at day 10 and the request flagged breached at day 14; a later decision is still carried out', async () => {
    const input = await inputReceived();
    const { mocks, recorded } = activities({ on: { breach: () => signalOwnWorkflow('decided') } });

    const result = await env.execute(leaRequest, options(mocks, input));

    expect(result).toEqual({ outcome: 'decided' });
    expect(recorded.calls).toEqual(['remind', 'breach', ...GRANT_STEPS]);
    expect(dayOf(input, recorded, 'remind')).toBe(10);
    expect(dayOf(input, recorded, 'breach')).toBe(14);
    expect(dayOf(input, recorded, 'decision-notice')).toBe(14);
    expect(dayOf(input, recorded, 'expire-package')).toBe(14 + DOWNLOAD_DAYS);
    expect(mocks.remindLeaOfficers).toHaveBeenCalledWith(input);
    expect(mocks.flagLeaBreach).toHaveBeenCalledWith(input);
  }, 60_000);

  it('S11: a grant before day 10: no reminder or breach; the officer told, then the declarant, then the package issued, announced and expired after 14 days', async () => {
    const input = await inputReceived();
    const { mocks, recorded } = activities();

    const result = await env.run(leaRequest, options(mocks, input), async (handle) => {
      await env.skipTime({ ms: 3 * DAY_MS });
      await handle.signal('decided');
      // Time moves only as the test skips it here: past the package's 14-day window.
      await env.skipTime({ ms: (DOWNLOAD_DAYS + 1) * DAY_MS });
      return handle.result();
    });

    expect(result).toEqual({ outcome: 'decided' });
    expect(recorded.calls).toEqual(GRANT_STEPS);
    expect(dayOf(input, recorded, 'decision-notice')).toBe(3);
    expect(dayOf(input, recorded, 'notify-declarant')).toBe(3);
    expect(dayOf(input, recorded, 'expire-package')).toBe(3 + DOWNLOAD_DAYS);
    for (const step of [
      mocks.leaDecisionNotice,
      mocks.notifyDeclarantOfLeaGrant,
      mocks.issueLeaPackage,
      mocks.leaPackageReady,
      mocks.expireLeaPackage,
    ]) {
      expect(step).toHaveBeenCalledWith(input);
    }
  }, 60_000);

  it('S11: a denial: only the officer is told; the declarant never, and nothing is issued', async () => {
    const input = await inputReceived();
    const { mocks, recorded } = activities({
      decided: 'denied',
      on: { remind: () => signalOwnWorkflow('decided') },
    });

    const result = await env.execute(leaRequest, options(mocks, input));

    expect(result).toEqual({ outcome: 'decided' });
    expect(recorded.calls).toEqual(['remind', 'decision-notice']);
    expect(mocks.notifyDeclarantOfLeaGrant).not.toHaveBeenCalled();
    expect(mocks.issueLeaPackage).not.toHaveBeenCalled();
    expect(mocks.flagLeaBreach).not.toHaveBeenCalled();
  }, 60_000);

  it('a grant with nothing to disclose in its scope: the declarant is told, no package to announce or expire', async () => {
    const input = await inputReceived();
    const { mocks, recorded } = activities({
      issued: 'nothing-to-disclose',
      on: { remind: () => signalOwnWorkflow('decided') },
    });

    const result = await env.execute(leaRequest, options(mocks, input));

    expect(result).toEqual({ outcome: 'decided' });
    expect(recorded.calls).toEqual([
      'remind',
      'decision-notice',
      'notify-declarant',
      'issue-package',
    ]);
  }, 60_000);

  it('a lost `decided` signal: the request is read every 6 hours, and the decision is carried out', async () => {
    const input = await inputReceived();
    const { mocks, recorded } = activities({
      decided: 'denied',
      decisionStates: ['undecided', 'decided'],
    });

    const result = await env.execute(leaRequest, options(mocks, input));

    expect(result).toEqual({ outcome: 'decided' });
    expect(recorded.calls).toEqual(['decision-notice']);
    expect(dayOf(input, recorded, 'decision-notice')).toBe(0.5);
    expect(mocks.leaDecisionState).toHaveBeenCalledTimes(2);
  }, 60_000);

  it('withdrawn ends the run with no reminder', async () => {
    const input = await inputReceived();
    const { mocks } = activities();

    const result = await env.run(leaRequest, options(mocks, input), async (handle) => {
      await handle.signal('withdrawn');
      return handle.result();
    });

    expect(result).toEqual({ outcome: 'withdrawn' });
    expect(mocks.remindLeaOfficers).not.toHaveBeenCalled();
    expect(mocks.leaDecisionNotice).not.toHaveBeenCalled();
  }, 60_000);

  it('ends when the request is not there (its receipt rolled back)', async () => {
    const input = await inputReceived();
    const { mocks } = activities({ reminder: 'missing' });

    const result = await env.execute(leaRequest, options(mocks, input));

    expect(result).toEqual({ outcome: 'missing' });
    expect(mocks.flagLeaBreach).not.toHaveBeenCalled();
  }, 60_000);

  it('run late (day 12, e.g. after an outage): the reminder at once, then the breach flag at the deadline', async () => {
    const input = await inputReceived(12);
    const { mocks, recorded } = activities({
      on: { breach: () => signalOwnWorkflow('withdrawn') },
    });

    const result = await env.execute(leaRequest, options(mocks, input));

    expect(result).toEqual({ outcome: 'withdrawn' });
    expect(recorded.calls).toEqual(['remind', 'breach']);
    expect(dayOf(input, recorded, 'remind')).toBe(12);
    expect(dayOf(input, recorded, 'breach')).toBe(14);
  }, 60_000);

  it('run past the deadline (day 15): no reminder, the breach flag at once', async () => {
    const input = await inputReceived(15);
    const { mocks, recorded } = activities({
      on: { breach: () => signalOwnWorkflow('withdrawn') },
    });

    const result = await env.execute(leaRequest, options(mocks, input));

    expect(result).toEqual({ outcome: 'withdrawn' });
    expect(recorded.calls).toEqual(['breach']);
    expect(dayOf(input, recorded, 'breach')).toBe(15);
  }, 60_000);
});
