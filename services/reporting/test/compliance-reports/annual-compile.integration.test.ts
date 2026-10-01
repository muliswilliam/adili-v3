import { randomUUID } from 'node:crypto';

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AnnualCompileSchedule } from '../../src/compliance-reports/annual-compile-schedule.js';
import {
  ANNUAL_COMPILE_WORKFLOW,
  annualCompileScheduleId,
  complianceReportWorkflowId,
} from '../../src/compliance-reports/contract.js';
import { config } from '../../src/config.js';
import { complianceReports } from '../../src/db/schema.js';
import { compiledReport, givenFy2027Facts, givenPscDirectory } from '../support/form-m-facts.js';
import { type ReportingApi, startReportingApi } from '../support/reporting-api.js';

/**
 * The yearly compile (spec 09: Form M is compiled at the end of each financial year): on 1 July
 * the service's Temporal schedule starts `annualCompile`, which compiles the draft of each
 * Commission for the year that just ended through its `ComplianceReportWorkflow`.
 */
describe('Form M yearly compile', () => {
  let api: ReportingApi;

  beforeAll(async () => {
    api = await startReportingApi();
    return async () => {
      await endWorkflows();
      await api.close();
    };
  });

  beforeEach(async () => {
    await endWorkflows();
    await api.reset();
    givenPscDirectory(api);
  });

  const endWorkflows = () => api.endWorkflows([complianceReportWorkflowId('psc', 2027)]);

  it('on 1 July compiles the draft of each Commission for the year that just ended; a submitted report is left alone', async () => {
    await givenFy2027Facts(api);
    // tsc submitted its FY 2027 report early (a federated Commission, say).
    await api.asPlatform((tx) =>
      tx.insert(complianceReports).values({
        id: randomUUID(),
        tenant: 'tsc',
        fy: 2027,
        status: 'submitted',
        source: 'federated',
        reference: 'RPT-TSC-2027-0000001-7',
        submittedAt: new Date('2028-07-01T01:00:00.000Z'),
        late: false,
      }),
    );
    api.clock.set('2028-07-01T03:00:00.000Z');

    const result: unknown = await api.temporal.workflow.execute(ANNUAL_COMPILE_WORKFLOW, {
      taskQueue: config.TEMPORAL_TASK_QUEUE,
      workflowId: `annual-compile-test-${randomUUID()}`,
      args: [],
    });

    expect(result).toEqual({ fy: 2027, started: 1 });
    const report = await compiledReport(api, 2027);
    expect(report).toMatchObject({
      status: 'draft',
      compiledAt: '2028-07-01T03:00:00.000Z',
      counts: { initial: { expected: 12, declared: 10, notDeclared: 2 } },
    });
    const reports = await api.asPlatform((tx) => tx.select().from(complianceReports));
    expect(reports.find((row) => row.tenant === 'tsc')).toMatchObject({ status: 'submitted' });
  });

  it('keeps a Temporal schedule that starts the yearly compile at 06:00 on 1 July in Nairobi', async () => {
    const schedule = api.app.get(AnnualCompileSchedule);
    const scheduleId = await schedule.ensureSchedule('0 6 1 7 *');
    const handle = api.temporal.schedule.getHandle(scheduleId);
    try {
      expect(scheduleId).toBe(annualCompileScheduleId(config.TEMPORAL_TASK_QUEUE));
      const described = await handle.describe();
      expect(described.action).toMatchObject({
        type: 'startWorkflow',
        workflowType: ANNUAL_COMPILE_WORKFLOW,
        taskQueue: config.TEMPORAL_TASK_QUEUE,
      });
      expect(described.spec.timezone).toBe('Africa/Nairobi');
      const [calendar] = described.spec.calendars ?? [];
      expect(calendar).toMatchObject({
        month: [{ start: 'JULY', end: 'JULY', step: 1 }],
        dayOfMonth: [{ start: 1, end: 1, step: 1 }],
        hour: [{ start: 6, end: 6, step: 1 }],
      });

      // Kept again on the next start: the existing schedule is updated, not duplicated.
      await schedule.ensureSchedule('0 7 1 7 *');
      expect((await handle.describe()).spec.calendars?.[0]?.hour).toEqual([
        { start: 7, end: 7, step: 1 },
      ]);
    } finally {
      await handle.delete();
    }
  });
});
