import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  NATIONAL_CONSOLIDATION_WORKFLOW,
  nationalConsolidationWorkflowId,
} from '../../src/compliance-reports/contract.js';
import type { ReportCounts } from '../../src/compliance-reports/schema.js';
import { config } from '../../src/config.js';
import {
  complianceReports,
  nationalReportParagraphs,
  nationalReports,
  reportReceipts,
} from '../../src/db/schema.js';
import { nationalReportApprovalWorkflowId } from '../../src/national-reports/contract.js';
import { contractErrors, okResponse } from '../support/contract.js';
import { COMMISSION_ADMIN, REPORTING_OFFICER, SUPERVISOR } from '../support/form-m-facts.js';
import { type Caller, type ReportingApi, startReportingApi } from '../support/reporting-api.js';
import { historyPayloads } from '../support/workflow-history.js';

/**
 * S11 through the HTTP API and the approval workflow on Temporal. FY 2027: `psc` submitted on
 * time and `tsc` late; `jsc` has not reported. An EACC analyst builds the national consolidated
 * report from the submitted reports (national totals, a row per Commission, rates) and types its
 * narrative; a rebuild keeps the narrative. The author cannot approve; another EACC supervisor
 * does: `NCR-EACC-2028-0000001-<check>` (the year's end, ADR-011 §2), the Restricted PDF through
 * documents, `ncr.approved.v1`, and the year's chase ends. The authorisation rows of the matrix.
 * Ids only in Temporal history and events.
 */
describe('National consolidated report (S11)', () => {
  let api: ReportingApi;

  const ANALYST: Caller = {
    sub: 'eacc-analyst-1',
    tenant: 'eacc',
    roles: ['eacc-analyst'],
    name: 'Amina Hassan',
  };
  const SUPERVISOR_A: Caller = {
    sub: 'eacc-supervisor-1',
    tenant: 'eacc',
    roles: ['eacc-supervisor'],
    name: 'Joseph Mwangi',
  };
  const SUPERVISOR_B: Caller = {
    sub: 'eacc-supervisor-2',
    tenant: 'eacc',
    roles: ['eacc-supervisor'],
    name: 'Mary Achieng',
  };
  const PSC_REVIEWER: Caller = { sub: 'reviewer-psc', tenant: 'psc', roles: ['reviewer'] };
  /** EACC's role held for another tenant: not an EACC account. */
  const ANALYST_OF_PSC: Caller = { sub: 'odd-1', tenant: 'psc', roles: ['eacc-analyst'] };

  const NCR = '/v1/eacc/national-reports/2027';
  const BUILT_AT = '2028-08-20T07:00:00.000Z';

  const NARRATIVE = {
    overview: 'Two of three Commissions reported for 2027/2028.\n\nOne reported late.',
    findings: 'Biennial declarations lag behind initial ones.',
    recommendations: 'Chase the Judicial Service Commission.',
  };

  const PSC_COUNTS: ReportCounts = {
    initial: { expected: 10, declared: 8, notDeclared: 2 },
    biennial: { expected: 100, declared: 90, notDeclared: 10, noCycleInPeriod: false },
    final: { expected: 4, declared: 3, notDeclared: 1 },
    clarifications: 5,
    accessRequests: { received: 2, granted: 1, declined: 1 },
  };
  const TSC_COUNTS: ReportCounts = {
    initial: { expected: 20, declared: 20, notDeclared: 0 },
    biennial: { expected: 200, declared: 150, notDeclared: 50, noCycleInPeriod: false },
    final: { expected: 6, declared: 6, notDeclared: 0 },
    clarifications: 3,
    accessRequests: { received: 0, granted: 0, declined: 0 },
  };

  beforeAll(async () => {
    api = await startReportingApi();
    return async () => {
      await endChase();
      await api.close();
    };
  });

  beforeEach(async () => {
    await endChase();
    await api.reset();
    for (const slug of ['psc', 'tsc', 'jsc']) api.directory.givenCommission(slug);
  });

  const endChase = () => api.endWorkflows([nationalConsolidationWorkflowId(2027)]);

  /** The Commission's FY 2027 report as submitted, and EACC's receipt of it. */
  async function givenSubmitted(
    tenant: string,
    counts: ReportCounts,
    submittedAt: string,
    late: boolean,
  ): Promise<{ reportId: string; reference: string }> {
    const reportId = uuidv7();
    const reference = `RPT-${tenant.toUpperCase()}-2027-0000001-X`;
    const at = new Date(submittedAt);
    await api.asPlatform(async (tx) => {
      await tx.insert(complianceReports).values({
        id: reportId,
        tenant,
        fy: 2027,
        status: 'submitted',
        source: 'hosted',
        reference,
        submittedAt: at,
        late,
        counts,
      });
      await tx.insert(reportReceipts).values({
        reportId,
        tenant,
        fy: 2027,
        reference,
        source: 'hosted',
        submittedAt: at,
        late,
        counts,
      });
    });
    return { reportId, reference };
  }

  async function givenPscAndTscReported() {
    const psc = await givenSubmitted('psc', PSC_COUNTS, '2028-07-20T07:00:00.000Z', false);
    const tsc = await givenSubmitted('tsc', TSC_COUNTS, '2028-08-05T07:00:00.000Z', true);
    return { psc, tsc };
  }

  async function built(caller: Caller = ANALYST): Promise<NationalReportBody> {
    api.clock.set(BUILT_AT);
    const response = await api.send('POST', `${NCR}/build`, caller);
    expect(response.statusCode, response.body).toBe(200);
    return response.json<NationalReportBody>();
  }

  async function saved(narrative: typeof NARRATIVE, caller: Caller = ANALYST) {
    const response = await api.send('PATCH', `${NCR}/narrative`, caller, narrative);
    expect(response.statusCode, response.body).toBe(200);
    return response.json<NationalReportBody>();
  }

  function approve(caller: Caller, key: string = randomUUID()) {
    return api.send('POST', `${NCR}/approve`, caller, undefined, { 'idempotency-key': key });
  }

  it('S11: an eacc-analyst builds the NCR from the submitted reports: national totals, a row per Commission, rates', async () => {
    const { psc, tsc } = await givenPscAndTscReported();

    const report = await built();

    expect(
      contractErrors(okResponse('/v1/eacc/national-reports/{fy}/build', 'post'), report),
    ).toEqual([]);
    expect(report).toMatchObject({
      fy: 2027,
      version: 1,
      status: 'draft',
      builtAt: BUILT_AT,
      reportsIncluded: 2,
      narrative: { overview: '', findings: '', recommendations: '' },
      narrativeParagraphs: [],
      author: { subject: ANALYST.sub, name: 'Amina Hassan' },
      approver: null,
      reference: null,
      documentId: null,
    });
    expect(report.aggregates.reporting).toEqual({
      commissions: 3,
      reported: 2,
      onTime: 1,
      late: 1,
      notReported: 1,
      rate: 0.6667,
    });
    expect(report.aggregates.national).toEqual({
      initial: { expected: 30, declared: 28, notDeclared: 2, rate: 0.9333 },
      biennial: { expected: 300, declared: 240, notDeclared: 60, rate: 0.8 },
      final: { expected: 10, declared: 9, notDeclared: 1, rate: 0.9 },
      all: { expected: 340, declared: 277, notDeclared: 63, rate: 0.8147 },
      clarifications: 8,
      accessRequests: { received: 2, granted: 1, declined: 1 },
    });
    expect(Object.keys(report.aggregates.byCommission)).toEqual(['jsc', 'psc', 'tsc']);
    expect(report.aggregates.byCommission.psc).toEqual({
      name: 'Public Service Commission',
      status: 'submitted-on-time',
      reportId: psc.reportId,
      reference: psc.reference,
      submittedAt: '2028-07-20T07:00:00.000Z',
      initial: { expected: 10, declared: 8, notDeclared: 2, rate: 0.8 },
      biennial: { expected: 100, declared: 90, notDeclared: 10, rate: 0.9, noCycleInPeriod: false },
      final: { expected: 4, declared: 3, notDeclared: 1, rate: 0.75 },
      clarifications: 5,
      accessRequests: { received: 2, granted: 1, declined: 1 },
    });
    expect(report.aggregates.byCommission.tsc).toMatchObject({
      status: 'submitted-late',
      reportId: tsc.reportId,
      biennial: { rate: 0.75 },
    });
    expect(report.aggregates.byCommission.jsc).toMatchObject({
      name: 'Judicial Service Commission',
      status: 'not-reported',
      reportId: null,
      initial: null,
    });

    // Read back as any EACC role.
    const read = await api.get(NCR, SUPERVISOR_A);
    expect(read.statusCode).toBe(200);
    expect(
      contractErrors(okResponse('/v1/eacc/national-reports/{fy}', 'get'), read.json()),
    ).toEqual([]);
    expect(read.json()).toEqual(report);

    const drafted = (await api.events()).filter((event) => event.type === 'ncr.drafted.v1');
    expect(drafted).toEqual([
      expect.objectContaining({
        tenant: 'eacc',
        subject: report.id,
        data: {
          nationalReportId: report.id,
          fy: 2027,
          version: 1,
          status: 'draft',
          reference: null,
          reportsIncluded: 2,
        },
      }),
    ]);
  });

  it('S11: the narrative is saved as paragraphs per section; a rebuild keeps it and takes in a new report', async () => {
    await givenPscAndTscReported();
    await built();

    const withNarrative = await saved(NARRATIVE);
    expect(
      contractErrors(
        okResponse('/v1/eacc/national-reports/{fy}/narrative', 'patch'),
        withNarrative,
      ),
    ).toEqual([]);
    expect(withNarrative.version).toBe(2);
    expect(withNarrative.narrative).toEqual(NARRATIVE);
    expect(
      withNarrative.narrativeParagraphs.map(({ section, position, text, aiDraft }) => ({
        section,
        position,
        text,
        aiDraft,
      })),
    ).toEqual([
      {
        section: 'overview',
        position: 0,
        text: 'Two of three Commissions reported for 2027/2028.',
        aiDraft: false,
      },
      { section: 'overview', position: 1, text: 'One reported late.', aiDraft: false },
      {
        section: 'findings',
        position: 0,
        text: 'Biennial declarations lag behind initial ones.',
        aiDraft: false,
      },
      {
        section: 'recommendations',
        position: 0,
        text: 'Chase the Judicial Service Commission.',
        aiDraft: false,
      },
    ]);

    // jsc reports; the analyst rebuilds.
    await givenSubmitted('jsc', PSC_COUNTS, '2028-08-19T07:00:00.000Z', true);
    const rebuilt = await built();
    expect(rebuilt.version).toBe(3);
    expect(rebuilt.reportsIncluded).toBe(3);
    expect(rebuilt.aggregates.reporting).toMatchObject({ reported: 3, notReported: 0 });
    expect(rebuilt.narrative).toEqual(NARRATIVE);
    expect(rebuilt.narrativeParagraphs).toEqual(withNarrative.narrativeParagraphs);
  });

  it('S11: a paragraph keeps its id and labels while unchanged; an edit clears the AI-draft label', async () => {
    await givenPscAndTscReported();
    await built();
    const first = await saved(NARRATIVE);
    const [lead, second] = first.narrativeParagraphs;
    if (!lead || !second) throw new Error('two overview paragraphs expected');
    // As spec 09b's AI draft labels its paragraphs.
    await api.asPlatform((tx) =>
      tx
        .update(nationalReportParagraphs)
        .set({ aiDraft: true, aggregateRefs: ['national.all.rate'], candidateIds: ['c-1'] })
        .where(eq(nationalReportParagraphs.nationalReportId, first.id)),
    );

    // A paragraph added on top: the others keep their ids and labels.
    const added = await saved({
      ...NARRATIVE,
      overview: `A new opening.\n\n${NARRATIVE.overview}`,
    });
    const overview = added.narrativeParagraphs.filter((p) => p.section === 'overview');
    expect(overview.map((p) => [p.position, p.text, p.aiDraft])).toEqual([
      [0, 'A new opening.', false],
      [1, lead.text, true],
      [2, second.text, true],
    ]);
    expect(overview[1]).toMatchObject({
      id: lead.id,
      aggregateRefs: ['national.all.rate'],
      candidateIds: ['c-1'],
    });

    // Editing the lead paragraph keeps its id and clears its label.
    const edited = await saved({
      ...NARRATIVE,
      overview: `A new opening.\n\nTwo of three Commissions reported.\n\n${second.text}`,
    });
    expect(edited.narrativeParagraphs.find((p) => p.id === lead.id)).toMatchObject({
      position: 1,
      text: 'Two of three Commissions reported.',
      aiDraft: false,
    });
    expect(edited.narrativeParagraphs.find((p) => p.id === second.id)?.aiDraft).toBe(true);

    // Clearing a section removes its paragraphs.
    const cleared = await saved({ ...NARRATIVE, findings: '' });
    expect(cleared.narrativeParagraphs.some((p) => p.section === 'findings')).toBe(false);
    expect(cleared.narrative.findings).toBe('');
  });

  it('S11: the author cannot approve (403 separation-of-duties); nor can a supervisor who wrote the narrative', async () => {
    await givenPscAndTscReported();
    await built(SUPERVISOR_A);

    const byAuthor = await approve(SUPERVISOR_A);
    expect(byAuthor.statusCode, byAuthor.body).toBe(403);
    expect(byAuthor.json()).toMatchObject({ code: 'separation-of-duties' });

    await saved(NARRATIVE, SUPERVISOR_B);
    const byWriter = await approve(SUPERVISOR_B);
    expect(byWriter.statusCode).toBe(403);
    expect(byWriter.json()).toMatchObject({ code: 'separation-of-duties' });

    const report = (await api.get(NCR, ANALYST)).json<NationalReportBody>();
    expect(report).toMatchObject({ status: 'draft', reference: null, approver: null });
    expect((await api.events()).some((event) => event.type === 'ncr.approved.v1')).toBe(false);
  });

  it('S11: an eacc-supervisor approves: NCR-EACC-2028-0000001-<check>, the PDF, ncr.approved.v1, and the chase ends', async () => {
    await givenPscAndTscReported();
    await built();
    await saved(NARRATIVE);
    // The year's chase is waiting for its next weekly round.
    const chase = await api.temporal.workflow.start(NATIONAL_CONSOLIDATION_WORKFLOW, {
      taskQueue: config.TEMPORAL_TASK_QUEUE,
      workflowId: nationalConsolidationWorkflowId(2027),
      args: [{ fy: 2027, rounds: 1, chases: 1, nextAt: Date.now() + 24 * 60 * 60 * 1000 }],
    });

    api.clock.set('2028-08-25T08:00:00.000Z');
    const key = randomUUID();
    const response = await approve(SUPERVISOR_A, key);
    expect(response.statusCode, response.body).toBe(200);
    const approved = response.json<NationalReportBody>();
    expect(
      contractErrors(okResponse('/v1/eacc/national-reports/{fy}/approve', 'post'), approved),
    ).toEqual([]);
    expect(approved).toMatchObject({
      status: 'approved',
      version: 3,
      approver: { subject: SUPERVISOR_A.sub, name: 'Joseph Mwangi' },
      approvedAt: '2028-08-25T08:00:00.000Z',
      author: { subject: ANALYST.sub },
      narrative: NARRATIVE,
    });
    expect(approved.reference).toMatch(/^NCR-EACC-2028-0000001-[0-9A-Z]$/);

    // The workflow issues the Restricted PDF through documents and keeps its id.
    const withPdf = await vi.waitFor(
      async () => {
        const body = (await api.get(NCR, ANALYST)).json<NationalReportBody>();
        if (!body.documentId) throw new Error('not issued yet');
        return body;
      },
      { timeout: 45_000, interval: 250 },
    );
    expect(api.documents.issued).toHaveLength(1);
    const [pdf] = api.documents.issued;
    expect(pdf).toMatchObject({
      type: 'ncr',
      disclosureLevel: 'restricted',
      issuerTenant: 'eacc',
      subjectRef: `national-report:${approved.id}`,
      subjectPersonId: null,
      publicPayload: {
        reference: approved.reference,
        type: 'ncr',
        issuer: 'EACC',
        issuedAt: '2028-08-25T08:00:00.000Z',
      },
      payload: {
        reference: approved.reference,
        financialYear: '2027/2028',
        reportsIncluded: 2,
        narrative: NARRATIVE,
        author: 'Amina Hassan',
        approver: 'Joseph Mwangi',
      },
    });
    expect(pdf?.payload).toHaveProperty('aggregates.national.all.rate', 0.8147);

    // The event: ids, the year and the reference only.
    const approvedEvents = (await api.events()).filter((event) => event.type === 'ncr.approved.v1');
    expect(approvedEvents).toEqual([
      expect.objectContaining({
        tenant: 'eacc',
        subject: approved.id,
        data: {
          nationalReportId: approved.id,
          fy: 2027,
          version: 3,
          status: 'approved',
          reference: approved.reference,
          reportsIncluded: 2,
        },
      }),
    ]);

    // The chase ends.
    expect(await chase.result()).toEqual({ rounds: 1, chases: 1, ended: 'ncr-approved' });
    const approval = api.temporal.workflow.getHandle(nationalReportApprovalWorkflowId(approved.id));
    expect(await approval.result()).toEqual({ documentId: withPdf.documentId, chaseEnded: true });

    // Nothing personal or narrative in Temporal history or the events.
    const history = await historyPayloads(
      api.temporal,
      nationalReportApprovalWorkflowId(approved.id),
    );
    expect(history).toContain(approved.id);
    const published = JSON.stringify(await api.events());
    for (const text of [
      'Amina Hassan',
      'Joseph Mwangi',
      ANALYST.sub,
      SUPERVISOR_A.sub,
      'Biennial declarations',
      'Public Service Commission',
    ]) {
      expect(history).not.toContain(text);
      expect(published).not.toContain(text);
    }

    // An approval needs an Idempotency-Key; a retried approval replays and the report no longer
    // changes.
    expect((await api.send('POST', `${NCR}/approve`, SUPERVISOR_B)).statusCode).toBe(400);
    const replay = await approve(SUPERVISOR_A, key);
    expect(replay.statusCode).toBe(200);
    expect(replay.json<NationalReportBody>().reference).toBe(approved.reference);
    for (const refused of [
      await approve(SUPERVISOR_B),
      await api.send('POST', `${NCR}/build`, ANALYST),
      await api.send('PATCH', `${NCR}/narrative`, ANALYST, NARRATIVE),
    ]) {
      expect(refused.statusCode).toBe(409);
      expect(refused.json()).toMatchObject({ code: 'ncr-approved' });
    }
    const [row] = await api.asPlatform((tx) => tx.select().from(nationalReports));
    expect(row).toMatchObject({ status: 'approved', reference: approved.reference });
    expect(api.documents.issued).toHaveLength(1);
  });

  it('S11: a chase started after the approval ends at once', async () => {
    await givenPscAndTscReported();
    await built();
    const approved = await approve(SUPERVISOR_A);
    expect(approved.statusCode).toBe(200);
    // No chase ran to be told.
    const approval = api.temporal.workflow.getHandle(
      nationalReportApprovalWorkflowId(approved.json<NationalReportBody>().id),
    );
    expect(await approval.result()).toMatchObject({ chaseEnded: false });

    const chase = await api.temporal.workflow.start(NATIONAL_CONSOLIDATION_WORKFLOW, {
      taskQueue: config.TEMPORAL_TASK_QUEUE,
      workflowId: nationalConsolidationWorkflowId(2027),
      args: [{ fy: 2027, nextAt: Date.now() }],
    });
    expect(await chase.result()).toEqual({ rounds: 0, chases: 0, ended: 'ncr-approved' });
    expect(api.notifications.sent).toEqual([]);
  });

  describe('S11 authorisation', () => {
    it('Commission roles, a reviewer and an EACC role of another tenant get 403 on read, build and narrative', async () => {
      await givenPscAndTscReported();
      await built();
      for (const caller of [
        SUPERVISOR,
        COMMISSION_ADMIN,
        REPORTING_OFFICER,
        PSC_REVIEWER,
        ANALYST_OF_PSC,
        { sub: 'nobody', tenant: null, roles: [] },
      ]) {
        expect((await api.get(NCR, caller)).statusCode, caller.sub).toBe(403);
        expect((await api.send('POST', `${NCR}/build`, caller)).statusCode, caller.sub).toBe(403);
        expect(
          (await api.send('PATCH', `${NCR}/narrative`, caller, NARRATIVE)).statusCode,
          caller.sub,
        ).toBe(403);
      }
    });

    it('only an eacc-supervisor approves: an eacc-analyst and Commission roles get 403', async () => {
      await givenPscAndTscReported();
      await built(SUPERVISOR_B);
      for (const caller of [ANALYST, SUPERVISOR, COMMISSION_ADMIN, PSC_REVIEWER, ANALYST_OF_PSC]) {
        const response = await approve(caller);
        expect(response.statusCode, caller.sub).toBe(403);
        expect(response.json(), caller.sub).not.toMatchObject({ code: 'separation-of-duties' });
      }
      expect((await api.get(NCR, ANALYST)).json()).toMatchObject({ status: 'draft' });
    });

    it('an eacc-supervisor may build and write the narrative (then cannot approve)', async () => {
      await givenPscAndTscReported();
      const report = await built(SUPERVISOR_A);
      expect(report.author).toEqual({ subject: SUPERVISOR_A.sub, name: 'Joseph Mwangi' });
      expect(
        (await api.send('PATCH', `${NCR}/narrative`, SUPERVISOR_A, NARRATIVE)).statusCode,
      ).toBe(200);
    });

    it('404 before the first build; 409 building before any Commission reported; 503 while the directory is down', async () => {
      expect((await api.get(NCR, ANALYST)).statusCode).toBe(404);
      expect((await api.send('PATCH', `${NCR}/narrative`, ANALYST, NARRATIVE)).statusCode).toBe(
        404,
      );
      expect((await approve(SUPERVISOR_A)).statusCode).toBe(404);

      const early = await api.send('POST', `${NCR}/build`, ANALYST);
      expect(early.statusCode).toBe(409);
      expect(early.json()).toMatchObject({ code: 'no-submitted-reports' });

      await givenPscAndTscReported();
      api.directory.failCalls(1);
      expect((await api.send('POST', `${NCR}/build`, ANALYST)).statusCode).toBe(503);
      expect((await api.get(NCR, ANALYST)).statusCode).toBe(404);
    });

    it('400 for a narrative missing a section or too long, and for a year reports do not exist for', async () => {
      await givenPscAndTscReported();
      await built();
      const partial = { overview: NARRATIVE.overview, findings: NARRATIVE.findings };
      expect((await api.send('PATCH', `${NCR}/narrative`, ANALYST, partial)).statusCode).toBe(400);
      expect(
        (
          await api.send('PATCH', `${NCR}/narrative`, ANALYST, {
            ...NARRATIVE,
            overview: 'x'.repeat(20_001),
          })
        ).statusCode,
      ).toBe(400);
      expect((await api.get('/v1/eacc/national-reports/2020', ANALYST)).statusCode).toBe(400);
    });
  });
});

interface ParagraphBody {
  id: string;
  section: string;
  position: number;
  text: string;
  aiDraft: boolean;
  aggregateRefs: string[];
  candidateIds: string[];
}

interface SectionBody {
  expected: number;
  declared: number;
  notDeclared: number;
  rate: number | null;
}

interface NationalReportBody {
  id: string;
  fy: number;
  version: number;
  status: string;
  builtAt: string | null;
  reportsIncluded: number;
  aggregates: {
    reporting: Record<string, number | null>;
    national: Record<string, SectionBody | number | Record<string, number>>;
    byCommission: Record<string, Record<string, unknown>>;
  };
  narrative: { overview: string; findings: string; recommendations: string };
  narrativeParagraphs: ParagraphBody[];
  author: { subject: string; name: string } | null;
  approver: { subject: string; name: string } | null;
  approvedAt: string | null;
  reference: string | null;
  documentId: string | null;
}
