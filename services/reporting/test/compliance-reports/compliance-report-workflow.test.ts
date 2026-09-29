import { fileURLToPath } from 'node:url';

import { WorkflowTestEnvironment } from '@adili/temporal/testing';
import { Context } from '@temporalio/activity';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { ComplianceReportActivities } from '../../src/compliance-reports/activities.js';
import {
  type Aggregate,
  type CompileOutcome,
  RECOMPILE_SIGNAL,
  type ReportWorkflowInput,
  SUBMITTED_SIGNAL,
} from '../../src/compliance-reports/contract.js';
import { complianceReport } from '../../src/compliance-reports/workflows.js';

/**
 * `ComplianceReportWorkflow` against mocked activities in Temporal's time-skipping test
 * environment: the compile on start (aggregate, compile, notify), recompiles on signal without a
 * second notice, a recompile asked for during a compile, and the end on submission.
 */
const workflowsPath = fileURLToPath(
  new URL('../../src/compliance-reports/workflows.ts', import.meta.url),
);

type Activities = { [K in keyof ComplianceReportActivities]: ComplianceReportActivities[K] };

const input: ReportWorkflowInput = { tenant: 'psc', fy: 2027 };
const REPORT_ID = '0199b000-0000-7000-8000-00000000a001';

const AGGREGATE: Aggregate = {
  counts: {
    initial: { expected: 12, declared: 10, notDeclared: 2 },
    biennial: { expected: 100, declared: 95, notDeclared: 5, noCycleInPeriod: false },
    final: { expected: 4, declared: 3, notDeclared: 1 },
    clarifications: 1,
    accessRequests: { received: 0, granted: 0, declined: 0 },
  },
  nonFilers: { initial: [], biennial: [], final: [] },
  clarificationIds: [],
};

describe('ComplianceReportWorkflow', () => {
  let env: WorkflowTestEnvironment;

  beforeAll(async () => {
    env = await WorkflowTestEnvironment.create();
  }, 120_000);

  afterAll(async () => {
    await env.teardown();
  });

  /** Sends `signal` to the workflow running the current activity, as the service would. */
  const signalOwnWorkflow = (signal: string) => {
    const { workflowExecution } = Context.current().info;
    if (!workflowExecution) throw new Error('Not an activity of a workflow');
    return env.env.client.workflow.getHandle(workflowExecution.workflowId).signal(signal);
  };

  /**
   * Activities that record what ran. `onCompile(n)` runs inside the n-th compile (from 1) and
   * `onNotify` inside the notice, e.g. to signal the workflow as a supervisor would.
   */
  function activities(
    options: {
      outcome?: (n: number) => CompileOutcome;
      onCompile?: (n: number) => Promise<void>;
      onNotify?: () => Promise<void>;
    } = {},
  ): { mocks: Activities; calls: string[] } {
    const calls: string[] = [];
    let compiles = 0;
    const mocks: Activities = {
      aggregate: vi.fn(() => {
        calls.push('aggregate');
        return Promise.resolve(AGGREGATE);
      }),
      compileDraft: vi.fn(async (): Promise<CompileOutcome> => {
        compiles += 1;
        calls.push('compile');
        await options.onCompile?.(compiles);
        return (
          options.outcome?.(compiles) ?? {
            outcome: 'saved',
            reportId: REPORT_ID,
            first: compiles === 1,
            issues: 0,
          }
        );
      }),
      notifyDraftReady: vi.fn(async () => {
        calls.push('notify');
        await options.onNotify?.();
        return 2;
      }),
    };
    return { mocks, calls };
  }

  const run = (mocks: Activities) =>
    env.execute(complianceReport, { workflowsPath, activities: mocks, args: [input] });

  it('S2: compiles the draft from the aggregate and tells the officers once; ends when submitted', async () => {
    const { mocks, calls } = activities({
      onNotify: () => signalOwnWorkflow(SUBMITTED_SIGNAL),
    });

    const result = await run(mocks);

    expect(result).toEqual({ compiles: 1 });
    expect(calls).toEqual(['aggregate', 'compile', 'notify']);
    expect(mocks.aggregate).toHaveBeenCalledWith(input);
    expect(mocks.compileDraft).toHaveBeenCalledWith({ ...input, aggregate: AGGREGATE });
    expect(mocks.notifyDraftReady).toHaveBeenCalledWith({ ...input, reportId: REPORT_ID });
  }, 60_000);

  it('S3: a recompile signal compiles again from fresh facts without a second notice', async () => {
    const { mocks, calls } = activities({
      onNotify: () => signalOwnWorkflow(RECOMPILE_SIGNAL),
      onCompile: async (n) => {
        if (n === 2) await signalOwnWorkflow(SUBMITTED_SIGNAL);
      },
    });

    const result = await run(mocks);

    expect(result).toEqual({ compiles: 2 });
    expect(calls).toEqual(['aggregate', 'compile', 'notify', 'aggregate', 'compile']);
  }, 60_000);

  it('S3: a recompile asked for while a compile runs is compiled once more after it', async () => {
    const { mocks, calls } = activities({
      onCompile: async (n) => {
        if (n === 1) await signalOwnWorkflow(RECOMPILE_SIGNAL);
        if (n === 2) await signalOwnWorkflow(SUBMITTED_SIGNAL);
      },
    });

    const result = await run(mocks);

    expect(result).toEqual({ compiles: 2 });
    expect(calls).toEqual(['aggregate', 'compile', 'notify', 'aggregate', 'compile']);
  }, 60_000);

  it('ends without a notice when the report turns out submitted', async () => {
    const { mocks, calls } = activities({
      outcome: () => ({ outcome: 'submitted', reportId: REPORT_ID }),
    });

    const result = await run(mocks);

    expect(result).toEqual({ compiles: 1 });
    expect(calls).toEqual(['aggregate', 'compile']);
  }, 60_000);
});
