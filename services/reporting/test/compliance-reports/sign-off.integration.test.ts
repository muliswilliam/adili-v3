import { createHash, randomUUID } from 'node:crypto';

import { canonicalJson } from '@adili/api-kit';
import { formMIssues, validateFormM } from '@adili/forms';
import { format, RPT } from '@adili/numbering';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { complianceReportWorkflowId } from '../../src/compliance-reports/contract.js';
import {
  complianceReports,
  idempotencyKeys,
  reportReceipts,
  reportReminders,
  reportRemarks,
} from '../../src/db/schema.js';
import { contractErrors, okResponse } from '../support/contract.js';
import {
  COMMISSION_ADMIN,
  compiledReport,
  type Fy2027Facts,
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
 * S3 (edits), S5, S6 and S7 through the HTTP API and the workflow on Temporal: the supervisor edits
 * remarks and marks the draft reviewed, the commission-admin enters Part I and Part B and confirms
 * with a fresh step-up; confirmation allocates the `RPT` reference, freezes the document with its
 * hash and submits it; the workflow issues the Form M PDF and the receipt through (fake) documents
 * and tells both officers. Deadline reminders at the activity seam; Part I contacts carried over
 * from the previous submitted report; the authorisation rows of the matrix.
 */
describe('Form M review, confirm and submit (S3, S5, S6, S7)', () => {
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

  /** Ends the workflows a test left waiting. */
  const endWorkflows = () =>
    api.endWorkflows([2026, 2027].map((fy) => complianceReportWorkflowId('psc', fy)));

  const path = (fy = 2027) => `/v1/commissions/psc/compliance-reports/${String(fy)}`;
  const contract = (operation: string, method: 'get' | 'post' | 'patch') =>
    okResponse(`/v1/commissions/{slug}/compliance-reports/{fy}${operation}`, method);

  const COMPILED_AT = '2028-07-01T06:00:00.000Z';
  const CONFIRMED_AT = '2028-07-20T07:00:00.000Z';
  const CONTACTS = {
    contactDetails: 'Commission Secretary, 0202223901',
    physicalAddress: 'Commission House, Harambee Avenue, Nairobi',
    emailAddress: 'info@publicservice.go.ke',
  };

  /** The S2 fixture compiled into the FY 2027 draft. */
  async function draft(): Promise<{ report: ReportBody; facts: Fy2027Facts }> {
    const facts = await givenFy2027Facts(api);
    api.clock.set(COMPILED_AT);
    expect((await api.send('POST', `${path()}/compile`, SUPERVISOR)).statusCode).toBe(202);
    return { report: await compiledReport(api, 2027), facts };
  }

  /** The draft with Part I entered and marked reviewed: ready for the commission-admin. */
  async function reviewedDraft(fy = 2027): Promise<void> {
    const entered = await api.send('PATCH', `${path(fy)}/manual`, COMMISSION_ADMIN, CONTACTS);
    expect(entered.statusCode, entered.body).toBe(200);
    const reviewed = await api.send('POST', `${path(fy)}/reviewed`, SUPERVISOR, {
      designation: 'Deputy Director, Compliance',
    });
    expect(reviewed.statusCode, reviewed.body).toBe(200);
  }

  const confirm = (caller: Caller, options: { key?: string; body?: unknown; fy?: number } = {}) =>
    api.send('POST', `${path(options.fy)}/confirm`, caller, options.body, {
      'idempotency-key': options.key ?? randomUUID(),
    });

  /** The commission-admin, stepped up two minutes before `at`, with the clock at `at`. */
  function adminAt(at: string): Caller {
    api.clock.set(at);
    return steppedUp(COMMISSION_ADMIN, new Date(Date.parse(at) - 120_000).toISOString());
  }

  /** Waits until the workflow issued the submitted report's PDF and receipt. */
  function issuedReport(fy = 2027): Promise<ReportBody> {
    return vi.waitFor(
      async () => {
        const body = (await api.get(path(fy), SUPERVISOR)).json<ReportBody>();
        if (!body.formMDocumentId || !body.receiptDocumentId) throw new Error('not issued yet');
        return body;
      },
      { timeout: 45_000, interval: 250 },
    );
  }

  describe('S5: review', () => {
    it('S5: the supervisor edits a remark and marks the draft reviewed: Part III compiled-by is set', async () => {
      const { report, facts } = await draft();
      const { noticed } = facts.initial;

      const remarked = await api.send('PATCH', `${path()}/remarks`, SUPERVISOR, {
        remarks: [{ obligationId: noticed.obligationId, remark: 'Notice delivered by hand' }],
      });

      expect(remarked.statusCode, remarked.body).toBe(200);
      expect(contractErrors(contract('/remarks', 'patch'), remarked.json())).toEqual([]);
      const remarkedDocument = remarked.json<ReportBody>().document;
      expect(
        remarkedDocument?.partII.initial.nonFilers.find(
          (row) => row.obligationId === noticed.obligationId,
        ),
      ).toMatchObject({ actionTaken: 'notice-to-comply', remarks: 'Notice delivered by hand' });
      const stored = await api.asPlatform((tx) => tx.select().from(reportRemarks));
      expect(stored).toEqual([
        expect.objectContaining({
          reportId: report.id,
          obligationId: noticed.obligationId,
          remark: 'Notice delivered by hand',
          updatedBy: 'supervisor-psc',
        }),
      ]);

      api.clock.set('2028-07-03T08:00:00.000Z');
      const reviewed = await api.send('POST', `${path()}/reviewed`, SUPERVISOR, {
        designation: 'Deputy Director, Compliance',
      });

      expect(reviewed.statusCode, reviewed.body).toBe(200);
      expect(contractErrors(contract('/reviewed', 'post'), reviewed.json())).toEqual([]);
      expect(reviewed.json()).toMatchObject({
        status: 'reviewed',
        reviewedBy: { subject: 'supervisor-psc', name: 'Grace Wanjiru' },
      });
      const read = (await api.get(path(), REPORTING_OFFICER)).json<ReportBody>();
      expect(read.status).toBe('reviewed');
      expect(read.document?.partIII).toEqual({
        compiledBy: {
          name: 'Grace Wanjiru',
          designation: 'Deputy Director, Compliance',
          date: '2028-07-03',
        },
        confirmedBy: { name: null, designation: null, date: null },
      });
      expect(await api.events()).toContainEqual(
        expect.objectContaining({
          type: 'compliance-report.reviewed.v1',
          tenant: 'psc',
          subject: report.id,
          data: { reportId: report.id, fy: 2027, status: 'reviewed', source: 'hosted' },
        }),
      );
    });

    it('S5: a blank remark returns the row to the label of its latest step', async () => {
      const { facts } = await draft();
      const { noticed } = facts.initial;
      const remark = (text: string) =>
        api.send('PATCH', `${path()}/remarks`, SUPERVISOR, {
          remarks: [{ obligationId: noticed.obligationId, remark: text }],
        });
      await remark('Notice delivered by hand');

      const cleared = await remark('  ');

      expect(
        cleared
          .json<ReportBody>()
          .document?.partII.initial.nonFilers.find(
            (row) => row.obligationId === noticed.obligationId,
          )?.remarks,
      ).toBe('Notice to comply issued');
      expect(await api.asPlatform((tx) => tx.select().from(reportRemarks))).toEqual([]);
    });

    it('S5: a remark on an officer the draft does not list is refused with the path', async () => {
      await draft();

      const response = await api.send('PATCH', `${path()}/remarks`, SUPERVISOR, {
        remarks: [{ obligationId: randomUUID(), remark: 'Who?' }],
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        errors: [{ path: 'remarks.0.obligationId' }],
      });
    });

    it('S5: the commission-admin enters Part I contact details and Part B', async () => {
      await draft();

      const response = await api.send('PATCH', `${path()}/manual`, COMMISSION_ADMIN, {
        ...CONTACTS,
        complaintsRegisterMaintained: true,
        complaints: [
          {
            name: 'Complainant Omondi',
            designation: 'Clerk',
            identifier: 'PSC/2020/0101',
            nature: 'Late declaration',
            status: 'Closed',
          },
        ],
      });

      expect(response.statusCode, response.body).toBe(200);
      expect(contractErrors(contract('/manual', 'patch'), response.json())).toEqual([]);
      const document = response.json<ReportBody>().document;
      if (!document) throw new Error('no document');
      expect(document.partI).toMatchObject(CONTACTS);
      expect(document.partII.complaints).toEqual({
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
      });
      // With the email entered, the draft is a complete form-m.v1 document.
      expect(formMIssues(document)).toEqual({ issues: [], report: [] });

      // Null clears a field; fields not given are kept.
      const cleared = await api.send('PATCH', `${path()}/manual`, COMMISSION_ADMIN, {
        physicalAddress: null,
      });
      expect(cleared.json<ReportBody>().document?.partI).toMatchObject({
        contactDetails: CONTACTS.contactDetails,
        physicalAddress: '',
        emailAddress: CONTACTS.emailAddress,
      });
    });

    it('S5: edits wait while the report is compiled', async () => {
      const { report } = await draft();
      await api.asPlatform((tx) =>
        tx
          .update(complianceReports)
          .set({ status: 'compiling' })
          .where(eq(complianceReports.id, report.id)),
      );

      const response = await api.send('PATCH', `${path()}/manual`, COMMISSION_ADMIN, CONTACTS);

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: 'report-compiling' });
    });
  });

  describe('authorisation', () => {
    const OTHER_COMMISSION: Caller = { sub: 'sup-tsc', tenant: 'tsc', roles: ['supervisor'] };
    const EACC: Caller = { sub: 'eacc-1', tenant: 'eacc', roles: ['eacc-analyst'] };
    const REVIEWER: Caller = { sub: 'reviewer-psc', tenant: 'psc', roles: ['reviewer'] };

    it('edit remarks and mark reviewed: supervisor only; commission-admin and reporting officer 403; others 404', async () => {
      const { facts } = await draft();
      const remarks = {
        remarks: [{ obligationId: facts.initial.noticed.obligationId, remark: 'Seen' }],
      };
      const reviewed = { designation: 'Director' };
      const status = async (caller: Caller) => [
        (await api.send('PATCH', `${path()}/remarks`, caller, remarks)).statusCode,
        (await api.send('POST', `${path()}/reviewed`, caller, reviewed)).statusCode,
      ];

      expect(await status(COMMISSION_ADMIN)).toEqual([403, 403]);
      expect(await status(REPORTING_OFFICER)).toEqual([403, 403]);
      expect(await status(OTHER_COMMISSION)).toEqual([404, 404]);
      expect(await status(EACC)).toEqual([404, 404]);
      expect(await status(REVIEWER)).toEqual([404, 404]);
      expect(await status(SUPERVISOR)).toEqual([200, 200]);
    });

    it('edit Part I and Part B, confirm and submit: commission-admin only; supervisor and reporting officer 403; others 404', async () => {
      await draft();
      await reviewedDraft();
      const at = '2028-07-20T07:00:00.000Z';
      const status = async (caller: Caller) => {
        const stepped = { ...adminAt(at), ...caller, acr: 'step-up', authTime: at };
        return [
          (await api.send('PATCH', `${path()}/manual`, caller, CONTACTS)).statusCode,
          (await confirm(stepped)).statusCode,
        ];
      };

      expect(await status(SUPERVISOR)).toEqual([403, 403]);
      expect(await status(REPORTING_OFFICER)).toEqual([403, 403]);
      expect(await status(OTHER_COMMISSION)).toEqual([404, 404]);
      expect(await status(EACC)).toEqual([404, 404]);
      expect(await status(REVIEWER)).toEqual([404, 404]);
      expect(await status(COMMISSION_ADMIN)).toEqual([200, 200]);
    });
  });

  describe('S6: confirm and submit', () => {
    it('S6: confirm with step-up allocates the RPT reference, completes Part III, freezes the document with its hash and submits it', async () => {
      const { report } = await draft();
      await reviewedDraft();

      const response = await confirm(adminAt(CONFIRMED_AT), {
        body: { designation: 'Commission Secretary' },
      });

      expect(response.statusCode, response.body).toBe(200);
      expect(contractErrors(contract('/confirm', 'post'), response.json())).toEqual([]);
      const reference = format(RPT, { issuer: 'PSC', period: 2027, sequence: 1 });
      expect(reference).toMatch(/^RPT-PSC-2027-0000001-[0-9A-Z]$/);
      const submitted = response.json<ReportBody>();
      expect(submitted).toMatchObject({
        id: report.id,
        status: 'submitted',
        source: 'hosted',
        reference,
        submittedAt: CONFIRMED_AT,
        late: false,
        reviewedBy: { subject: 'supervisor-psc', name: 'Grace Wanjiru' },
        confirmedBy: { subject: 'admin-psc', name: 'Peter Otieno' },
      });
      // The answer, kept for replays, carries no names: the document is read as filed.
      expect(submitted.document).toBeNull();
      const document = (await api.get(path(), REPORTING_OFFICER)).json<ReportBody>().document;
      if (!document) throw new Error('no document');
      expect(document.partIII.confirmedBy).toEqual({
        name: 'Peter Otieno',
        designation: 'Commission Secretary',
        date: '2028-07-20',
      });
      expect(document.meta).toMatchObject({ reference, source: 'hosted' });
      expect(validateFormM(document)).toEqual({ ok: true, value: document });

      // Frozen: the stored document is the one confirmed, and its hash is recorded.
      const [row] = await api.asPlatform((tx) =>
        tx.select().from(complianceReports).where(eq(complianceReports.id, report.id)),
      );
      expect(row?.canonicalSha256).toBe(
        createHash('sha256').update(canonicalJson(document)).digest('hex'),
      );
      const receipts = await api.asPlatform((tx) => tx.select().from(reportReceipts));
      // The PDF and receipt ids follow from the workflow.
      expect(receipts).toEqual([
        expect.objectContaining({
          reportId: report.id,
          tenant: 'psc',
          fy: 2027,
          reference,
          source: 'hosted',
          submittedAt: new Date(CONFIRMED_AT),
          late: false,
          counts: report.counts,
        }),
      ]);
      expect(await api.events()).toContainEqual(
        expect.objectContaining({
          type: 'compliance-report.submitted.v1',
          tenant: 'psc',
          subject: report.id,
          data: {
            reportId: report.id,
            fy: 2027,
            status: 'submitted',
            reference,
            late: false,
            source: 'hosted',
          },
        }),
      );
      // The periods list shows it submitted.
      expect(
        (await api.get('/v1/commissions/psc/compliance-reports', SUPERVISOR)).json(),
      ).toContainEqual(
        expect.objectContaining({ fy: 2027, status: 'submitted', reference, late: false }),
      );
    });

    it('S6: the workflow issues the Restricted Form M PDF and the signed receipt through documents, tells both officers and ends', async () => {
      const { report } = await draft();
      await reviewedDraft();
      const confirmed = (await confirm(adminAt(CONFIRMED_AT))).json<ReportBody>();

      const issued = await issuedReport();

      const reference = confirmed.reference as string;
      expect(issued.document).toEqual(expect.objectContaining({ schemaVersion: 'form-m.v1' }));
      expect(api.documents.issued).toEqual([
        expect.objectContaining({
          type: 'form-m',
          templateVersion: 1,
          disclosureLevel: 'restricted',
          issuerTenant: 'psc',
          subjectRef: `compliance-report:${report.id}`,
          subjectPersonId: null,
          payload: issued.document,
          publicPayload: {
            reference,
            type: 'form-m',
            issuer: 'PSC',
            issuedAt: CONFIRMED_AT,
          },
        }),
        expect.objectContaining({
          type: 'compliance-report-receipt',
          disclosureLevel: 'restricted',
          subjectRef: `compliance-report:${report.id}`,
        }),
      ]);
      const [row] = await api.asPlatform((tx) =>
        tx.select().from(complianceReports).where(eq(complianceReports.id, report.id)),
      );
      expect(api.documents.issued[1]?.payload).toEqual({
        reference,
        sha256: row?.canonicalSha256,
        submittedAt: CONFIRMED_AT,
        commissionName: 'Public Service Commission',
        issuerCode: 'PSC',
        financialYear: '2027/2028',
        dueDate: '2028-07-31',
        late: false,
        source: 'hosted',
      });
      expect(issued.formMDocumentId).toEqual(expect.any(String));
      expect(issued.receiptDocumentId).toEqual(expect.any(String));
      await expect
        .poll(() =>
          api.notifications.sent
            .filter((message) => message.template === 'form-m-receipt-email')
            .map((message) => message.to)
            .sort(),
        )
        .toEqual(['admin@psc.go.ke', 'supervisor@psc.go.ke']);
      expect(
        api.notifications.sent.find((message) => message.template === 'form-m-receipt-email'),
      ).toMatchObject({
        tenant: 'psc',
        params: { financialYear: '2027/2028', reference, submittedOn: '2028-07-20', late: 'no' },
      });
      const result: unknown = await api.temporal.workflow
        .getHandle(complianceReportWorkflowId('psc', 2027))
        .result();
      expect(result).toEqual({ compiles: 1, reminders: 0 });
    });

    it('S6: names stay out of Temporal history, events, EACC receipts and stored replies', async () => {
      const { facts } = await draft();
      await reviewedDraft();
      await confirm(adminAt(CONFIRMED_AT));
      await issuedReport();
      await api.temporal.workflow.getHandle(complianceReportWorkflowId('psc', 2027)).result();

      const history = await historyPayloads(api.temporal, complianceReportWorkflowId('psc', 2027));
      const published = JSON.stringify(await api.events());
      const receipts = JSON.stringify(
        await api.asPlatform((tx) => tx.select().from(reportReceipts)),
      );
      // Nor in the stored answer replayed for the confirm's Idempotency-Key.
      const replays = JSON.stringify(await api.db.select().from(idempotencyKeys));
      const personal = [
        ...facts.personalData,
        'Peter Otieno',
        'Grace Wanjiru',
        CONTACTS.emailAddress,
      ];
      for (const value of personal) {
        expect(history).not.toContain(value);
        expect(published).not.toContain(value);
        expect(receipts).not.toContain(value);
      }
      // The reply names the signing officers, as the report does; never the officers it lists.
      for (const value of facts.personalData) expect(replays).not.toContain(value);
    });

    it('S6: without a step-up, or with one older than five minutes, confirm is 403 step-up-required', async () => {
      await draft();
      await reviewedDraft();
      api.clock.set(CONFIRMED_AT);

      const plain = await confirm(COMMISSION_ADMIN);
      const stale = await confirm(steppedUp(COMMISSION_ADMIN, '2028-07-20T06:54:00.000Z'));
      const otherLevel = await confirm({
        ...COMMISSION_ADMIN,
        acr: '1',
        authTime: '2028-07-20T06:59:00.000Z',
      });

      for (const response of [plain, stale, otherLevel]) {
        expect(response.statusCode).toBe(403);
        expect(response.json()).toMatchObject({ code: 'step-up-required' });
      }
      expect((await api.get(path(), SUPERVISOR)).json()).toMatchObject({ status: 'reviewed' });
    });

    it('S6: a second confirm is 409; a replay with the same Idempotency-Key answers the same', async () => {
      await draft();
      await reviewedDraft();
      const admin = adminAt(CONFIRMED_AT);
      const key = randomUUID();

      const first = await confirm(admin, { key });
      const replay = await confirm(admin, { key });
      const second = await confirm(admin);

      expect(first.statusCode).toBe(200);
      expect(replay.statusCode).toBe(200);
      expect(replay.headers['idempotent-replayed']).toBe('true');
      expect(replay.json()).toEqual(first.json());
      expect(second.statusCode).toBe(409);
      expect(second.json()).toMatchObject({ code: 'report-submitted' });
      expect(
        (await api.events()).filter((event) => event.type === 'compliance-report.submitted.v1'),
      ).toHaveLength(1);
    });

    it('S6: confirm needs the draft reviewed and complete; a refused confirm uses no reference', async () => {
      await draft();
      const admin = adminAt(CONFIRMED_AT);

      const unreviewed = await confirm(admin);
      expect(unreviewed.statusCode).toBe(400);
      expect(unreviewed.json()).toMatchObject({ code: 'not-reviewed' });

      // Reviewed, but Part I has no email yet.
      await api.send('POST', `${path()}/reviewed`, SUPERVISOR, { designation: 'Director' });
      const incomplete = await confirm(admin);
      expect(incomplete.statusCode).toBe(400);
      expect(incomplete.json()).toMatchObject({
        code: 'incomplete',
        errors: [expect.objectContaining({ path: 'partI.emailAddress' })],
      });

      await api.send('PATCH', `${path()}/manual`, COMMISSION_ADMIN, CONTACTS);
      const done = await confirm(admin);
      expect(done.json()).toMatchObject({
        reference: format(RPT, { issuer: 'PSC', period: 2027, sequence: 1 }),
      });
    });

    it('S6: a submitted report is frozen: edits, review and compile answer 409 report-submitted', async () => {
      const { facts } = await draft();
      await reviewedDraft();
      await confirm(adminAt(CONFIRMED_AT));

      const responses = [
        await api.send('PATCH', `${path()}/remarks`, SUPERVISOR, {
          remarks: [{ obligationId: facts.initial.noticed.obligationId, remark: 'Late' }],
        }),
        await api.send('PATCH', `${path()}/manual`, COMMISSION_ADMIN, CONTACTS),
        await api.send('POST', `${path()}/reviewed`, SUPERVISOR, { designation: 'Director' }),
        await api.send('POST', `${path()}/compile`, SUPERVISOR),
      ];

      for (const response of responses) {
        expect(response.statusCode).toBe(409);
        expect(response.json()).toMatchObject({ code: 'report-submitted' });
      }
    });

    it('S6: confirming starts the workflow again when it is not running, and the documents are still issued', async () => {
      await draft();
      await reviewedDraft();
      await endWorkflows();

      expect((await confirm(adminAt(CONFIRMED_AT))).statusCode).toBe(200);

      const issued = await issuedReport();
      expect(issued.formMDocumentId).toEqual(expect.any(String));
      expect(api.documents.issued.map((request) => request.type)).toEqual([
        'form-m',
        'compliance-report-receipt',
      ]);
    });
  });

  describe('S7: late and reminders', () => {
    it('S7: a confirm on 5 August is accepted and marked late', async () => {
      const { report } = await draft();
      await reviewedDraft();

      const response = await confirm(adminAt('2028-08-05T07:00:00.000Z'));

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ status: 'submitted', late: true });
      const receipts = await api.asPlatform((tx) => tx.select().from(reportReceipts));
      expect(receipts).toEqual([expect.objectContaining({ reportId: report.id, late: true })]);
      const submitted = await api.events('compliance-report.submitted.v1');
      expect(submitted.map((event) => event.data)).toEqual([
        expect.objectContaining({ reportId: report.id, late: true }),
      ]);
      await issuedReport();
      expect(api.documents.issued[1]?.payload).toMatchObject({ late: true });
    });

    it('S7: a confirm on 31 July is on time', async () => {
      await draft();
      await reviewedDraft();

      // 23:30 in Nairobi on 31 July.
      const response = await confirm(adminAt('2028-07-31T20:30:00.000Z'));

      expect(response.json()).toMatchObject({ late: false });
    });

    it('S7: a reminder emails the supervisor and commission-admin once, is recorded and announced; none once submitted', async () => {
      const { report } = await draft();
      api.clock.set('2028-07-24T06:00:00.000Z');

      const first = await api.activities.remind({ tenant: 'psc', fy: 2027, daysBefore: 7 });
      const again = await api.activities.remind({ tenant: 'psc', fy: 2027, daysBefore: 7 });

      expect(first).toEqual({ outcome: 'sent', recipients: 2 });
      expect(again).toEqual({ outcome: 'sent', recipients: 2 });
      const reminders = api.notifications.sent.filter(
        (message) => message.template === 'form-m-reminder-email',
      );
      expect(reminders.map((message) => message.to).sort()).toEqual([
        'admin@psc.go.ke',
        'supervisor@psc.go.ke',
      ]);
      expect(reminders[0]).toMatchObject({
        tenant: 'psc',
        params: { financialYear: '2027/2028', dueDate: '2028-07-31', daysLeft: 7 },
      });
      expect(await api.asPlatform((tx) => tx.select().from(reportReminders))).toEqual([
        {
          reportId: report.id,
          tenant: 'psc',
          daysBefore: 7,
          recipients: 2,
          sentAt: new Date('2028-07-24T06:00:00.000Z'),
        },
      ]);
      expect(
        (await api.events()).filter((event) => event.type === 'compliance-report.reminder-sent.v1'),
      ).toEqual([
        expect.objectContaining({
          tenant: 'psc',
          subject: report.id,
          data: { reportId: report.id, fy: 2027, daysBefore: 7, recipients: 2 },
        }),
      ]);

      await reviewedDraft();
      await confirm(adminAt(CONFIRMED_AT));
      const after = await api.activities.remind({ tenant: 'psc', fy: 2027, daysBefore: 1 });

      expect(after).toEqual({ outcome: 'submitted' });
      expect(
        api.notifications.sent.filter((message) => message.template === 'form-m-reminder-email'),
      ).toHaveLength(2);
    });
  });

  describe('Part I contact details', () => {
    /** FY 2026 compiled (no facts: zeros), with Part I entered and, when asked, submitted. */
    async function fy2026Report(submit: boolean): Promise<void> {
      api.clock.set(COMPILED_AT);
      expect((await api.send('POST', `${path(2026)}/compile`, SUPERVISOR)).statusCode).toBe(202);
      await compiledReport(api, 2026);
      if (!submit) {
        await api.send('PATCH', `${path(2026)}/manual`, COMMISSION_ADMIN, CONTACTS);
        return;
      }
      await reviewedDraft(2026);
      expect((await confirm(adminAt(COMPILED_AT), { fy: 2026 })).statusCode).toBe(200);
      await issuedReport(2026);
    }

    it('carry over from the Commission previous submitted report', async () => {
      await fy2026Report(true);

      const { report } = await draft();

      expect(report.document?.partI).toMatchObject(CONTACTS);
      expect(report.document ? formMIssues(report.document).issues : null).toEqual([]);
    });

    it('stay blank for the commission-admin without a previous submitted report', async () => {
      // A previous draft that was never submitted does not count.
      await fy2026Report(false);

      const { report } = await draft();

      expect(report.document?.partI).toMatchObject({
        contactDetails: '',
        physicalAddress: '',
        emailAddress: '',
      });
    });

    it('entered on this report are kept over the previous report', async () => {
      await fy2026Report(true);
      await draft();
      await api.send('PATCH', `${path()}/manual`, COMMISSION_ADMIN, {
        emailAddress: 'form-m@publicservice.go.ke',
      });

      api.clock.set('2028-07-02T06:00:00.000Z');
      await api.send('POST', `${path()}/compile`, SUPERVISOR);
      const recompiled = await compiledReport(api, 2027, new Date(COMPILED_AT));

      expect(recompiled.document?.partI.emailAddress).toBe('form-m@publicservice.go.ke');
    });
  });
});
