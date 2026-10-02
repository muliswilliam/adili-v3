import { fileURLToPath } from 'node:url';

import { WorkflowTestEnvironment } from '@adili/temporal/testing';
import { Context } from '@temporalio/activity';
import { WorkflowFailedError } from '@temporalio/client';
import { ApplicationFailure } from '@temporalio/common';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { INVARIANT_BROKEN } from '../../src/activity-retry.js';
import type { AccessRequestActivities } from '../../src/requests/activities.js';
import type {
  AccessRequestSignal,
  AccessRequestWorkflowInput,
  DecisionNoticesOutcome,
  OfficerReminderOutcome,
  OfficerReminderRequest,
  PackageOutcome,
  RequestState,
  ResolutionOutcome,
  WindowOutcome,
} from '../../src/requests/contract.js';
import type { DecisionActivities } from '../../src/requests/decision-activities.js';
import { accessRequest } from '../../src/requests/workflows.js';

/**
 * `AccessRequestWorkflow` against mocked activities in Temporal's time-skipping test environment:
 * the wait for the officer named to be resolved, the declarant's notice and window (S3), consent
 * (S4), the window elapsing to `under-decision` and the access officers' reminders at days five,
 * twenty and twenty-eight (S5), the decision's notices, package and its expiry (S6, S7), a
 * passport applicant's request held for verification (S2), the signals that move it on, and the
 * reads of the request every six hours that make up for each signal lost.
 */
const workflowsPath = fileURLToPath(new URL('../../src/workflows.ts', import.meta.url));

/** The public methods of both activity classes (their private members do not intersect). */
type Activities = { [K in keyof AccessRequestActivities]: AccessRequestActivities[K] } & {
  [K in keyof DecisionActivities]: DecisionActivities[K];
};

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 7;
const DOWNLOAD_DAYS = 14;
/** What follows a grant, in order. */
const GRANT_STEPS = ['decision-notices', 'issue-package', 'package-ready', 'expire-package'];
const REQUEST_ID = '0199c000-0000-7000-8000-00000000a253';

describe('AccessRequestWorkflow', () => {
  let env: WorkflowTestEnvironment;

  beforeAll(async () => {
    env = await WorkflowTestEnvironment.create();
  }, 120_000);

  afterAll(async () => {
    await env.teardown();
  });

  /** The workflow time an activity was scheduled at (time-skipping moves it, not the wall clock). */
  const scheduledAt = () => Context.current().info.currentAttemptScheduledTimestampMs;

  /** Sends `signal` to the workflow running the current activity, as the access service would. */
  const signalOwnWorkflow = (signal: AccessRequestSignal) => {
    const { workflowExecution } = Context.current().info;
    if (!workflowExecution) throw new Error('Not an activity of a workflow');
    return env.env.client.workflow.getHandle(workflowExecution.workflowId).signal(signal);
  };

  /** The request, received `daysAgo` days before the test server's current time. */
  async function inputReceived(daysAgo = 0): Promise<AccessRequestWorkflowInput> {
    const now = (await env.now()).getTime();
    return {
      tenant: 'psc',
      requestId: REQUEST_ID,
      submittedAt: new Date(now - daysAgo * DAY_MS).toISOString(),
      transactionId: '4242',
    };
  }

  interface Recorded {
    calls: string[];
    /** Workflow time of each call, by name (the last one). */
    at: Map<string, number>;
  }

  /** Where the request stands, as `requestState` reads it; tests change it as the officer would. */
  interface Stored {
    state: RequestState;
  }

  /** Changes the stored request, with no signal (as when the signal is lost). */
  const store = (stored: Stored, state: RequestState) => {
    stored.state = state;
    return Promise.resolve();
  };

  /**
   * Activities that record what ran and when. `resolution` answers `notified` with the window
   * ending seven days after it ran, unless `resolutions` says otherwise; `requestState` reads
   * `stored` (`unresolved` unless given); `on` runs extra work inside an activity, by the name it
   * records; `fail` names activities that fail without retrying, once each.
   */
  function activities(
    options: {
      resolutions?: ResolutionOutcome['outcome'][];
      reminders?: Partial<Record<number, OfficerReminderOutcome>>;
      stored?: Stored;
      decided?: DecisionNoticesOutcome;
      issued?: 'nothing-to-disclose' | 'missing';
      on?: Partial<Record<string, () => Promise<void>>>;
      fail?: readonly string[];
    } = {},
  ): { mocks: Activities; recorded: Recorded } {
    const calls: string[] = [];
    const at = new Map<string, number>();
    const outcomes = [...(options.resolutions ?? [])];
    const failing = new Set(options.fail);
    const record = async (name: string) => {
      calls.push(name);
      at.set(name, scheduledAt());
      await options.on?.[name]?.();
      if (failing.delete(name)) {
        throw ApplicationFailure.nonRetryable(`${name} broke`, INVARIANT_BROKEN);
      }
    };
    const stored = options.stored ?? { state: 'unresolved' };
    const mocks: Activities = {
      // Not recorded: it runs first, then every six hours while the run waits.
      requestState: vi.fn((): Promise<RequestState> => Promise.resolve(stored.state)),
      decisionNotices: vi.fn(async (): Promise<DecisionNoticesOutcome> => {
        await record('decision-notices');
        return options.decided ?? 'granted';
      }),
      issuePackage: vi.fn(async (): Promise<PackageOutcome> => {
        await record('issue-package');
        if (options.issued) return { outcome: options.issued };
        return {
          outcome: 'issued',
          downloadExpiresAt: new Date(scheduledAt() + DOWNLOAD_DAYS * DAY_MS).toISOString(),
        };
      }),
      packageReady: vi.fn(async () => {
        await record('package-ready');
        return 'sent' as const;
      }),
      expirePackage: vi.fn(async () => {
        await record('expire-package');
        return 'expired' as const;
      }),
      resolution: vi.fn(async (): Promise<ResolutionOutcome> => {
        await record('resolution');
        const outcome = outcomes.shift() ?? 'notified';
        return outcome === 'notified'
          ? {
              outcome,
              windowEndsAt: new Date(scheduledAt() + WINDOW_DAYS * DAY_MS).toISOString(),
            }
          : { outcome };
      }),
      closeWindow: vi.fn(async (): Promise<WindowOutcome> => {
        await record('close-window');
        return 'under-decision';
      }),
      remindOfficer: vi.fn(async (request: OfficerReminderRequest) => {
        await record(`remind-${String(request.day)}`);
        return options.reminders?.[request.day] ?? 'sent';
      }),
    };
    return { mocks, recorded: { calls, at } };
  }

  const options = (mocks: Activities, input: AccessRequestWorkflowInput) => ({
    workflowsPath,
    activities: mocks,
    args: [input] as [AccessRequestWorkflowInput],
  });

  /** Days after receipt that `name` ran, to the minute. */
  const dayOf = (input: AccessRequestWorkflowInput, recorded: Recorded, name: string) =>
    Math.round(
      (((recorded.at.get(name) ?? Number.NaN) - new Date(input.submittedAt).getTime()) / DAY_MS) *
        1440,
    ) / 1440;

  it('S5: unresolved, the access officers are reminded at day 5 to identify the officer, then of the deadline at days 20 and 28', async () => {
    const input = await inputReceived();
    const { mocks, recorded } = activities({
      on: { 'remind-28': () => signalOwnWorkflow('withdrawn') },
    });

    const result = await env.execute(accessRequest, options(mocks, input));

    expect(result).toEqual({ outcome: 'withdrawn' });
    expect(recorded.calls).toEqual(['remind-5', 'remind-20', 'remind-28']);
    expect(dayOf(input, recorded, 'remind-5')).toBe(5);
    expect(dayOf(input, recorded, 'remind-20')).toBe(20);
    expect(dayOf(input, recorded, 'remind-28')).toBe(28);
    expect(mocks.remindOfficer).toHaveBeenCalledWith({ ...input, day: 5 });
    expect(mocks.resolution).not.toHaveBeenCalled();
  }, 60_000);

  it('S3: resolved, the declarant is notified; S5: the window elapses after 7 days and the request goes under decision, with the deadline reminders', async () => {
    const input = await inputReceived();
    const { mocks, recorded } = activities({
      on: {
        'remind-5': () => signalOwnWorkflow('resolved'),
        'remind-28': () => signalOwnWorkflow('decided'),
      },
    });

    const result = await env.execute(accessRequest, options(mocks, input));

    expect(result).toEqual({ outcome: 'decided' });
    expect(recorded.calls).toEqual([
      'remind-5',
      'resolution',
      'close-window',
      'remind-20',
      'remind-28',
      ...GRANT_STEPS,
    ]);
    expect(dayOf(input, recorded, 'resolution')).toBe(5);
    expect(dayOf(input, recorded, 'close-window')).toBe(5 + WINDOW_DAYS);
    expect(mocks.resolution).toHaveBeenCalledWith(input);
    expect(mocks.closeWindow).toHaveBeenCalledWith(input);
  }, 60_000);

  it('S3: resolved before day 5, the declarant is notified at once and no identification reminder follows', async () => {
    const input = await inputReceived();
    const { mocks, recorded } = activities({
      reminders: { 5: 'skipped' },
      on: { 'remind-20': () => signalOwnWorkflow('withdrawn') },
    });

    await env.run(accessRequest, options(mocks, input), async (handle) => {
      await env.skipTime({ ms: 2 * DAY_MS });
      await handle.signal('resolved');
      await env.skipTime({ ms: 25 * DAY_MS });
    });

    expect(recorded.calls.slice(0, 3)).toEqual(['resolution', 'remind-5', 'close-window']);
    expect(dayOf(input, recorded, 'resolution')).toBe(2);
    expect(dayOf(input, recorded, 'close-window')).toBe(2 + WINDOW_DAYS);
  }, 60_000);

  it('S4: consent ends the window at once', async () => {
    const input = await inputReceived();
    // Resolved on day 15: the window would close on day 22; consent comes on day 20.
    const { mocks, recorded } = activities({
      on: {
        'remind-20': () => signalOwnWorkflow('consented'),
        'remind-28': () => signalOwnWorkflow('decided'),
      },
    });

    await env.run(accessRequest, options(mocks, input), async (handle) => {
      await env.skipTime({ ms: 15 * DAY_MS });
      await handle.signal('resolved');
      await env.skipTime({ ms: 14 * DAY_MS });
      // Decided on day 28: the package's window would hold the run for 14 more days.
      await handle.terminate();
    });

    expect(recorded.calls.slice(0, 5)).toEqual([
      'remind-5',
      'resolution',
      'remind-20',
      'close-window',
      'remind-28',
    ]);
    expect(dayOf(input, recorded, 'close-window')).toBe(20);
  }, 60_000);

  it('S3: an officer who cannot be identified closes the request: no window, no more reminders', async () => {
    const input = await inputReceived();
    const { mocks, recorded } = activities({
      resolutions: ['cannot-identify'],
      on: { 'remind-5': () => signalOwnWorkflow('resolved') },
    });

    const result = await env.execute(accessRequest, options(mocks, input));

    expect(result).toEqual({ outcome: 'cannot-identify' });
    expect(recorded.calls).toEqual(['remind-5', 'resolution']);
    expect(mocks.closeWindow).not.toHaveBeenCalled();
  }, 60_000);

  it('a signal with no resolution behind it goes back to waiting for one', async () => {
    const input = await inputReceived();
    const { mocks, recorded } = activities({
      resolutions: ['unresolved', 'notified'],
      on: {
        'remind-5': () => signalOwnWorkflow('resolved'),
        'remind-20': () => signalOwnWorkflow('resolved'),
        'close-window': () => signalOwnWorkflow('decided'),
      },
    });

    const result = await env.execute(accessRequest, options(mocks, input));

    expect(result).toEqual({ outcome: 'decided' });
    expect(recorded.calls).toEqual([
      'remind-5',
      'resolution',
      'remind-20',
      'resolution',
      'close-window',
      ...GRANT_STEPS,
    ]);
    expect(dayOf(input, recorded, 'close-window')).toBe(20 + WINDOW_DAYS);
  }, 60_000);

  it('S8: withdrawn while the window is open ends the run before it closes', async () => {
    const input = await inputReceived();
    const { mocks } = activities({
      on: {
        'remind-5': () => signalOwnWorkflow('resolved'),
        resolution: () => signalOwnWorkflow('withdrawn'),
      },
    });

    const result = await env.execute(accessRequest, options(mocks, input));

    expect(result).toEqual({ outcome: 'withdrawn' });
    expect(mocks.closeWindow).not.toHaveBeenCalled();
    expect(mocks.remindOfficer).toHaveBeenCalledTimes(1);
  }, 60_000);

  it('S8: withdrawn before anything else ends the run with no reminder', async () => {
    const input = await inputReceived();
    const { mocks } = activities();

    const result = await env.run(accessRequest, options(mocks, input), async (handle) => {
      await handle.signal('withdrawn');
      return handle.result();
    });

    expect(result).toEqual({ outcome: 'withdrawn' });
    expect(mocks.remindOfficer).not.toHaveBeenCalled();
  }, 60_000);

  it('released late (a passport applicant verified on day 22): one deadline reminder at once, then day 28', async () => {
    const input = await inputReceived(22);
    const { mocks, recorded } = activities({
      on: { 'remind-28': () => signalOwnWorkflow('withdrawn') },
    });

    await env.execute(accessRequest, options(mocks, input));

    expect(recorded.calls).toEqual(['remind-20', 'remind-28']);
    expect(dayOf(input, recorded, 'remind-20')).toBe(22);
    expect(dayOf(input, recorded, 'remind-28')).toBe(28);
  }, 60_000);

  it('ends when a reminder finds the request not there', async () => {
    const input = await inputReceived();
    const { mocks } = activities({ reminders: { 5: 'missing' } });

    const result = await env.execute(accessRequest, options(mocks, input));

    expect(result).toEqual({ outcome: 'missing' });
    expect(mocks.remindOfficer).toHaveBeenCalledTimes(1);
  }, 60_000);

  it('the receipt rolled back after the workflow started: it ends at once, with no reminder', async () => {
    const input = await inputReceived();
    const { mocks, recorded } = activities({ stored: { state: 'missing' } });

    const result = await env.execute(accessRequest, options(mocks, input));

    expect(result).toEqual({ outcome: 'missing' });
    expect(recorded.calls).toEqual([]);
    expect(mocks.requestState).toHaveBeenCalledTimes(1);
    expect(mocks.requestState).toHaveBeenCalledWith(input);
  }, 60_000);

  it('a reminder that fails after its retries is passed over: the next one still goes', async () => {
    const input = await inputReceived();
    const { mocks, recorded } = activities({
      fail: ['remind-5'],
      on: { 'remind-20': () => signalOwnWorkflow('withdrawn') },
    });

    const result = await env.execute(accessRequest, options(mocks, input));

    expect(result).toEqual({ outcome: 'withdrawn' });
    expect(recorded.calls).toEqual(['remind-5', 'remind-20']);
  }, 60_000);

  describe('lost signals', () => {
    it('a lost `resolved` signal: the request read resolved has the declarant notified within 6 hours', async () => {
      const input = await inputReceived();
      const stored: Stored = { state: 'unresolved' };
      const { mocks, recorded } = activities({
        stored,
        on: {
          'remind-5': () => store(stored, 'resolved'),
          'close-window': () => signalOwnWorkflow('withdrawn'),
        },
      });

      const result = await env.execute(accessRequest, options(mocks, input));

      expect(result).toEqual({ outcome: 'withdrawn' });
      expect(recorded.calls.slice(0, 3)).toEqual(['remind-5', 'resolution', 'close-window']);
      // Read with the day-5 reminder, or at the next read six hours on.
      expect(dayOf(input, recorded, 'resolution')).toBeGreaterThanOrEqual(5);
      expect(dayOf(input, recorded, 'resolution')).toBeLessThanOrEqual(5.25);
    }, 60_000);

    it('a resolution whose notices fail after their retries is tried again at the next read', async () => {
      const input = await inputReceived();
      const { mocks, recorded } = activities({
        fail: ['resolution'],
        stored: { state: 'resolved' },
        on: { 'close-window': () => signalOwnWorkflow('withdrawn') },
      });

      await env.execute(accessRequest, options(mocks, input));

      expect(mocks.resolution).toHaveBeenCalledTimes(2);
      expect(dayOf(input, recorded, 'resolution')).toBe(0.5);
      expect(dayOf(input, recorded, 'close-window')).toBe(0.5 + WINDOW_DAYS);
    }, 60_000);

    it('a lost `withdrawn` signal before resolution: the request read withdrawn ends the run', async () => {
      const input = await inputReceived();
      const stored: Stored = { state: 'unresolved' };
      const { mocks } = activities({
        stored,
        on: {
          'remind-5': () => store(stored, 'withdrawn'),
        },
      });

      const result = await env.execute(accessRequest, options(mocks, input));

      expect(result).toEqual({ outcome: 'withdrawn' });
      expect(mocks.resolution).not.toHaveBeenCalled();
      expect(mocks.remindOfficer).toHaveBeenCalledTimes(1);
    }, 60_000);

    it('a lost `consented` signal: the request read under decision closes the window within 6 hours', async () => {
      const input = await inputReceived();
      const stored: Stored = { state: 'unresolved' };
      const { mocks, recorded } = activities({
        stored,
        on: {
          'remind-5': () => signalOwnWorkflow('resolved'),
          // The declarant consents right after their notice; its signal is lost.
          resolution: () => store(stored, 'under-decision'),
          'close-window': () => signalOwnWorkflow('withdrawn'),
        },
      });

      const result = await env.execute(accessRequest, options(mocks, input));

      expect(result).toEqual({ outcome: 'withdrawn' });
      expect(dayOf(input, recorded, 'close-window')).toBe(5.25);
    }, 60_000);
  });

  describe('held for verification (S2)', () => {
    it('a held request is reminded from receipt (days 5, 20, 28) while the applicant is unverified', async () => {
      const input = await inputReceived();
      const { mocks, recorded } = activities({
        stored: { state: 'held' },
        on: { 'remind-28': () => signalOwnWorkflow('withdrawn') },
      });

      const result = await env.execute(accessRequest, options(mocks, input));

      expect(result).toEqual({ outcome: 'withdrawn' });
      expect(recorded.calls).toEqual(['remind-5', 'remind-20', 'remind-28']);
      expect(dayOf(input, recorded, 'remind-5')).toBe(5);
      expect(mocks.resolution).not.toHaveBeenCalled();
    }, 60_000);

    it('verified, then resolved: the run waits for the officer named, then notifies the declarant', async () => {
      const input = await inputReceived();
      const stored: Stored = { state: 'held' };
      const { mocks, recorded } = activities({
        stored,
        on: {
          'close-window': () => signalOwnWorkflow('withdrawn'),
        },
      });

      await env.run(accessRequest, options(mocks, input), async (handle) => {
        await env.skipTime({ ms: 2 * DAY_MS });
        stored.state = 'unresolved';
        await handle.signal('verified');
        await env.skipTime({ ms: DAY_MS });
        stored.state = 'resolved';
        await handle.signal('resolved');
        await env.skipTime({ ms: 10 * DAY_MS });
        return handle.result();
      });

      expect(recorded.calls.slice(0, 2)).toEqual(['resolution', 'remind-5']);
      expect(dayOf(input, recorded, 'resolution')).toBe(3);
    }, 60_000);

    it('a resolution signalled while still held waits for the verification', async () => {
      const input = await inputReceived();
      const stored: Stored = { state: 'held' };
      const { mocks, recorded } = activities({
        stored,
        on: { 'close-window': () => signalOwnWorkflow('withdrawn') },
      });

      await env.run(accessRequest, options(mocks, input), async (handle) => {
        await env.skipTime({ ms: DAY_MS });
        await handle.signal('resolved');
        await env.skipTime({ ms: DAY_MS });
        stored.state = 'resolved';
        await handle.signal('verified');
        await env.skipTime({ ms: 10 * DAY_MS });
        return handle.result();
      });

      expect(dayOf(input, recorded, 'resolution')).toBe(2);
    }, 60_000);

    it('lost `verified` and `resolved` signals: the request read no longer held goes ahead', async () => {
      const input = await inputReceived();
      const stored: Stored = { state: 'held' };
      const { mocks, recorded } = activities({
        stored,
        on: {
          // Verified and resolved on day 5, both signals lost.
          'remind-5': () => store(stored, 'resolved'),
          'close-window': () => signalOwnWorkflow('withdrawn'),
        },
      });

      const result = await env.execute(accessRequest, options(mocks, input));

      expect(result).toEqual({ outcome: 'withdrawn' });
      // One read finds it verified, the next (at most six hours on) resolved.
      expect(dayOf(input, recorded, 'resolution')).toBeGreaterThan(5);
      expect(dayOf(input, recorded, 'resolution')).toBeLessThanOrEqual(5.5);
    }, 60_000);

    it('withdrawn while held ends the run', async () => {
      const input = await inputReceived();
      const stored: Stored = { state: 'held' };
      const { mocks } = activities({
        stored,
        on: {
          'remind-5': () => store(stored, 'withdrawn'),
        },
      });

      const result = await env.execute(accessRequest, options(mocks, input));

      expect(result).toEqual({ outcome: 'withdrawn' });
      expect(mocks.resolution).not.toHaveBeenCalled();
    }, 60_000);
  });

  describe('after the decision', () => {
    /** Resolved at day 5, window closed at day 12, `decided` signalled from the day-20 reminder. */
    const decidedOnDay20 = {
      'remind-5': () => signalOwnWorkflow('resolved'),
      'remind-20': () => signalOwnWorkflow('decided'),
    };

    it('S6: a grant: both parties told, the package issued and the applicant told; S7: expired at the end of its 14-day window', async () => {
      const input = await inputReceived();
      const { mocks, recorded } = activities({ on: decidedOnDay20 });

      const result = await env.execute(accessRequest, options(mocks, input));

      expect(result).toEqual({ outcome: 'decided' });
      expect(recorded.calls).toEqual([
        'remind-5',
        'resolution',
        'close-window',
        'remind-20',
        ...GRANT_STEPS,
      ]);
      expect(dayOf(input, recorded, 'decision-notices')).toBe(20);
      expect(dayOf(input, recorded, 'package-ready')).toBe(20);
      expect(dayOf(input, recorded, 'expire-package')).toBe(20 + DOWNLOAD_DAYS);
      for (const step of [
        mocks.decisionNotices,
        mocks.issuePackage,
        mocks.packageReady,
        mocks.expirePackage,
      ]) {
        expect(step).toHaveBeenCalledWith(input);
      }
      // The reminders stopped with the decision.
      expect(mocks.remindOfficer).toHaveBeenCalledTimes(2);
    }, 60_000);

    it('S6: a denial: both parties told, nothing issued', async () => {
      const input = await inputReceived();
      const { mocks, recorded } = activities({ decided: 'denied', on: decidedOnDay20 });

      const result = await env.execute(accessRequest, options(mocks, input));

      expect(result).toEqual({ outcome: 'decided' });
      expect(recorded.calls.slice(-1)).toEqual(['decision-notices']);
      expect(mocks.issuePackage).not.toHaveBeenCalled();
    }, 60_000);

    it('a grant with nothing to disclose in its scope ends with no package to announce or expire', async () => {
      const input = await inputReceived();
      const { mocks, recorded } = activities({ issued: 'nothing-to-disclose', on: decidedOnDay20 });

      const result = await env.execute(accessRequest, options(mocks, input));

      expect(result).toEqual({ outcome: 'decided' });
      expect(recorded.calls.slice(-2)).toEqual(['decision-notices', 'issue-package']);
    }, 60_000);

    it('a lost `decided` signal: the request is read every 6 hours, and the decision is carried out', async () => {
      const input = await inputReceived();
      const stored: Stored = { state: 'unresolved' };
      const { mocks, recorded } = activities({
        stored,
        on: {
          'remind-5': () => signalOwnWorkflow('resolved'),
          'close-window': () => store(stored, 'decided'),
        },
      });

      const result = await env.execute(accessRequest, options(mocks, input));

      expect(result).toEqual({ outcome: 'decided' });
      expect(recorded.calls).toEqual(['remind-5', 'resolution', 'close-window', ...GRANT_STEPS]);
      expect(dayOf(input, recorded, 'decision-notices')).toBe(5 + WINDOW_DAYS + 0.25);
      expect(mocks.requestState).toHaveBeenCalledWith(input);
      expect(mocks.remindOfficer).toHaveBeenCalledTimes(1);
    }, 60_000);

    it('a lost `withdrawn` signal: the request read withdrawn ends the run', async () => {
      const input = await inputReceived();
      const stored: Stored = { state: 'unresolved' };
      const { mocks } = activities({
        stored,
        on: {
          'remind-5': () => signalOwnWorkflow('resolved'),
          'close-window': () => store(stored, 'withdrawn'),
        },
      });

      const result = await env.execute(accessRequest, options(mocks, input));

      expect(result).toEqual({ outcome: 'withdrawn' });
      expect(mocks.decisionNotices).not.toHaveBeenCalled();
    }, 60_000);

    it('a step after the decision that fails without retrying fails the run', async () => {
      const input = await inputReceived();
      const { mocks, recorded } = activities({ on: decidedOnDay20, fail: ['issue-package'] });

      const failed = await env
        .execute(accessRequest, options(mocks, input))
        .catch((error: unknown) => error);

      expect(failed).toBeInstanceOf(WorkflowFailedError);
      expect(recorded.calls.slice(-2)).toEqual(['decision-notices', 'issue-package']);
      expect(mocks.packageReady).not.toHaveBeenCalled();
    }, 60_000);

    it('decided while the window still ran (the consent signal lost): the window closes and the decision is carried out', async () => {
      const input = await inputReceived();
      const { mocks, recorded } = activities({
        on: {
          'remind-5': () => signalOwnWorkflow('resolved'),
          resolution: () => signalOwnWorkflow('decided'),
        },
      });

      const result = await env.execute(accessRequest, options(mocks, input));

      expect(result).toEqual({ outcome: 'decided' });
      expect(recorded.calls).toEqual(['remind-5', 'resolution', 'close-window', ...GRANT_STEPS]);
      expect(dayOf(input, recorded, 'close-window')).toBe(5);
    }, 60_000);
  });
});
