import { fileURLToPath } from 'node:url';

import { WorkflowTestEnvironment } from '@adili/temporal/testing';
import { Context } from '@temporalio/activity';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AnnualCompileActivities } from '../../src/compliance-reports/annual-compile-activities.js';
import type { ComplianceReportActivities } from '../../src/compliance-reports/activities.js';
import {
  type Aggregate,
  type CompileOutcome,
  RECOMPILE_SIGNAL,
  type ReminderOutcome,
  type ReminderRequest,
  reminderAt,
  type ReportWorkflowInput,
  SUBMITTED_SIGNAL,
} from '../../src/compliance-reports/contract.js';
import { annualCompile, complianceReport } from '../../src/compliance-reports/workflows.js';
import { financialYearAt } from '../../src/financial-year.js';

/**
 * `ComplianceReportWorkflow` and the yearly compile against mocked activities in Temporal's
 * time-skipping test environment: the compile on start (aggregate, compile, notify), recompiles on
 * signal without a second notice, a recompile asked for during a compile, the deadline reminders
 * while the report is not submitted, and the end on submission (PDF and receipt, notices).
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
  declineReasons: [],
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
   * Activities that record what ran. `onCompile(n)` runs inside the n-th compile (from 1),
   * `onNotify` inside the notice and `onRemind(days)` inside a reminder, e.g. to signal the
   * workflow as a supervisor or the confirm endpoint would. Reminders record the (skipped) time
   * they were scheduled at.
   */
  function activities(
    options: {
      outcome?: (n: number) => CompileOutcome;
      onCompile?: (n: number) => Promise<void>;
      onNotify?: () => Promise<void>;
      onRemind?: (daysBefore: number) => Promise<ReminderOutcome | undefined>;
    } = {},
  ): { mocks: Activities; calls: string[]; remindedAt: number[] } {
    const calls: string[] = [];
    const remindedAt: number[] = [];
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
      remind: vi.fn(async ({ daysBefore }: ReminderRequest): Promise<ReminderOutcome> => {
        calls.push(`remind:${String(daysBefore)}`);
        remindedAt.push(Context.current().info.scheduledTimestampMs);
        return (await options.onRemind?.(daysBefore)) ?? { outcome: 'sent', recipients: 2 };
      }),
      issueSubmissionDocuments: vi.fn(() => {
        calls.push('issue');
        return Promise.resolve({
          reportId: REPORT_ID,
          formMDocumentId: '0199b000-0000-7000-8000-00000000d001',
          receiptDocumentId: '0199b000-0000-7000-8000-00000000d002',
        });
      }),
      notifySubmitted: vi.fn(() => {
        calls.push('notify-submitted');
        return Promise.resolve(2);
      }),
    };
    return { mocks, calls, remindedAt };
  }

  const run = (mocks: Activities, args: ReportWorkflowInput = input) =>
    env.execute(complianceReport, { workflowsPath, activities: mocks, args: [args] });

  it('S2: compiles the draft from the aggregate and tells the officers once; ends when submitted', async () => {
    const { mocks, calls } = activities({
      onNotify: () => signalOwnWorkflow(SUBMITTED_SIGNAL),
    });

    const result = await run(mocks);

    expect(result).toEqual({ compiles: 1, reminders: 0 });
    expect(calls).toEqual(['aggregate', 'compile', 'notify', 'issue', 'notify-submitted']);
    expect(mocks.aggregate).toHaveBeenCalledWith(input);
    expect(mocks.compileDraft).toHaveBeenCalledWith({ ...input, aggregate: AGGREGATE });
    expect(mocks.notifyDraftReady).toHaveBeenCalledWith({ ...input, reportId: REPORT_ID });
  }, 60_000);

  it('S6: on submission issues the Form M PDF and receipt, then tells both officers, by ids only', async () => {
    const { mocks } = activities({ onNotify: () => signalOwnWorkflow(SUBMITTED_SIGNAL) });

    await run(mocks);

    expect(mocks.issueSubmissionDocuments).toHaveBeenCalledWith(input);
    expect(mocks.notifySubmitted).toHaveBeenCalledWith({ ...input, reportId: REPORT_ID });
  }, 60_000);

  it('S3: a recompile signal compiles again from fresh facts without a second notice', async () => {
    const { mocks, calls } = activities({
      onNotify: () => signalOwnWorkflow(RECOMPILE_SIGNAL),
      onCompile: async (n) => {
        if (n === 2) await signalOwnWorkflow(SUBMITTED_SIGNAL);
      },
    });

    const result = await run(mocks);

    expect(result).toEqual({ compiles: 2, reminders: 0 });
    expect(calls).toEqual([
      'aggregate',
      'compile',
      'notify',
      'aggregate',
      'compile',
      'issue',
      'notify-submitted',
    ]);
  }, 60_000);

  it('S3: a recompile asked for while a compile runs is compiled once more after it', async () => {
    const { mocks, calls } = activities({
      onCompile: async (n) => {
        if (n === 1) await signalOwnWorkflow(RECOMPILE_SIGNAL);
        if (n === 2) await signalOwnWorkflow(SUBMITTED_SIGNAL);
      },
    });

    const result = await run(mocks);

    expect(result).toEqual({ compiles: 2, reminders: 0 });
    expect(calls.slice(0, 5)).toEqual(['aggregate', 'compile', 'notify', 'aggregate', 'compile']);
  }, 60_000);

  it('issues the documents without a notice when the compile finds the report submitted', async () => {
    const { mocks, calls } = activities({
      outcome: () => ({ outcome: 'submitted', reportId: REPORT_ID }),
    });

    const result = await run(mocks);

    expect(result).toEqual({ compiles: 1, reminders: 0 });
    expect(calls).toEqual(['aggregate', 'compile', 'issue', 'notify-submitted']);
  }, 60_000);

  it('S7: sends no reminder whose time passed before the workflow started', async () => {
    // FY 2025 was due on 31 July 2026, before the test server's clock starts.
    const { mocks, calls } = activities({
      onNotify: () => signalOwnWorkflow(SUBMITTED_SIGNAL),
    });

    const result = await run(mocks, { tenant: 'psc', fy: 2025 });

    expect(result).toEqual({ compiles: 1, reminders: 0 });
    expect(calls.some((call) => call.startsWith('remind'))).toBe(false);
  }, 60_000);

  it('S7: the reminders fall 14, 7 and 1 days before 31 July at 09:00 in Nairobi', () => {
    // FY 2027 is due on 31 July 2028: 17, 24 and 30 July at 06:00 UTC.
    expect([14, 7, 1].map((days) => new Date(reminderAt(2027, days)).toISOString())).toEqual([
      '2028-07-17T06:00:00.000Z',
      '2028-07-24T06:00:00.000Z',
      '2028-07-30T06:00:00.000Z',
    ]);
  });

  /**
   * Each reminder test skips the test server's clock forward by months, so each gets a fresh
   * server, and the financial year whose reminders come next from its clock.
   */
  describe('deadline reminders', () => {
    let fy: number;

    beforeEach(async () => {
      await env.teardown();
      env = await WorkflowTestEnvironment.create();
      const now = await env.env.currentTimeMs();
      const current = financialYearAt(new Date(now));
      fy = reminderAt(current - 1, 14) > now ? current - 1 : current;
    }, 120_000);

    it('S7: reminds 14, 7 and 1 days before 31 July while the report is not submitted', async () => {
      const { mocks, calls, remindedAt } = activities({
        onRemind: async (days) => {
          if (days === 1) await signalOwnWorkflow(SUBMITTED_SIGNAL);
          return undefined;
        },
      });

      const result = await run(mocks, { tenant: 'psc', fy });

      expect(result).toEqual({ compiles: 1, reminders: 3 });
      expect(calls).toEqual([
        'aggregate',
        'compile',
        'notify',
        'remind:14',
        'remind:7',
        'remind:1',
        'issue',
        'notify-submitted',
      ]);
      expect(mocks.remind).toHaveBeenNthCalledWith(1, { tenant: 'psc', fy, daysBefore: 14 });
      for (const [i, days] of [14, 7, 1].entries()) {
        const at = remindedAt[i] ?? 0;
        expect(at).toBeGreaterThanOrEqual(reminderAt(fy, days));
        expect(at).toBeLessThan(reminderAt(fy, days) + 60_000);
      }
    }, 60_000);

    it('S7: sends no reminder after submission', async () => {
      const { mocks, calls } = activities({
        onRemind: async (days) => {
          if (days === 7) await signalOwnWorkflow(SUBMITTED_SIGNAL);
          return undefined;
        },
      });

      const result = await run(mocks, { tenant: 'psc', fy });

      expect(result).toEqual({ compiles: 1, reminders: 2 });
      expect(calls.filter((call) => call.startsWith('remind'))).toEqual(['remind:14', 'remind:7']);
      expect(calls.slice(-2)).toEqual(['issue', 'notify-submitted']);
    }, 60_000);

    it('S7: a reminder that finds the report submitted ends the reminders', async () => {
      const { mocks, calls } = activities({
        onRemind: () => Promise.resolve({ outcome: 'submitted' }),
      });

      const result = await run(mocks, { tenant: 'psc', fy });

      expect(result).toEqual({ compiles: 1, reminders: 0 });
      expect(calls).toEqual([
        'aggregate',
        'compile',
        'notify',
        'remind:14',
        'issue',
        'notify-submitted',
      ]);
    }, 60_000);
  });
});

describe('annualCompile', () => {
  let env: WorkflowTestEnvironment;

  beforeAll(async () => {
    env = await WorkflowTestEnvironment.create();
  }, 120_000);

  afterAll(async () => {
    await env.teardown();
  });

  it('starts the compile of each Commission for the financial year that just ended', async () => {
    const started: ReportWorkflowInput[] = [];
    const mocks: { [K in keyof AnnualCompileActivities]: AnnualCompileActivities[K] } = {
      annualCompileTargets: vi.fn(() => Promise.resolve({ fy: 2027, tenants: ['psc', 'tsc'] })),
      startCompile: vi.fn((request: ReportWorkflowInput) => {
        started.push(request);
        // tsc submitted already: nothing to start.
        return Promise.resolve(request.tenant === 'psc');
      }),
    };

    const result = await env.execute(annualCompile, { workflowsPath, activities: mocks, args: [] });

    expect(result).toEqual({ fy: 2027, started: 1 });
    expect(started).toEqual([
      { tenant: 'psc', fy: 2027 },
      { tenant: 'tsc', fy: 2027 },
    ]);
  }, 60_000);
});
