import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { complianceReports, nationalReports, reportReceipts } from '../../src/db/schema.js';
import { contractErrors, okResponse } from '../support/contract.js';
import type { FakeJobAnswer } from '../support/fakes.js';
import { SUPERVISOR } from '../support/form-m-facts.js';
import {
  FY2027_CANDIDATES,
  HISTORY,
  HISTORY_COMMISSIONS,
  HISTORY_FYS,
  type HistoryFy,
} from '../support/ncr-history.js';
import { type Caller, type ReportingApi, startReportingApi } from '../support/reporting-api.js';

/** The ai-gateway's contract, to check the task input the service sends against it. */
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats.default(ajv);
ajv.addSchema(
  parse(
    readFileSync(
      createRequire(import.meta.url).resolve('@adili/schemas/internal/ai-gateway.yaml'),
      'utf8',
    ),
  ) as object,
  'ai-gateway.yaml',
);
const validTaskRequest = ajv.compile({ $ref: 'ai-gateway.yaml#/components/schemas/TaskRequest' });

/**
 * S2 and S3 through the HTTP API on real Postgres, the ai-gateway faked. FY 2025 to FY 2027 of
 * submitted reports (`ncr-history.ts`), each year's NCR built by an EACC analyst. Drafting the
 * FY 2027 narrative sends the gateway the figures and pattern candidates only; the drafted
 * paragraphs land as AI drafts citing their keys, a draft that failed validation inserts nothing,
 * a draft not ready within the wait is answered 202 and inserted when the report is read. An
 * edit clears the AI-draft label; a redraft replaces only paragraphs still AI drafts, or the
 * whole section with `replaceAll`. An approved report refuses drafting, and whoever drafted
 * cannot approve (09 S11 unchanged).
 */
describe('NCR narrative draft (S2, S3)', () => {
  let api: ReportingApi;

  const ANALYST: Caller = {
    sub: 'eacc-analyst-1',
    tenant: 'eacc',
    roles: ['eacc-analyst'],
    name: 'Amina Hassan',
  };
  const EACC_SUPERVISOR: Caller = {
    sub: 'eacc-supervisor-1',
    tenant: 'eacc',
    roles: ['eacc-supervisor'],
    name: 'Joseph Mwangi',
  };
  /** EACC's role held for another tenant: not an EACC account. */
  const ANALYST_OF_PSC: Caller = { sub: 'odd-1', tenant: 'psc', roles: ['eacc-analyst'] };

  const NCR = '/v1/eacc/national-reports/2027';
  const DRAFT = '/v1/eacc/national-reports/{fy}/narrative/draft';
  const BUILT_AT = '2028-08-20T07:00:00.000Z';

  const OVERVIEW = {
    section: 'overview',
    text: 'Six of seven Commissions reported for 2027/2028.',
    aggregateRefs: ['national.commissionsReported', 'national.commissions'],
    candidateIds: [],
  } as const;
  const FINDING_TSC = {
    section: 'findings',
    text: "The Teachers Service Commission's non-filer rate rose from 4% to 8.75%.",
    aggregateRefs: ['fy2027.commission.tsc.nonFilerRate', 'commission.tsc.nonFilerRate'],
    candidateIds: ['rate-change:tsc:nonFilerRate'],
  } as const;
  const FINDING_NLC = {
    section: 'findings',
    text: 'The National Land Commission did not report.',
    aggregateRefs: ['commission.nlc.reported'],
    candidateIds: ['non-reporting:nlc:reported'],
  } as const;
  const RECOMMENDATION = {
    section: 'recommendations',
    text: 'Chase the National Land Commission before the report is tabled.',
    aggregateRefs: ['commission.nlc.reported'],
    candidateIds: ['non-reporting:nlc:reported'],
  } as const;

  const succeeded = (...paragraphs: object[]): Extract<FakeJobAnswer, { status: 'succeeded' }> => ({
    status: 'succeeded',
    output: { label: { aiAssisted: true }, paragraphs },
  });

  beforeAll(async () => {
    api = await startReportingApi();
    return () => api.close();
  });

  beforeEach(async () => {
    await api.reset();
    for (const { slug } of HISTORY_COMMISSIONS) api.directory.givenCommission(slug);
    await givenHistoryBuilt();
  });

  async function givenSubmitted(fy: HistoryFy): Promise<void> {
    await api.asPlatform(async (tx) => {
      for (const { tenant, late, counts } of HISTORY[fy]) {
        const reportId = uuidv7();
        const reference = `RPT-${tenant.toUpperCase()}-${String(fy + 1)}-0000001-X`;
        const submittedAt = new Date(`${String(fy + 1)}-${late ? '08-05' : '07-20'}T07:00:00Z`);
        const report = { tenant, fy, reference, source: 'hosted' as const, submittedAt, late };
        await tx
          .insert(complianceReports)
          .values({ id: reportId, status: 'submitted', counts, ...report });
        await tx.insert(reportReceipts).values({ reportId, counts, ...report });
      }
    });
  }

  async function build(fy: number, at = BUILT_AT): Promise<void> {
    api.clock.set(at);
    const response = await api.send(
      'POST',
      `/v1/eacc/national-reports/${String(fy)}/build`,
      ANALYST,
    );
    expect(response.statusCode, response.body).toBe(200);
  }

  async function givenHistoryBuilt(): Promise<void> {
    for (const fy of HISTORY_FYS) {
      await givenSubmitted(fy);
      await build(fy);
    }
  }

  function draft(
    section: string,
    replaceAll = false,
    caller: Caller = ANALYST,
    key: string = randomUUID(),
  ) {
    return api.send(
      'POST',
      `${NCR}/narrative/draft`,
      caller,
      { section, replaceAll },
      {
        'idempotency-key': key,
      },
    );
  }

  async function report(): Promise<NationalReportBody> {
    const response = await api.get(NCR, ANALYST);
    expect(response.statusCode, response.body).toBe(200);
    return response.json<NationalReportBody>();
  }

  function jobIdOf(body: NationalReportBody): string {
    if (!body.narrativeDraft) throw new Error('No narrative draft');
    return body.narrativeDraft.jobId;
  }

  const paragraphsOf = (body: NationalReportBody) =>
    body.narrativeParagraphs.map((p) => ({
      section: p.section,
      text: p.text,
      aiDraft: p.aiDraft,
      aggregateRefs: p.aggregateRefs,
      candidateIds: p.candidateIds,
    }));

  it('S2: an eacc-analyst drafts all sections; the gateway gets the aggregates and candidates only; the paragraphs land as AI drafts', async () => {
    api.ai.answer(succeeded(OVERVIEW, FINDING_TSC, FINDING_NLC, RECOMMENDATION));
    const before = await report();

    const response = await draft('all');

    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<NationalReportBody>();
    expect(contractErrors(okResponse(DRAFT, 'post'), body)).toEqual([]);

    // The task call: EACC's, restricted, the report as subject, a 20 s wait.
    expect(api.ai.requests).toHaveLength(1);
    const [call] = api.ai.requests;
    expect(call).toMatchObject({
      task: 'narrate-compliance-report',
      waitSeconds: 20,
      request: {
        tenant: 'eacc',
        dataClass: 'restricted',
        subjectRef: `national-report:${before.id}`,
        promptVersion: 1,
      },
    });
    if (!call) throw new Error('No task call');
    const { tenant, ...sent } = call.request;
    expect(tenant).toBe('eacc');
    expect(
      validTaskRequest({ ...sent, waitSeconds: 20 }),
      JSON.stringify(validTaskRequest.errors),
    ).toBe(true);
    // Aggregates and candidates only: figures by name, Commission codes and names, no report
    // ids, references, dates or people.
    const { input } = call.request;
    expect(Object.keys(input).sort()).toEqual(
      [
        'candidates',
        'commissionTable',
        'fy',
        'kind',
        'language',
        'priorYears',
        'rates',
        'section',
        'totals',
      ].sort(),
    );
    expect(input).toMatchObject({ kind: 'narrate-compliance-report', fy: 2028, section: 'all' });
    expect(input.language).toBe('en');
    expect(input.candidates).toEqual(FY2027_CANDIDATES);
    expect(input.priorYears.map((year) => year.fy)).toEqual([2027, 2026]);
    expect(input.commissionTable.map((row) => row.code)).toEqual(
      HISTORY_COMMISSIONS.map((commission) => commission.slug),
    );
    expect(input.totals).toMatchObject({ commissions: 7, commissionsReported: 6 });
    expect(input.commissionTable.find((row) => row.code === 'tsc')).toMatchObject({
      commissionName: 'Teachers Service Commission',
      figures: { nonFilerRate: 0.0875, reported: 1 },
    });
    const serialised = JSON.stringify(input);
    expect(serialised).not.toMatch(/RPT-|[0-9a-f]{8}-[0-9a-f]{4}-|\d{4}-\d{2}-\d{2}T/);
    for (const name of ['Amina Hassan', 'Joseph Mwangi']) {
      expect(serialised).not.toContain(name);
    }

    // Inserted as AI drafts with their keys and candidates.
    expect(paragraphsOf(body)).toEqual([
      { ...OVERVIEW, aiDraft: true },
      { ...FINDING_TSC, aiDraft: true },
      { ...FINDING_NLC, aiDraft: true },
      { ...RECOMMENDATION, aiDraft: true },
    ]);
    expect(body.narrative).toEqual({
      overview: OVERVIEW.text,
      findings: `${FINDING_TSC.text}\n\n${FINDING_NLC.text}`,
      recommendations: RECOMMENDATION.text,
    });
    const jobId = body.narrativeDraft?.jobId;
    expect(body.narrativeDraft).toMatchObject({
      section: 'all',
      replaceAll: false,
      status: 'inserted',
      failureReason: null,
    });
    expect(body.version).toBe(before.version + 1);

    // The event: ids, year, section and job; no figures or text.
    const events = await api.events('ncr.narrative-drafted.v1');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ tenant: 'eacc', subject: before.id });
    expect(events[0]?.data).toEqual({
      nationalReportId: before.id,
      fy: 2027,
      section: 'all',
      jobId,
    });
  });

  it('S2: a draft that failed validation returns the reason and inserts nothing', async () => {
    api.ai.answer(succeeded(OVERVIEW));
    expect((await draft('overview')).statusCode).toBe(200);
    const before = await report();
    api.ai.answer({ status: 'failed', reason: 'validation' });

    const response = await draft('findings');

    expect(response.statusCode, response.body).toBe(409);
    expect(response.json()).toMatchObject({ code: 'narrative-validation' });
    const after = await report();
    expect(after.narrativeParagraphs).toEqual(before.narrativeParagraphs);
    expect(after.version).toBe(before.version);
    expect(after.narrativeDraft).toMatchObject({
      section: 'findings',
      status: 'failed',
      failureReason: 'validation',
    });
    expect(await api.events('ncr.narrative-drafted.v1')).toHaveLength(1);
  });

  it('S2: a draft not ready within the wait is answered 202 and inserted, once, when the report is read', async () => {
    api.ai.answer({ status: 'queued' });
    const key = randomUUID();

    const response = await draft('findings', false, ANALYST, key);

    expect(response.statusCode, response.body).toBe(202);
    const pending = response.json<NationalReportBody>();
    expect(contractErrors(okResponse(DRAFT, 'post', 202), pending)).toEqual([]);
    expect(pending.narrativeParagraphs).toEqual([]);
    expect(pending.narrativeDraft).toMatchObject({ status: 'drafting', section: 'findings' });
    const jobId = jobIdOf(pending);

    // Still drafting: reading the report changes nothing.
    expect((await report()).narrativeDraft?.status).toBe('drafting');

    api.ai.finish(jobId, succeeded(FINDING_TSC, FINDING_NLC));
    const polled = await report();
    expect(polled.narrativeDraft).toMatchObject({ jobId, status: 'inserted' });
    expect(paragraphsOf(polled)).toEqual([
      { ...FINDING_TSC, aiDraft: true },
      { ...FINDING_NLC, aiDraft: true },
    ]);

    // Read again, and the request retried with its key: the same job, inserted once.
    expect((await report()).narrativeParagraphs).toEqual(polled.narrativeParagraphs);
    const retried = await draft('findings', false, ANALYST, key);
    expect(retried.statusCode, retried.body).toBe(200);
    expect(retried.json<NationalReportBody>().narrativeParagraphs).toEqual(
      polled.narrativeParagraphs,
    );
    const [first, second] = api.ai.requests.map((each) => each.idempotencyKey);
    expect(api.ai.requests).toHaveLength(2);
    expect(second).toBe(first);
    expect(await api.events('ncr.narrative-drafted.v1')).toHaveLength(1);
  });

  it('S2: a polled draft that failed validation is recorded as failed and inserts nothing', async () => {
    api.ai.answer({ status: 'queued' });
    const response = await draft('all');
    expect(response.statusCode, response.body).toBe(202);
    const jobId = jobIdOf(response.json<NationalReportBody>());

    api.ai.finish(jobId, { status: 'failed', reason: 'validation' });
    const polled = await report();

    expect(polled.narrativeDraft).toMatchObject({
      status: 'failed',
      failureReason: 'validation',
    });
    expect(polled.narrativeParagraphs).toEqual([]);
    expect(await api.events('ncr.narrative-drafted.v1')).toEqual([]);
  });

  it('S2: a draft that ends after the aggregates were rebuilt is discarded', async () => {
    api.ai.answer({ status: 'queued' });
    const response = await draft('overview');
    const jobId = jobIdOf(response.json<NationalReportBody>());

    await build(2027, '2028-08-21T07:00:00.000Z');
    api.ai.finish(jobId, succeeded(OVERVIEW));
    const polled = await report();

    expect(polled.narrativeDraft).toMatchObject({
      status: 'failed',
      failureReason: 'aggregates-rebuilt',
    });
    expect(polled.narrativeParagraphs).toEqual([]);
  });

  it('S2: while the gateway cannot be reached, a draft is 503 and a pending one stays drafting', async () => {
    api.ai.failCalls(1);
    const refused = await draft('overview');
    expect(refused.statusCode, refused.body).toBe(503);

    api.ai.answer({ status: 'queued' });
    expect((await draft('overview')).statusCode).toBe(202);
    api.ai.failCalls(1);
    expect((await report()).narrativeDraft?.status).toBe('drafting');
  });

  it('S2: a job the gateway gate blocks is 409 `ai-not-enabled`; a provider failure 502; nothing inserted', async () => {
    api.ai.answer(
      { status: 'blocked', reason: 'policy' },
      { status: 'failed', reason: 'provider' },
    );

    const blocked = await draft('overview');
    expect(blocked.statusCode, blocked.body).toBe(409);
    expect(blocked.json()).toMatchObject({ code: 'ai-not-enabled' });

    const failed = await draft('overview');
    expect(failed.statusCode, failed.body).toBe(502);
    expect(failed.json()).toMatchObject({ code: 'narrative-draft-failed', reason: 'provider' });
    expect((await report()).narrativeParagraphs).toEqual([]);
  });

  it('S3: an edit clears the AI-draft label; a redraft of findings replaces only AI drafts; replace all replaces the section', async () => {
    api.ai.answer(succeeded(OVERVIEW, FINDING_TSC, FINDING_NLC, RECOMMENDATION));
    const drafted = (await draft('all')).json<NationalReportBody>();

    // The analyst edits the first finding through the narrative save.
    const editedText = "The Teachers Service Commission's non-filer rate more than doubled.";
    const saved = await api.send('PATCH', `${NCR}/narrative`, ANALYST, {
      ...drafted.narrative,
      findings: `${editedText}\n\n${FINDING_NLC.text}`,
    });
    expect(saved.statusCode, saved.body).toBe(200);
    const edited = saved.json<NationalReportBody>();
    expect(paragraphsOf(edited).filter((p) => p.section === 'findings')).toEqual([
      { ...FINDING_TSC, text: editedText, aiDraft: false },
      { ...FINDING_NLC, aiDraft: true },
    ]);

    // Redraft findings: the edited paragraph stays, the AI draft is replaced, other sections kept.
    const redrafted = {
      ...FINDING_NLC,
      text: 'The National Land Commission has not reported for the year.',
    };
    api.ai.answer(succeeded(redrafted));
    const redraft = await draft('findings');
    expect(redraft.statusCode, redraft.body).toBe(200);
    const afterRedraft = redraft.json<NationalReportBody>();
    expect(paragraphsOf(afterRedraft)).toEqual([
      { ...OVERVIEW, aiDraft: true },
      { ...FINDING_TSC, text: editedText, aiDraft: false },
      { ...redrafted, aiDraft: true },
      { ...RECOMMENDATION, aiDraft: true },
    ]);
    expect(afterRedraft.narrativeParagraphs[0]?.id).toBe(drafted.narrativeParagraphs[0]?.id);
    expect(afterRedraft.narrativeParagraphs[1]?.id).toBe(drafted.narrativeParagraphs[1]?.id);

    // Replace all: the whole section, the edited paragraph included.
    api.ai.answer(succeeded(FINDING_TSC));
    const replaced = await draft('findings', true);
    expect(replaced.statusCode, replaced.body).toBe(200);
    expect(paragraphsOf(replaced.json<NationalReportBody>())).toEqual([
      { ...OVERVIEW, aiDraft: true },
      { ...FINDING_TSC, aiDraft: true },
      { ...RECOMMENDATION, aiDraft: true },
    ]);
  });

  it('S3: whoever drafted the narrative cannot approve it (09 S11 separation of duties unchanged)', async () => {
    api.ai.answer(succeeded(OVERVIEW));
    expect((await draft('overview', false, EACC_SUPERVISOR)).statusCode).toBe(200);

    const response = await api.send('POST', `${NCR}/approve`, EACC_SUPERVISOR, undefined, {
      'idempotency-key': randomUUID(),
    });

    expect(response.statusCode, response.body).toBe(403);
    expect(response.json()).toMatchObject({ code: 'separation-of-duties' });
  });

  it('an approved report refuses drafting, and the gateway is not asked', async () => {
    await api.asPlatform((tx) =>
      tx.update(nationalReports).set({ status: 'approved' }).where(eq(nationalReports.fy, 2027)),
    );

    const response = await draft('all');

    expect(response.statusCode, response.body).toBe(409);
    expect(response.json()).toMatchObject({ code: 'ncr-approved' });
    expect(api.ai.requests).toEqual([]);
  });

  it('404 before the year is built', async () => {
    const response = await api.send(
      'POST',
      '/v1/eacc/national-reports/2028/narrative/draft',
      ANALYST,
      { section: 'all', replaceAll: false },
      { 'idempotency-key': randomUUID() },
    );

    expect(response.statusCode, response.body).toBe(404);
  });

  it('400 for an unknown section, or without an Idempotency-Key', async () => {
    expect((await draft('summary')).statusCode).toBe(400);
    const withoutKey = await api.send('POST', `${NCR}/narrative/draft`, ANALYST, {
      section: 'all',
      replaceAll: false,
    });
    expect(withoutKey.statusCode).toBe(400);
  });

  it.each([
    ['a Commission supervisor', SUPERVISOR],
    ['an eacc-analyst role held for a Commission', ANALYST_OF_PSC],
  ])('%s gets 403', async (_, caller) => {
    const response = await draft('all', false, caller);

    expect(response.statusCode, response.body).toBe(403);
    expect(api.ai.requests).toEqual([]);
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

interface NationalReportBody {
  id: string;
  version: number;
  narrative: Record<string, string>;
  narrativeParagraphs: ParagraphBody[];
  narrativeDraft: {
    jobId: string;
    section: string;
    replaceAll: boolean;
    status: string;
    failureReason: string | null;
  } | null;
}
