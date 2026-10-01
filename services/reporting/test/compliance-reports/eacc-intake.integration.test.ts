import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  complianceReportWorkflowId,
  NATIONAL_CHASE_START_WORKFLOW,
  nationalChaseScheduleId,
  nationalConsolidationWorkflowId,
  NCR_APPROVED_SIGNAL,
} from '../../src/compliance-reports/contract.js';
import { NationalChaseActivities } from '../../src/compliance-reports/national-chase-activities.js';
import { NationalChaseSchedule } from '../../src/compliance-reports/national-chase-schedule.js';
import { config } from '../../src/config.js';
import { complianceReports, reportChases, reportReceipts } from '../../src/db/schema.js';
import { contractErrors, okResponse } from '../support/contract.js';
import { asTsc, REPORTS_SUBMIT, TSC_SYSTEM, validFormM } from '../support/federated.js';
import {
  COMMISSION_ADMIN,
  compiledReport,
  givenFy2027Facts,
  givenPscDirectory,
  type ReportBody,
  REPORTING_OFFICER,
  steppedUp,
  SUPERVISOR,
} from '../support/form-m-facts.js';
import { type Caller, type ReportingApi, startReportingApi } from '../support/reporting-api.js';
import { historyPayloads } from '../support/workflow-history.js';

/**
 * S9 and S10 through the HTTP API and the workflows on Temporal. FY 2027: `psc` confirms its
 * report on time on the platform, `tsc`'s own system files late, `jsc` has not reported. EACC's
 * intake shows each with its status, rates and outliers; EACC opens a report as filed with its
 * PDF, the read audited; the authorisation rows of the matrix. From 1 August the chase emails the
 * non-reporting Commissions' reporting officers and commission-admins weekly, with events, ids
 * and counts only in Temporal history.
 */
describe('EACC intake, report viewer and chase (S9, S10)', () => {
  let api: ReportingApi;

  const EACC_ANALYST: Caller = { sub: 'eacc-analyst-1', tenant: 'eacc', roles: ['eacc-analyst'] };
  const EACC_SUPERVISOR: Caller = {
    sub: 'eacc-supervisor-1',
    tenant: 'eacc',
    roles: ['eacc-supervisor'],
  };
  const PSC_REVIEWER: Caller = { sub: 'reviewer-psc', tenant: 'psc', roles: ['reviewer'] };

  const COMPILED_AT = '2028-07-01T06:00:00.000Z';
  const CONFIRMED_AT = '2028-07-20T07:00:00.000Z';
  const LATE_AT = '2028-08-05T07:00:00.000Z';
  const INTAKE = '/v1/eacc/compliance-reports';
  const viewer = (reportId: string) => `${INTAKE}/${reportId}`;

  beforeAll(async () => {
    api = await startReportingApi();
  });

  afterAll(async () => {
    await endWorkflows();
    await api.close();
  });

  /** Ends the workflows a test left waiting. */
  const endWorkflows = () =>
    api.endWorkflows([
      ...['psc', 'tsc', 'jsc'].map((tenant) => complianceReportWorkflowId(tenant, 2027)),
      nationalConsolidationWorkflowId(2025),
    ]);

  /**
   * Waits for the report workflow to end: its activities (the PDF and receipt, the emails) write
   * rows the next test's reset truncates, and terminating a workflow does not stop an activity
   * already running.
   */
  async function workflowEnded(tenant: string, fy: number): Promise<void> {
    const handle = api.temporal.workflow.getHandle(complianceReportWorkflowId(tenant, fy));
    await vi.waitFor(() => handle.result(), { timeout: 45_000, interval: 250 });
  }

  /** psc, tsc and jsc in the directory, each with a supervisor, commission-admin and officer. */
  function givenDirectory() {
    givenPscDirectory(api);
    for (const slug of ['tsc', 'jsc']) {
      api.directory.givenCommission(slug);
      api.directory.givenStaff(
        slug,
        'supervisor',
        `supervisor-${slug}`,
        `supervisor@${slug}.go.ke`,
      );
      api.directory.givenStaff(slug, 'commission-admin', `admin-${slug}`, `admin@${slug}.go.ke`);
      api.directory.givenStaff(
        slug,
        'reporting-officer',
        `officer-${slug}`,
        `officer@${slug}.go.ke`,
      );
    }
  }

  /** psc's FY 2027 report compiled, reviewed and confirmed on 20 July; its PDF issued. */
  async function pscSubmittedOnTime(): Promise<ReportBody> {
    await givenFy2027Facts(api);
    api.clock.set(COMPILED_AT);
    const path = '/v1/commissions/psc/compliance-reports/2027';
    expect((await api.send('POST', `${path}/compile`, SUPERVISOR)).statusCode).toBe(202);
    await compiledReport(api, 2027);
    const entered = await api.send('PATCH', `${path}/manual`, COMMISSION_ADMIN, {
      contactDetails: 'Commission Secretary, 0202223901',
      physicalAddress: 'Commission House, Harambee Avenue, Nairobi',
      emailAddress: 'info@publicservice.go.ke',
    });
    expect(entered.statusCode, entered.body).toBe(200);
    const reviewed = await api.send('POST', `${path}/reviewed`, SUPERVISOR, {
      designation: 'Deputy Director, Compliance',
    });
    expect(reviewed.statusCode, reviewed.body).toBe(200);
    api.clock.set(CONFIRMED_AT);
    const admin = steppedUp(COMMISSION_ADMIN, '2028-07-20T06:58:00.000Z');
    const confirmed = await api.send('POST', `${path}/confirm`, admin, undefined, {
      'idempotency-key': randomUUID(),
    });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    const issued = await vi.waitFor(
      async () => {
        const body = (await api.get(path, SUPERVISOR)).json<ReportBody>();
        if (!body.formMDocumentId || !body.receiptDocumentId) throw new Error('not issued yet');
        return body;
      },
      { timeout: 45_000, interval: 250 },
    );
    // The receipt email still follows the documents.
    await workflowEnded('psc', 2027);
    return issued;
  }

  /** tsc's own system files FY 2027 on 5 August: every final declaration made. */
  async function tscSubmittedLate(): Promise<ReportBody> {
    const document = asTsc(validFormM('complete-fy-2027.json'));
    document.partII.final = {
      ...document.partII.final,
      declared: 4,
      notDeclared: 0,
      nonFilers: [],
    };
    api.clock.set(LATE_AT);
    const response = await api.send('POST', '/v1/compliance-reports', TSC_SYSTEM, document, {
      'idempotency-key': randomUUID(),
    });
    expect(response.statusCode, response.body).toBe(201);
    await workflowEnded('tsc', 2027);
    return response.json<ReportBody>();
  }

  describe('S9: intake and report viewer', () => {
    let psc: ReportBody;
    let tsc: ReportBody;

    beforeAll(async () => {
      await endWorkflows();
      await api.reset();
      givenDirectory();
      psc = await pscSubmittedOnTime();
      tsc = await tscSubmittedLate();
      // jsc's supervisor compiled a draft, never submitted.
      await api.asPlatform((tx) =>
        tx
          .insert(complianceReports)
          .values({ id: uuidv7(), tenant: 'jsc', fy: 2027, status: 'draft' }),
      );
    }, 150_000);

    it('S9: psc submitted on time, tsc late, jsc not reported; rates, outliers and totals', async () => {
      const response = await api.get(`${INTAKE}?fy=2027`, EACC_ANALYST);

      expect(response.statusCode, response.body).toBe(200);
      const body = response.json<IntakeBody>();
      expect(contractErrors(okResponse(INTAKE, 'get'), body)).toEqual([]);
      expect(body.fy).toBe(2027);
      expect(body.totals).toEqual({
        onTime: 1,
        late: 1,
        notReported: 1,
        // (10 + 95 + 3) + (10 + 95 + 4) declared of 2 x 116 expected.
        nationalDeclaredRate: 0.9353,
      });
      expect(body.commissions.map((item) => [item.commission.slug, item.status])).toEqual([
        ['jsc', 'not-reported'],
        ['psc', 'submitted-on-time'],
        ['tsc', 'submitted-late'],
      ]);
      const [jsc, pscItem, tscItem] = body.commissions;
      expect(jsc).toMatchObject({
        commission: { slug: 'jsc', name: 'Judicial Service Commission' },
        reportId: null,
        reference: null,
        submittedAt: null,
        rates: {},
        outliers: [],
        chases: { count: 0, lastAt: null },
      });
      expect(pscItem).toEqual({
        commission: { slug: 'psc', name: 'Public Service Commission' },
        status: 'submitted-on-time',
        reportId: psc.id,
        reference: psc.reference,
        submittedAt: CONFIRMED_AT,
        rates: {
          initial: { expected: 12, declared: 10, rate: 0.8333 },
          biennial: { expected: 100, declared: 95, rate: 0.95 },
          final: { expected: 4, declared: 3, rate: 0.75 },
        },
        // Below the configured 0.8 for final declarations.
        outliers: ['low-final-rate'],
        chases: { count: 0, lastAt: null },
        formMDocumentId: psc.formMDocumentId,
        receiptDocumentId: psc.receiptDocumentId,
      });
      expect(tscItem).toMatchObject({
        status: 'submitted-late',
        reportId: tsc.id,
        submittedAt: LATE_AT,
        rates: { final: { expected: 4, declared: 4, rate: 1 } },
        outliers: [],
      });
    });

    it('S9: filters by status and outliers', async () => {
      const late = (
        await api.get(`${INTAKE}?fy=2027&status=submitted-late`, EACC_SUPERVISOR)
      ).json<IntakeBody>();
      expect(late.commissions.map((item) => item.commission.slug)).toEqual(['tsc']);
      const outliers = (
        await api.get(`${INTAKE}?fy=2027&outliersOnly=true`, EACC_ANALYST)
      ).json<IntakeBody>();
      expect(outliers.commissions.map((item) => item.commission.slug)).toEqual(['psc']);
      expect((await api.get(`${INTAKE}?fy=2028`, EACC_ANALYST)).json<IntakeBody>().totals).toEqual({
        onTime: 0,
        late: 0,
        notReported: 3,
        nationalDeclaredRate: null,
      });
    });

    it("S9: an eacc-analyst opens psc's report as filed, with its PDF and receipt; the read is audited", async () => {
      const before = (await api.events()).length;

      const response = await api.get(viewer(psc.id), EACC_ANALYST);

      expect(response.statusCode, response.body).toBe(200);
      const body = response.json<ReportBody>();
      expect(contractErrors(okResponse(`${INTAKE}/{reportId}`, 'get'), body)).toEqual([]);
      expect(body).toMatchObject({
        id: psc.id,
        commission: { slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission' },
        status: 'submitted',
        reference: psc.reference,
        late: false,
        formMDocumentId: psc.formMDocumentId,
        receiptDocumentId: psc.receiptDocumentId,
      });
      expect(body.document?.meta).toMatchObject({ reference: psc.reference, source: 'hosted' });
      expect(body.document?.partI.commissionName).toBe('Public Service Commission');
      expect(api.documents.issued.find((issued) => issued.type === 'form-m')).toMatchObject({
        subjectRef: `compliance-report:${psc.id}`,
        disclosureLevel: 'restricted',
      });

      const audited = (await api.events()).slice(before);
      expect(audited.map((event) => event.type)).toEqual(['audit.read.v1']);
      // The read is psc's data, recorded under psc's tenant; the actor is EACC's.
      expect(audited[0]?.tenant).toBe('psc');
      expect(audited[0]?.data).toMatchObject({
        action: 'compliance-report.viewed',
        resource: { type: 'compliance-report', params: { reportId: psc.id } },
        actor: { subject: 'eacc-analyst-1', tenant: 'eacc', roles: ['eacc-analyst'] },
        outcome: 'success',
      });
      // The audit event carries identifiers, not the report.
      expect(JSON.stringify(audited)).not.toContain('Public Service Commission');
    });

    it("S9: EACC reads every Commission's submitted report; the report stays one of the Commission", async () => {
      expect((await api.get(viewer(tsc.id), EACC_SUPERVISOR)).json<ReportBody>()).toMatchObject({
        id: tsc.id,
        source: 'federated',
        late: true,
      });
    });

    it('S9: Commission staff and the federated system read their own submitted report', async () => {
      for (const caller of [SUPERVISOR, COMMISSION_ADMIN, REPORTING_OFFICER]) {
        const response = await api.get(viewer(psc.id), caller);
        expect(response.statusCode, response.body).toBe(200);
        expect(response.json<ReportBody>().id).toBe(psc.id);
      }
      expect((await api.get(viewer(tsc.id), TSC_SYSTEM)).statusCode).toBe(200);
    });

    it("S9: another Commission's report, a draft, an unknown id and other roles are 404", async () => {
      const jscDraft = await api.asPlatform(async (tx) => {
        const [row] = await tx
          .select()
          .from(complianceReports)
          .where(eq(complianceReports.tenant, 'jsc'));
        return row;
      });
      const cases: [string, Caller, string][] = [
        ["psc's supervisor, tsc's report", SUPERVISOR, tsc.id],
        ["tsc's system, psc's report", TSC_SYSTEM, psc.id],
        ['a reviewer of psc', PSC_REVIEWER, psc.id],
        ['a platform admin', { tenant: 'platform', roles: ['platform-admin'] }, psc.id],
        ['an EACC role acting for psc', { tenant: 'psc', roles: ['eacc-analyst'] }, tsc.id],
        ['a token without roles', { tenant: 'psc' }, psc.id],
        ['EACC, a draft', EACC_ANALYST, jscDraft?.id ?? ''],
        ['EACC, an unknown id', EACC_ANALYST, uuidv7()],
        ['a system without reports:submit', { tenant: 'tsc', scopes: ['roster:write'] }, tsc.id],
      ];
      for (const [who, caller, reportId] of cases) {
        expect((await api.get(viewer(reportId), caller)).statusCode, who).toBe(404);
      }
      expect((await api.get(viewer('not-a-uuid'), EACC_ANALYST)).statusCode).toBe(400);
    });

    it('S9: a reviewer of psc cannot see the intake; nor can any Commission role', async () => {
      const callers: [string, Caller][] = [
        ['a reviewer of psc', PSC_REVIEWER],
        ['a supervisor', SUPERVISOR],
        ['a commission-admin', COMMISSION_ADMIN],
        ['a reporting officer', REPORTING_OFFICER],
        ["tsc's system", { ...TSC_SYSTEM, scopes: [REPORTS_SUBMIT] }],
        ['an EACC role acting for psc', { tenant: 'psc', roles: ['eacc-analyst'] }],
        ['a platform admin', { tenant: 'platform', roles: ['platform-admin'] }],
      ];
      for (const [who, caller] of callers) {
        expect((await api.get(`${INTAKE}?fy=2027`, caller)).statusCode, who).toBe(403);
      }
    });

    it('S9: 400 for a year reports do not exist for; 503 while the directory is unreachable', async () => {
      expect((await api.get(`${INTAKE}?fy=2024`, EACC_ANALYST)).statusCode).toBe(400);
      expect((await api.get(INTAKE, EACC_ANALYST)).statusCode).toBe(400);
      expect((await api.get(`${INTAKE}?fy=2027&status=filed`, EACC_ANALYST)).statusCode).toBe(400);
      api.directory.failCalls(1);
      expect((await api.get(`${INTAKE}?fy=2027`, EACC_ANALYST)).statusCode).toBe(503);
    });
  });

  describe('S10: chase', () => {
    beforeEach(async () => {
      await endWorkflows();
      await api.reset();
      givenDirectory();
    });

    const chase = () => api.app.get(NationalChaseActivities);

    /** psc's FY 2025 report, submitted on time. */
    async function givenPscReported2025(): Promise<void> {
      const id = uuidv7();
      await api.asPlatform(async (tx) => {
        await tx.insert(complianceReports).values({
          id,
          tenant: 'psc',
          fy: 2025,
          status: 'submitted',
          reference: 'RPT-PSC-2025-0000001-4',
          submittedAt: new Date('2026-07-20T07:00:00.000Z'),
          late: false,
        });
        await tx.insert(reportReceipts).values({
          reportId: id,
          tenant: 'psc',
          fy: 2025,
          reference: 'RPT-PSC-2025-0000001-4',
          source: 'hosted',
          submittedAt: new Date('2026-07-20T07:00:00.000Z'),
          late: false,
          counts: {
            initial: { expected: 1, declared: 1, notDeclared: 0 },
            biennial: { expected: 0, declared: 0, notDeclared: 0, noCycleInPeriod: true },
            final: { expected: 0, declared: 0, notDeclared: 0 },
            clarifications: 0,
            accessRequests: { received: 0, granted: 0, declined: 0 },
          },
        });
      });
    }

    it("S10: a chase emails the Commission's reporting officers and commission-admins once per round, with an event", async () => {
      await tscSubmittedLate();
      api.clock.set('2028-08-08T06:00:00.000Z');
      const chaseEmails = () =>
        api.notifications.sent.filter((sent) => sent.template === 'form-m-chase-email');

      expect(await chase().chaseTargets({ fy: 2027 })).toEqual({ tenants: ['jsc', 'psc'] });
      expect(await chase().chaseCommission({ fy: 2027, tenant: 'jsc', round: 2 })).toEqual({
        outcome: 'chased',
        recipients: 2,
      });
      // A retried round emails and announces nothing twice.
      await chase().chaseCommission({ fy: 2027, tenant: 'jsc', round: 2 });

      expect(
        chaseEmails()
          .map((sent) => sent.to)
          .sort(),
      ).toEqual(['admin@jsc.go.ke', 'officer@jsc.go.ke']);
      expect(chaseEmails()[0]).toMatchObject({
        template: 'form-m-chase-email',
        tenant: 'jsc',
        params: { financialYear: '2027/2028', dueDate: '2028-07-31', round: 2 },
      });
      const chased = (await api.events()).filter(
        (event) => event.type === 'compliance-report.chased.v1',
      );
      expect(chased).toEqual([
        expect.objectContaining({
          tenant: 'jsc',
          data: { reportId: null, fy: 2027, round: 2, recipients: 2 },
        }),
      ]);
      expect(await api.asPlatform((tx) => tx.select().from(reportChases))).toEqual([
        {
          tenant: 'jsc',
          fy: 2027,
          round: 2,
          recipients: 2,
          sentAt: new Date('2028-08-08T06:00:00.000Z'),
        },
      ]);

      // The intake shows the chase.
      const intake = (await api.get(`${INTAKE}?fy=2027`, EACC_ANALYST)).json<IntakeBody>();
      expect(intake.commissions.find((item) => item.commission.slug === 'jsc')?.chases).toEqual({
        count: 1,
        lastAt: '2028-08-08T06:00:00.000Z',
      });

      // A Commission that submitted is chased no more.
      expect(await chase().chaseCommission({ fy: 2027, tenant: 'tsc', round: 2 })).toEqual({
        outcome: 'submitted',
      });
      expect(chaseEmails().some((sent) => sent.tenant === 'tsc')).toBe(false);
    });

    it('S10: from 1 August the chase runs on Temporal for the year due on 31 July, ids and counts only in history', async () => {
      await givenPscReported2025();
      // 1 August 2026: the chase of FY 2025, due on 31 July 2026.
      api.clock.set('2026-08-01T06:00:00.000Z');

      const started: unknown = await api.temporal.workflow.execute(NATIONAL_CHASE_START_WORKFLOW, {
        taskQueue: config.TEMPORAL_TASK_QUEUE,
        workflowId: `national-chase-start-test-${randomUUID()}`,
        args: [],
      });
      expect(started).toEqual({ fy: 2025, started: true });

      await vi.waitFor(
        () => {
          if (api.notifications.sent.length < 4) throw new Error('not chased yet');
        },
        { timeout: 45_000, interval: 250 },
      );
      expect(api.notifications.sent.map((sent) => sent.to).sort()).toEqual([
        'admin@jsc.go.ke',
        'admin@tsc.go.ke',
        'officer@jsc.go.ke',
        'officer@tsc.go.ke',
      ]);
      const chased = await vi.waitFor(async () => {
        const found = (await api.events()).filter(
          (event) => event.type === 'compliance-report.chased.v1',
        );
        if (found.length < 2) throw new Error('not recorded yet');
        return found;
      });
      expect(chased.map((event) => event.tenant).sort()).toEqual(['jsc', 'tsc']);
      expect(
        (await api.get(`${INTAKE}?fy=2025`, EACC_ANALYST))
          .json<IntakeBody>()
          .commissions.map((item) => [item.commission.slug, item.chases.count]),
      ).toEqual([
        ['jsc', 1],
        ['psc', 0],
        ['tsc', 1],
      ]);

      // Started once a year: a second start finds it running.
      const again: unknown = await api.temporal.workflow.execute(NATIONAL_CHASE_START_WORKFLOW, {
        taskQueue: config.TEMPORAL_TASK_QUEUE,
        workflowId: `national-chase-start-test-${randomUUID()}`,
        args: [],
      });
      expect(again).toEqual({ fy: 2025, started: false });

      // The NCR approved: the chase ends.
      const handle = api.temporal.workflow.getHandle(nationalConsolidationWorkflowId(2025));
      await handle.signal(NCR_APPROVED_SIGNAL);
      expect(await handle.result()).toEqual({ rounds: 1, chases: 2, ended: 'ncr-approved' });

      const history = await historyPayloads(api.temporal, nationalConsolidationWorkflowId(2025));
      expect(history).toContain('"tenant":"jsc"');
      for (const personal of ['@', 'Judicial Service Commission', 'officer-jsc', 'admin-jsc']) {
        expect(history).not.toContain(personal);
      }
      const published = JSON.stringify(chased);
      expect(published).not.toContain('@');
    });

    it('keeps a Temporal schedule that starts the chase at 06:00 on 1 August in Nairobi', async () => {
      const schedule = api.app.get(NationalChaseSchedule);
      const scheduleId = await schedule.ensureSchedule('0 6 1 8 *');
      const handle = api.temporal.schedule.getHandle(scheduleId);
      try {
        expect(scheduleId).toBe(nationalChaseScheduleId(config.TEMPORAL_TASK_QUEUE));
        const described = await handle.describe();
        expect(described.action).toMatchObject({
          type: 'startWorkflow',
          workflowType: NATIONAL_CHASE_START_WORKFLOW,
          taskQueue: config.TEMPORAL_TASK_QUEUE,
        });
        expect(described.spec.timezone).toBe('Africa/Nairobi');
        expect(described.spec.calendars?.[0]).toMatchObject({
          month: [{ start: 'AUGUST', end: 'AUGUST', step: 1 }],
          dayOfMonth: [{ start: 1, end: 1, step: 1 }],
          hour: [{ start: 6, end: 6, step: 1 }],
        });
      } finally {
        await handle.delete();
      }
    });
  });
});

interface IntakeItemBody {
  commission: { slug: string; name: string };
  status: string;
  reportId: string | null;
  reference: string | null;
  submittedAt: string | null;
  rates: Record<string, { expected: number; declared: number; rate: number | null }>;
  outliers: string[];
  chases: { count: number; lastAt: string | null };
}

interface IntakeBody {
  fy: number;
  totals: Record<string, number | null>;
  commissions: IntakeItemBody[];
}
