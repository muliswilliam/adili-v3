import { fileURLToPath } from 'node:url';

import { WorkflowTestEnvironment } from '@adili/temporal/testing';
import { Context } from '@temporalio/activity';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { EnforcementActivities } from '../../src/enforcement/activities.js';
import {
  type ActionDecision,
  type ActionNotice,
  type ActionRef,
  CLOSED_SIGNAL,
  type CloseRequest,
  DECIDED_SIGNAL,
  type EnforcementInput,
  type LadderStep,
  type OpenedLadder,
  type StepRequest,
} from '../../src/enforcement/contract.js';
import type { ClosingCause } from '../../src/enforcement/schema.js';
import { enforcement } from '../../src/enforcement/workflows.js';

/**
 * `EnforcementWorkflow` against mocked activities in Temporal's time-skipping test environment
 * (S5, S7, S8, S11 at the workflow seam): the notice drafted and held for a decision, issued once
 * approved (letter, email, SMS), the warning drafted when the notice's window ends, a decline
 * ending the ladder, a restart drafting the declined step again, and compliance closing the
 * ladder at any point.
 */
const workflowsPath = fileURLToPath(new URL('../../src/processing/workflows.ts', import.meta.url));

type Activities = { [K in keyof EnforcementActivities]: EnforcementActivities[K] };

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 14;

const input: EnforcementInput = {
  tenant: 'psc',
  subjectKind: 'obligation',
  subjectId: '0199b000-0000-7000-8000-0000000000a1',
};
const LADDER_ID = '0199b000-0000-7000-8000-0000000000b1';
const actionIdOf = (step: LadderStep) =>
  step === 'notice-to-comply'
    ? '0199b000-0000-7000-8000-0000000000c1'
    : '0199b000-0000-7000-8000-0000000000c2';

describe('EnforcementWorkflow', () => {
  let env: WorkflowTestEnvironment;

  beforeAll(async () => {
    env = await WorkflowTestEnvironment.create();
  }, 120_000);

  afterAll(async () => {
    await env.teardown();
  });

  /** The workflow time an activity was scheduled at (time-skipping moves it, not the wall clock). */
  const scheduledAt = () => Context.current().info.currentAttemptScheduledTimestampMs;

  /** Signals the workflow running the current activity, as the review service would. */
  const signalOwnWorkflow = (signal: string, ...args: unknown[]) => {
    const { workflowExecution } = Context.current().info;
    if (!workflowExecution) throw new Error('Not an activity of a workflow');
    return env.env.client.workflow.getHandle(workflowExecution.workflowId).signal(signal, ...args);
  };

  interface Recorded {
    calls: string[];
    /** Workflow time of each call, by name. */
    at: Map<string, number>;
  }

  type Decision = 'approved' | 'declined';

  /**
   * Activities that record what ran and when. Each drafted step is decided as `decide` says: the
   * officer's decision is signalled as soon as the draft is made (the default approves every
   * step). `markIssued` answers a window of fourteen days from the time it runs. `on` runs extra
   * work inside an activity.
   */
  function activities(
    options: {
      opened?: OpenedLadder;
      decide?: Partial<Record<LadderStep, Decision | 'silent'>>;
      overrides?: Partial<Activities>;
      on?: Partial<Record<string, () => Promise<void>>>;
    } = {},
  ): { mocks: Activities; recorded: Recorded } {
    const calls: string[] = [];
    const at = new Map<string, number>();
    const decisions = new Map<string, Decision>();
    const stepOf = new Map<string, LadderStep>();
    const record = async (name: string) => {
      calls.push(name);
      at.set(name, scheduledAt());
      await options.on?.[name]?.();
    };
    const mocks: Activities = {
      openLadder: vi.fn(async (): Promise<OpenedLadder> => {
        await record('open');
        return options.opened ?? { outcome: 'opened', ladderId: LADDER_ID };
      }),
      proposeStep: vi.fn(async ({ step }: StepRequest) => {
        const actionId = actionIdOf(step);
        stepOf.set(actionId, step);
        await record(`propose:${step}`);
        const decision = options.decide?.[step] ?? 'approved';
        if (decision !== 'silent') {
          decisions.set(actionId, decision);
          await signalOwnWorkflow(DECIDED_SIGNAL);
        }
        return { actionId };
      }),
      actionDecision: vi.fn(async ({ actionId }: ActionRef): Promise<ActionDecision> => {
        await record(`decision:${stepOf.get(actionId) ?? actionId}`);
        return decisions.get(actionId) ?? 'proposed';
      }),
      issueLetter: vi.fn(async ({ actionId }: ActionRef) => {
        await record(`letter:${stepOf.get(actionId) ?? actionId}`);
        return 'requested' as const;
      }),
      notifyAction: vi.fn(async ({ actionId, channel }: ActionNotice) => {
        await record(`${channel}:${stepOf.get(actionId) ?? actionId}`);
        return 'sent' as const;
      }),
      markIssued: vi.fn(async ({ actionId }: ActionRef) => {
        const issuedAt = scheduledAt();
        await record(`issued:${stepOf.get(actionId) ?? actionId}`);
        return { windowEndsAt: new Date(issuedAt + WINDOW_DAYS * DAY_MS).toISOString() };
      }),
      closeLadder: vi.fn(async ({ cause }: CloseRequest) => {
        await record(`close:${cause}`);
        return true;
      }),
      ...options.overrides,
    };
    // An officer approving a step whose draft was not signalled (a lost signal) is found later.
    for (const [step, decision] of Object.entries(options.decide ?? {})) {
      if (decision === 'silent') decisions.set(actionIdOf(step as LadderStep), 'approved');
    }
    return { mocks, recorded: { calls, at } };
  }

  const run = (mocks: Activities, args: EnforcementInput = input) =>
    env.execute(enforcement, { workflowsPath, activities: mocks, args: [args] });

  /** Days between two recorded calls, to the minute. */
  const daysBetween = (recorded: Recorded, from: string, to: string) =>
    Math.round((((recorded.at.get(to) ?? 0) - (recorded.at.get(from) ?? 0)) / DAY_MS) * 1440) /
    1440;

  /** The ladder closes for `cause` as soon as `step` is issued. */
  const closeWhenIssued = (step: LadderStep, cause: ClosingCause = 'filed') => ({
    [`issued:${step}`]: () => signalOwnWorkflow(CLOSED_SIGNAL, cause),
  });

  it('S5: drafts the notice, issues it once approved, drafts the warning when the window ends', async () => {
    const { mocks, recorded } = activities({ on: closeWhenIssued('warning') });

    const result = await run(mocks);

    expect(result).toEqual({ outcome: 'complied', cause: 'filed' });
    expect(recorded.calls).toEqual([
      'open',
      'propose:notice-to-comply',
      'decision:notice-to-comply',
      'letter:notice-to-comply',
      'email:notice-to-comply',
      'sms:notice-to-comply',
      'issued:notice-to-comply',
      'propose:warning',
      'decision:warning',
      'letter:warning',
      'email:warning',
      'sms:warning',
      'issued:warning',
      'close:filed',
    ]);
    expect(daysBetween(recorded, 'issued:notice-to-comply', 'propose:warning')).toBe(WINDOW_DAYS);
    expect(mocks.openLadder).toHaveBeenCalledWith(input);
    expect(mocks.proposeStep).toHaveBeenCalledWith({
      tenant: 'psc',
      ladderId: LADDER_ID,
      step: 'notice-to-comply',
    });
    expect(mocks.closeLadder).toHaveBeenCalledWith({
      tenant: 'psc',
      ladderId: LADDER_ID,
      cause: 'filed',
    });
  }, 60_000);

  it('S5: after the warning, the ladder drafts nothing more (#209) and waits for compliance', async () => {
    const { mocks, recorded } = activities();

    // Nothing but a signal can end the wait: the test server runs out the execution's time.
    await expect(run(mocks)).rejects.toThrow(/timed out/);

    expect(recorded.calls.at(-1)).toBe('issued:warning');
    expect(mocks.closeLadder).not.toHaveBeenCalled();
  }, 60_000);

  it('S5: a drafted step waits for its decision; nothing is issued before it', async () => {
    const { mocks, recorded } = activities({
      decide: { 'notice-to-comply': 'silent' },
      on: closeWhenIssued('notice-to-comply'),
    });

    await run(mocks);

    // No signal came: the step is read again a day later, found approved and issued.
    expect(daysBetween(recorded, 'propose:notice-to-comply', 'letter:notice-to-comply')).toBe(1);
  }, 60_000);

  it('S5: a decision signalled before its transaction commits is read again each second', async () => {
    let reads = 0;
    const { mocks, recorded } = activities({
      on: closeWhenIssued('notice-to-comply'),
      overrides: {
        actionDecision: vi.fn(({ actionId }: ActionRef): Promise<ActionDecision> => {
          recorded.calls.push('decision');
          if (actionId !== actionIdOf('notice-to-comply')) return Promise.resolve('approved');
          reads += 1;
          return Promise.resolve(reads < 3 ? 'proposed' : 'approved');
        }),
      },
    });

    await run(mocks);

    expect(reads).toBe(3);
    const seconds =
      ((recorded.at.get('letter:notice-to-comply') ?? 0) -
        (recorded.at.get('propose:notice-to-comply') ?? 0)) /
      1000;
    expect(seconds).toBeGreaterThanOrEqual(2);
    expect(seconds).toBeLessThan(60);
  }, 60_000);

  it('S8: a declined notice ends the ladder: no letter, no warning', async () => {
    const { mocks, recorded } = activities({ decide: { 'notice-to-comply': 'declined' } });

    const result = await run(mocks);

    expect(result).toEqual({ outcome: 'declined', step: 'notice-to-comply' });
    expect(recorded.calls).toEqual([
      'open',
      'propose:notice-to-comply',
      'decision:notice-to-comply',
    ]);
    expect(mocks.closeLadder).not.toHaveBeenCalled();
  }, 60_000);

  it('S8: a restart drafts the declined step again, not the ones before it', async () => {
    const { mocks, recorded } = activities({ decide: { warning: 'declined' } });

    const result = await run(mocks, { ...input, restartAt: 'warning' });

    expect(result).toEqual({ outcome: 'declined', step: 'warning' });
    expect(recorded.calls).toEqual(['open', 'propose:warning', 'decision:warning']);
  }, 60_000);

  it('S7: filing during the notice window closes the ladder: complied, no warning', async () => {
    const { mocks, recorded } = activities({
      on: { 'issued:notice-to-comply': () => signalOwnWorkflow(CLOSED_SIGNAL, 'filed') },
    });

    const result = await run(mocks);

    expect(result).toEqual({ outcome: 'complied', cause: 'filed' });
    expect(recorded.calls.at(-1)).toBe('close:filed');
    expect(recorded.calls).not.toContain('propose:warning');
    expect(daysBetween(recorded, 'issued:notice-to-comply', 'close:filed')).toBeLessThan(1);
  }, 60_000);

  it('S7: filing while the notice waits for a decision closes the ladder; nothing is issued', async () => {
    const { mocks, recorded } = activities({
      decide: { 'notice-to-comply': 'silent' },
      on: { 'propose:notice-to-comply': () => signalOwnWorkflow(CLOSED_SIGNAL, 'filed') },
    });

    const result = await run(mocks);

    expect(result).toEqual({ outcome: 'complied', cause: 'filed' });
    expect(recorded.calls).toEqual(['open', 'propose:notice-to-comply', 'close:filed']);
  }, 60_000);

  it('S11: a clarification ladder closes when the declarant responds', async () => {
    const clarificationInput: EnforcementInput = {
      tenant: 'psc',
      subjectKind: 'clarification',
      subjectId: '0199b000-0000-7000-8000-0000000000d1',
    };
    const { mocks, recorded } = activities({
      on: {
        'issued:notice-to-comply': () =>
          signalOwnWorkflow(CLOSED_SIGNAL, 'clarification-responded'),
      },
    });

    const result = await run(mocks, clarificationInput);

    expect(result).toEqual({ outcome: 'complied', cause: 'clarification-responded' });
    expect(mocks.openLadder).toHaveBeenCalledWith(clarificationInput);
    expect(recorded.calls.at(-1)).toBe('close:clarification-responded');
  }, 60_000);

  it('a withdrawn clarification ends the ladder without compliance', async () => {
    const { mocks } = activities({
      on: {
        'issued:notice-to-comply': () =>
          signalOwnWorkflow(CLOSED_SIGNAL, 'clarification-withdrawn'),
      },
    });

    const result = await run(mocks);

    expect(result).toEqual({ outcome: 'ended', cause: 'clarification-withdrawn' });
  }, 60_000);

  it.each([
    [{ outcome: 'not-owed', cause: 'filed' } as const, 'not-owed'],
    [{ outcome: 'missing' } as const, 'missing'],
    [{ outcome: 'closed' } as const, 'closed'],
  ])(
    'a subject not owed, missing or with a closed ladder drafts nothing (%j)',
    async (opened, outcome) => {
      const { mocks, recorded } = activities({ opened });

      const result = await run(mocks);

      expect(result).toEqual({ outcome });
      expect(recorded.calls).toEqual(['open']);
    },
    60_000,
  );
});
