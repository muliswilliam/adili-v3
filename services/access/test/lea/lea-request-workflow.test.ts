import { fileURLToPath } from 'node:url';

import { WorkflowTestEnvironment } from '@adili/temporal/testing';
import { Context } from '@temporalio/activity';
import { WorkflowFailedError } from '@temporalio/client';
import { ApplicationFailure } from '@temporalio/common';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { UPSTREAM_REFUSED } from '../../src/activity-retry.js';
import type { LeaRequestActivities } from '../../src/lea/activities.js';
import type {
  LeaBreachOutcome,
  LeaDecisionNoticeOutcome,
  LeaDeclarantNoticeOutcome,
  LeaPackageOutcome,
  LeaReminderOutcome,
  LeaRequestSignal,
  LeaRequestState,
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
      transactionId: '4242',
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
      /**
       * What `leaRequestState` reads, call by call (the first once the receiving transaction
       * ended, then every six hours while the decision is awaited); `undecided` after.
       */
      states?: LeaRequestState[];
      /** Activities (by recorded name) that fail without retrying. */
      fail?: readonly string[];
      on?: Partial<Record<string, () => Promise<void>>>;
      /** What telling the declarant answers, call by call; `notified` after. */
      told?: LeaDeclarantNoticeOutcome[];
      /** What telling the declarant answers now, before `told`. */
      toldNow?: () => LeaDeclarantNoticeOutcome | undefined;
    } = {},
  ): { mocks: Activities; recorded: Recorded } {
    const calls: string[] = [];
    const at = new Map<string, number>();
    const record = async (name: string) => {
      calls.push(name);
      at.set(name, scheduledAt());
      await options.on?.[name]?.();
      if (options.fail?.includes(name)) {
        throw ApplicationFailure.nonRetryable(`${name} refused`, UPSTREAM_REFUSED);
      }
    };
    const states = [...(options.states ?? [])];
    const told = [...(options.told ?? [])];
    const mocks: Activities = {
      // Not recorded: it runs first, then every six hours while the decision is awaited.
      leaRequestState: vi.fn((): Promise<LeaRequestState> =>
        Promise.resolve(states.shift() ?? 'undecided'),
      ),
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
      notifyDeclarantOfLeaGrant: vi.fn(async (): Promise<LeaDeclarantNoticeOutcome> => {
        await record('notify-declarant');
        return options.toldNow?.() ?? told.shift() ?? 'notified';
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
      leaWithdrawnNotice: vi.fn(async () => {
        await record('withdrawn-notice');
        return 'sent' as const;
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

  it("S11: the clock runs to the Commission's deadline: a 10-day one reminds at day 6 and flags at day 10", async () => {
    const received = await inputReceived();
    const input = {
      ...received,
      deadlineAt: new Date(new Date(received.receivedAt).getTime() + 10 * DAY_MS).toISOString(),
    };
    const { mocks, recorded } = activities({
      on: { breach: () => signalOwnWorkflow('withdrawn') },
    });

    await env.execute(leaRequest, options(mocks, input));

    expect(recorded.calls).toEqual(['remind', 'breach', 'withdrawn-notice']);
    expect(dayOf(input, recorded, 'remind')).toBe(6);
    expect(dayOf(input, recorded, 'breach')).toBe(10);
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
      states: ['undecided', 'undecided', 'decided'],
    });

    const result = await env.execute(leaRequest, options(mocks, input));

    expect(result).toEqual({ outcome: 'decided' });
    expect(recorded.calls).toEqual(['decision-notice']);
    expect(dayOf(input, recorded, 'decision-notice')).toBe(0.5);
    expect(mocks.leaRequestState).toHaveBeenCalledTimes(3);
    expect(mocks.leaRequestState).toHaveBeenCalledWith(input);
  }, 60_000);

  it('a lost `withdrawn` signal: the request read withdrawn ends the run', async () => {
    const input = await inputReceived();
    const { mocks, recorded } = activities({ states: ['undecided', 'withdrawn'] });

    const result = await env.execute(leaRequest, options(mocks, input));

    expect(result).toEqual({ outcome: 'withdrawn' });
    expect(recorded.calls).toEqual(['withdrawn-notice']);
    expect(mocks.leaRequestState).toHaveBeenCalledTimes(2);
  }, 60_000);

  it('decided before the run first read it (its signal lost): the decision is carried out at once', async () => {
    const input = await inputReceived();
    const { mocks, recorded } = activities({ decided: 'denied', states: ['decided'] });

    const result = await env.execute(leaRequest, options(mocks, input));

    expect(result).toEqual({ outcome: 'decided' });
    expect(recorded.calls).toEqual(['decision-notice']);
    expect(dayOf(input, recorded, 'decision-notice')).toBe(0);
  }, 60_000);

  it('the receipt rolled back after the workflow started: it ends at once, with no reminder', async () => {
    const input = await inputReceived();
    const { mocks, recorded } = activities({ states: ['missing'] });

    const result = await env.execute(leaRequest, options(mocks, input));

    expect(result).toEqual({ outcome: 'missing' });
    expect(recorded.calls).toEqual([]);
    expect(mocks.leaRequestState).toHaveBeenCalledTimes(1);
  }, 60_000);

  it('a reminder that fails after its retries is passed over: the breach is still flagged at the deadline', async () => {
    const input = await inputReceived();
    const { mocks, recorded } = activities({
      fail: ['remind'],
      on: { breach: () => signalOwnWorkflow('withdrawn') },
    });

    const result = await env.execute(leaRequest, options(mocks, input));

    expect(result).toEqual({ outcome: 'withdrawn' });
    expect(recorded.calls).toEqual(['remind', 'breach', 'withdrawn-notice']);
    expect(dayOf(input, recorded, 'breach')).toBe(14);
  }, 60_000);

  it('a step after the decision that fails without retrying fails the run', async () => {
    const input = await inputReceived();
    const { mocks, recorded } = activities({ states: ['decided'], fail: ['issue-package'] });

    const failed = await env
      .execute(leaRequest, options(mocks, input))
      .catch((error: unknown) => error);

    expect(failed).toBeInstanceOf(WorkflowFailedError);
    expect(recorded.calls).toEqual(['decision-notice', 'notify-declarant', 'issue-package']);
    expect(mocks.issueLeaPackage).toHaveBeenCalledTimes(1);
  }, 60_000);

  it('withdrawn: the access officers are told and the run ends, with no reminder', async () => {
    const input = await inputReceived();
    const { mocks, recorded } = activities();

    const result = await env.run(leaRequest, options(mocks, input), async (handle) => {
      await handle.signal('withdrawn');
      return handle.result();
    });

    expect(result).toEqual({ outcome: 'withdrawn' });
    expect(recorded.calls).toEqual(['withdrawn-notice']);
    expect(mocks.leaWithdrawnNotice).toHaveBeenCalledWith(input);
    expect(mocks.remindLeaOfficers).not.toHaveBeenCalled();
    expect(mocks.leaDecisionNotice).not.toHaveBeenCalled();
  }, 60_000);

  it('withdrawn, the notice failing after its retries: logged, the run still ends', async () => {
    const input = await inputReceived(3);
    const { mocks } = activities({ states: ['withdrawn'], fail: ['withdrawn-notice'] });

    const result = await env.execute(leaRequest, options(mocks, input));

    expect(result).toEqual({ outcome: 'withdrawn' });
    expect(mocks.leaWithdrawnNotice).toHaveBeenCalledTimes(1);
  }, 60_000);

  it('ends when a reminder finds the request not there', async () => {
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
    expect(recorded.calls).toEqual(['remind', 'breach', 'withdrawn-notice']);
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
    expect(recorded.calls).toEqual(['breach', 'withdrawn-notice']);
    expect(dayOf(input, recorded, 'breach')).toBe(15);
  }, 60_000);

  describe('a declarant with no account (spec 10 decision 2)', () => {
    it('the package goes ahead; the declarant is told once the access officer records the written notice', async () => {
      const input = await inputReceived();
      let served = false;
      const { mocks, recorded } = activities({
        toldNow: () => (served ? 'notified' : 'awaiting-notice'),
      });

      const result = await env.run(leaRequest, options(mocks, input), async (handle) => {
        await env.skipTime({ ms: 3 * DAY_MS });
        await handle.signal('decided');
        // Read every six hours meanwhile: still no account, no notice.
        await env.skipTime({ ms: 4 * DAY_MS - 60_000 });
        served = true;
        await handle.signal('notified');
        await env.skipTime({ ms: (DOWNLOAD_DAYS + 1) * DAY_MS });
        return handle.result();
      });

      expect(result).toEqual({ outcome: 'decided' });
      expect(recorded.calls.slice(0, 4)).toEqual([
        'decision-notice',
        'notify-declarant',
        'issue-package',
        'package-ready',
      ]);
      expect(recorded.calls.at(-1)).toBe('expire-package');
      // Told on the signal, just before day 7; not again after.
      expect(dayOf(input, recorded, 'notify-declarant')).toBeCloseTo(7, 2);
      expect(await vi.mocked(mocks.notifyDeclarantOfLeaGrant).mock.results.at(-1)?.value).toBe(
        'notified',
      );
      expect(dayOf(input, recorded, 'expire-package')).toBe(3 + DOWNLOAD_DAYS);
    }, 60_000);

    it('lost signals: telling the declarant runs again at each six-hour read, after the package if need be', async () => {
      const input = await inputReceived();
      const { mocks, recorded } = activities({
        told: ['awaiting-notice', 'awaiting-notice', 'notified'],
      });

      const result = await env.run(leaRequest, options(mocks, input), async (handle) => {
        await env.skipTime({ ms: DAY_MS });
        await handle.signal('decided');
        await env.skipTime({ ms: (DOWNLOAD_DAYS + 1) * DAY_MS });
        return handle.result();
      });

      expect(result).toEqual({ outcome: 'decided' });
      expect(mocks.notifyDeclarantOfLeaGrant).toHaveBeenCalledTimes(3);
      expect(dayOf(input, recorded, 'notify-declarant')).toBe(1.5);
    }, 60_000);
  });
});
