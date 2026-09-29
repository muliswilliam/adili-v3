import { randomUUID } from 'node:crypto';

import { formMIssues, validateFormM } from '@adili/forms';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { complianceReportWorkflowId } from '../../src/compliance-reports/contract.js';
import { complianceReports, outbox, reportRemarks } from '../../src/db/schema.js';
import { contractErrors, okResponse } from '../support/contract.js';
import { declarationSubmitted, obligationCreated } from '../support/events.js';
import {
  COMMISSION_ADMIN,
  compiledReport,
  editDraft,
  type Fy2027Facts,
  givenFy2027Facts,
  givenPscDirectory,
  SUPERVISOR,
} from '../support/form-m-facts.js';
import { type ReportingApi, startReportingApi } from '../support/reporting-api.js';
import { historyPayloads } from '../support/workflow-history.js';

/**
 * S2, S3 and S4 through the HTTP API: a supervisor compiles Form M; `ComplianceReportWorkflow`
 * runs on Temporal through the service's worker, aggregates the projections, pulls the officers
 * and clarifications by id from the fake declarations and review services, and saves the
 * encrypted draft, which the API reads back.
 */
describe('Form M compile (S2, S3, S4)', () => {
  let api: ReportingApi;

  beforeAll(async () => {
    api = await startReportingApi();
  });

  afterAll(async () => {
    await endWorkflows();
    await api.close();
  });

  beforeEach(async () => {
    await endWorkflows();
    await api.reset();
    givenPscDirectory(api);
  });

  /** Ends the workflows a test left waiting for a recompile. */
  async function endWorkflows() {
    for (const fy of [2027, 2028]) {
      try {
        await api.temporal.workflow.getHandle(complianceReportWorkflowId('psc', fy)).terminate();
      } catch {
        // Not running.
      }
    }
  }

  const reportPath = (fy: number) => `/v1/commissions/psc/compliance-reports/${String(fy)}`;
  const compile = (fy: number) => api.send('POST', `${reportPath(fy)}/compile`, SUPERVISOR);

  describe('S2: FY 2027 for psc', () => {
    let facts: Fy2027Facts;

    beforeEach(async () => {
      facts = await givenFy2027Facts(api);
      api.clock.set('2028-07-01T06:00:00.000Z');
    });

    it('S2: compiles the counts, the non-filers with action taken and compliance, the clarifications, section 5 and an empty Part B', async () => {
      const started = await compile(2027);
      expect(started.statusCode).toBe(202);

      const report = await compiledReport(api, 2027);
      const document = report.document;
      if (!document) throw new Error('no document');

      expect(report).toMatchObject({
        commission: { slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission' },
        fy: 2027,
        status: 'draft',
        source: 'hosted',
        compiledAt: '2028-07-01T06:00:00.000Z',
        reviewedBy: null,
        reference: null,
        dueDate: '2028-07-31',
        accessDataUnavailable: true,
        counts: {
          initial: { expected: 12, declared: 10, notDeclared: 2 },
          biennial: { expected: 100, declared: 95, notDeclared: 5, noCycleInPeriod: false },
          final: { expected: 4, declared: 3, notDeclared: 1 },
          clarifications: 6,
          accessRequests: { received: 0, granted: 0, declined: 0 },
        },
      });
      expect(
        contractErrors(okResponse('/v1/commissions/{slug}/compliance-reports/{fy}', 'get'), report),
      ).toEqual([]);

      expect(document.partI).toEqual({
        commissionName: 'Public Service Commission',
        issuerCode: 'PSC',
        contactDetails: '',
        physicalAddress: '',
        emailAddress: '',
        period: { from: '2027-07-01', to: '2028-06-30', financialYearStart: 2027 },
      });
      const { noticed, recent } = facts.initial;
      expect(document.partII.initial).toEqual({
        expected: 12,
        declared: 10,
        notDeclared: 2,
        nonFilers: [
          {
            name: noticed.name,
            designation: 'Senior Officer',
            identifier: noticed.fileNumber,
            date: '2027-08-01',
            actionTaken: 'notice-to-comply',
            complied: 'pending',
            remarks: 'Notice to comply issued',
            obligationId: noticed.obligationId,
          },
          {
            name: recent.name,
            designation: 'Senior Officer',
            identifier: recent.fileNumber,
            date: '2028-06-20',
            actionTaken: 'none',
            complied: 'no',
            remarks: 'No administrative action taken',
            obligationId: recent.obligationId,
          },
        ],
      });
      const biennial = document.partII.biennial;
      expect(biennial).toMatchObject({ expected: 100, declared: 95, notDeclared: 5 });
      expect(biennial.noCycleInPeriod).toBeUndefined();
      const { compliedLate, silent } = facts.biennial;
      expect(
        biennial.nonFilers.find((row) => row.obligationId === compliedLate.obligationId),
      ).toEqual({
        name: compliedLate.name,
        designation: 'Senior Officer',
        identifier: compliedLate.fileNumber,
        date: '2015-03-01',
        actionTaken: 'notice-to-comply',
        complied: 'yes',
        remarks: 'Notice to comply issued',
        obligationId: compliedLate.obligationId,
      });
      expect(
        biennial.nonFilers
          .filter((row) => row.obligationId !== compliedLate.obligationId)
          .map((row) => [row.obligationId, row.name, row.actionTaken, row.complied])
          .sort(),
      ).toEqual(silent.map((officer) => [officer.obligationId, officer.name, 'none', 'no']).sort());
      expect(document.partII.final.nonFilers).toEqual([
        expect.objectContaining({
          name: facts.final.silent.name,
          designation: 'Director',
          date: '2028-02-28',
          actionTaken: 'none',
          complied: 'no',
        }),
      ]);

      expect(document.partII.clarifications.items).toEqual(
        facts.clarifications.map(({ status }, i) => ({
          name: `Declarant ${String(i)} Achieng`,
          designation: 'Accountant',
          identifier: `PSC/2010/${String(700 + i)}`,
          natureInGeneralTerms: 'Source of income; Land acquired',
          statusOfCompliance: status === 'issued' ? 'pending' : status,
          clarificationReference: `CLR-PSC-2027-000000${String(i + 1)}-4`,
        })),
      );
      expect(document.partII.accessRequests).toEqual({
        received: 0,
        granted: 0,
        declined: 0,
        declineReasons: [],
        dataUnavailable: true,
      });
      expect(document.partII.complaints).toEqual({ registerMaintained: null, items: [] });
      expect(document.partIII).toEqual({
        compiledBy: { name: null, designation: null, date: null },
        confirmedBy: { name: null, designation: null, date: null },
      });
      // Against form-m.v1 the draft lacks only what the commission-admin enters: Part I's email.
      expect(formMIssues(document)).toEqual({
        issues: [
          expect.objectContaining({ sectionKey: 'partI', path: '/emailAddress', code: 'format' }),
        ],
        report: [],
      });
    });

    it('S2: pulls details by id in one batch per service, tells the supervisor and commission-admin, and emits compliance-report.drafted.v1', async () => {
      await compile(2027);
      const report = await compiledReport(api, 2027);

      expect(api.declarations.calls).toEqual([{ tenant: 'psc', ids: 8 }]);
      expect(api.review.calls).toEqual([{ tenant: 'psc', ids: 6 }]);
      await expect
        .poll(() => api.notifications.sent.map((message) => message.to).sort())
        .toEqual(['admin@psc.go.ke', 'supervisor@psc.go.ke']);
      expect(api.notifications.sent[0]).toMatchObject({
        template: 'form-m-draft-ready-email',
        tenant: 'psc',
        params: { financialYear: '2027/2028', dueDate: '2028-07-31' },
      });

      const events = await api.db.select().from(outbox);
      expect(events.map((event) => event.envelope)).toEqual([
        expect.objectContaining({
          type: 'compliance-report.drafted.v1',
          tenant: 'psc',
          subject: report.id,
          data: { reportId: report.id, fy: 2027, status: 'draft', source: 'hosted' },
        }),
      ]);
    });

    it('S2: names live only in the encrypted snapshot, never in clear columns, events or Temporal history', async () => {
      await compile(2027);
      const report = await compiledReport(api, 2027);

      const [row] = await api.asPlatform((tx) =>
        tx.select().from(complianceReports).where(eq(complianceReports.id, report.id)),
      );
      const stored = JSON.stringify(row);
      const events = JSON.stringify(await api.db.select().from(outbox));
      const history = await historyPayloads(api.temporal, complianceReportWorkflowId('psc', 2027));
      expect(history).toContain(facts.initial.noticed.obligationId);
      for (const value of facts.personalData) {
        expect(stored).not.toContain(value);
        expect(events).not.toContain(value);
        expect(history).not.toContain(value);
      }
      expect(api.cipher.calls).toContainEqual({
        operation: 'encrypt',
        tenant: 'psc',
        recordId: report.id,
      });
    });
  });

  it('S3: a recompile after a new filing changes the counts and keeps edited remarks and manual fields', async () => {
    const facts = await givenFy2027Facts(api);
    api.clock.set('2028-07-01T06:00:00.000Z');
    await compile(2027);
    const first = await compiledReport(api, 2027);
    const { noticed, recent } = facts.initial;
    // The supervisor's remark and the commission-admin's entries, as #227's endpoints save them.
    await api.asPlatform((tx) =>
      tx.insert(reportRemarks).values({
        reportId: first.id,
        tenant: 'psc',
        obligationId: noticed.obligationId,
        remark: 'Officer on study leave; notice delivered by hand',
        updatedBy: 'supervisor-psc',
      }),
    );
    await editDraft(api, 2027, (document) => {
      document.partI.contactDetails = 'Commission Secretary, 0202223901';
      document.partI.physicalAddress = 'Commission House, Harambee Avenue, Nairobi';
      document.partI.emailAddress = 'info@publicservice.go.ke';
      document.partII.complaints = {
        registerMaintained: true,
        items: [
          {
            name: 'Complainant Omondi',
            designation: 'Clerk',
            identifier: 'PSC/2020/0101',
            nature: 'Late declaration',
            status: 'Closed',
          },
        ],
      };
    });

    // The June appointee files on time after the first compile.
    await api.deliver(declarationSubmitted('psc', recent.obligationId, '2028-07-05T08:00:00.000Z'));
    api.clock.set('2028-07-06T06:00:00.000Z');
    expect((await compile(2027)).statusCode).toBe(202);
    const second = await compiledReport(api, 2027, new Date(first.compiledAt ?? 0));
    const document = second.document;
    if (!document) throw new Error('no document');

    expect(second.id).toBe(first.id);
    expect(second.counts).toMatchObject({
      initial: { expected: 12, declared: 11, notDeclared: 1 },
    });
    expect(document.partII.initial.nonFilers).toEqual([
      expect.objectContaining({
        obligationId: noticed.obligationId,
        remarks: 'Officer on study leave; notice delivered by hand',
      }),
    ]);
    expect(document.partI).toMatchObject({
      contactDetails: 'Commission Secretary, 0202223901',
      physicalAddress: 'Commission House, Harambee Avenue, Nairobi',
      emailAddress: 'info@publicservice.go.ke',
    });
    expect(document.partII.complaints.items).toHaveLength(1);
    expect(document.meta?.compiledAt).toBe('2028-07-06T06:00:00.000Z');
    expect(validateFormM(document)).toEqual({ ok: true, value: document });
    // Recompiling tells no one again.
    await expect.poll(() => api.notifications.sent).toHaveLength(2);
  });

  it('S4: an even financial year without a biennial cycle marks section 2 noCycleInPeriod with zero counts', async () => {
    await api.deliver(obligationCreated('psc', { type: 'initial', statementDate: '2028-09-01' }));
    await api.deliver(obligationCreated('psc', { type: 'final', statementDate: '2029-03-01' }));
    api.declarations.given('psc');
    api.clock.set('2029-07-01T06:00:00.000Z');

    await compile(2028);
    const report = await compiledReport(api, 2028);

    expect(report.counts).toMatchObject({
      initial: { expected: 1, declared: 0, notDeclared: 1 },
      biennial: { expected: 0, declared: 0, notDeclared: 0, noCycleInPeriod: true },
      final: { expected: 1, declared: 0, notDeclared: 1 },
    });
    expect(report.document?.partII.biennial).toEqual({
      expected: 0,
      declared: 0,
      notDeclared: 0,
      nonFilers: [],
      noCycleInPeriod: true,
    });
    expect(report.document?.partI.period).toEqual({
      from: '2028-07-01',
      to: '2029-06-30',
      financialYearStart: 2028,
    });
  });

  it('S2: the report reads back compiling, without a document, until the workflow saves the draft', async () => {
    const obligationId = randomUUID();
    await api.deliver(
      obligationCreated('psc', { obligationId, type: 'initial', statementDate: '2027-09-01' }),
    );
    api.clock.set('2028-07-01T06:00:00.000Z');
    // Declarations is down for the first pull: the activity retries a second later.
    api.declarations.failCalls(1);

    expect((await compile(2027)).statusCode).toBe(202);
    const compiling = await api.get(reportPath(2027), COMMISSION_ADMIN);

    expect(compiling.statusCode).toBe(200);
    expect(compiling.json()).toMatchObject({
      status: 'compiling',
      compiledAt: null,
      document: null,
      counts: {},
    });
    expect(
      contractErrors(
        okResponse('/v1/commissions/{slug}/compliance-reports/{fy}', 'get'),
        compiling.json(),
      ),
    ).toEqual([]);
    const report = await compiledReport(api, 2027);
    expect(report.counts).toMatchObject({ initial: { expected: 1, declared: 0, notDeclared: 1 } });

    // Part I names the Commission from the directory: while it is down, reads answer 503.
    api.directory.reset();
    const unavailable = await api.get(reportPath(2027), COMMISSION_ADMIN);
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json()).toMatchObject({ type: 'directory-unavailable' });
  });

  it('S2: a submitted report is not compiled again', async () => {
    api.clock.set('2028-07-01T06:00:00.000Z');
    await api.asPlatform((tx) =>
      tx.insert(complianceReports).values({
        id: randomUUID(),
        tenant: 'psc',
        fy: 2027,
        status: 'submitted',
        submittedAt: new Date('2028-07-20T09:00:00.000Z'),
        reference: 'RPT-PSC-2027-0000001-4',
        late: false,
      }),
    );

    const response = await compile(2027);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'report-submitted' });
  });
});
