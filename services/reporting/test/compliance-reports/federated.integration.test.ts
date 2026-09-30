import { createHash, randomUUID } from 'node:crypto';

import { canonicalJson } from '@adili/api-kit';
import { type FormMV1, validateFormM } from '@adili/forms';
import { format, RPT } from '@adili/numbering';
import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { complianceReportWorkflowId } from '../../src/compliance-reports/contract.js';
import { openSnapshot } from '../../src/compliance-reports/snapshot.js';
import { complianceReports, idempotencyKeys, outbox, reportReceipts } from '../../src/db/schema.js';
import { contractErrors, okResponse } from '../support/contract.js';
import {
  asTsc,
  invalidFormM,
  TSC_SYSTEM,
  tscFormM,
  validFormM,
  withoutMeta,
} from '../support/federated.js';
import type { ReportBody } from '../support/form-m-facts.js';
import { type Caller, type ReportingApi, startReportingApi } from '../support/reporting-api.js';
import { historyPayloads } from '../support/workflow-history.js';

/**
 * S8 through the HTTP API and the workflow on Temporal: a federated Commission's system (a
 * client-credentials token with `reports:submit` for `tsc`) posts a `form-m.v1` document with an
 * `Idempotency-Key`; the document is validated against the schema and the business rules and
 * submitted along the hosted confirm's path with `source = federated`: `RPT` reference, frozen
 * document and hash, EACC receipt, event, then the Form M PDF, the receipt and the officers'
 * emails from the workflow.
 */
describe('Federated Form M submission (S8)', () => {
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
    api.directory.givenCommission('tsc');
    api.directory.givenCommission('psc');
    api.directory.givenStaff('tsc', 'supervisor', 'supervisor-tsc', 'supervisor@tsc.go.ke');
    api.directory.givenStaff('tsc', 'commission-admin', 'admin-tsc', 'admin@tsc.go.ke');
    api.clock.set(SUBMITTED_AT);
  });

  /** Ends the workflows a test left waiting. */
  const endWorkflows = () =>
    api.endWorkflows(['tsc', 'psc'].map((tenant) => complianceReportWorkflowId(tenant, 2027)));

  const SUBMITTED_AT = '2028-07-20T07:00:00.000Z';
  const PATH = '/v1/compliance-reports';
  const CONTRACT = okResponse(PATH, 'post', 201);

  const submit = (document: unknown, options: { caller?: Caller; key?: string | null } = {}) =>
    api.send(
      'POST',
      PATH,
      options.caller ?? TSC_SYSTEM,
      document,
      options.key === null ? {} : { 'idempotency-key': options.key ?? randomUUID() },
    );

  const reports = () => api.asPlatform((tx) => tx.select().from(complianceReports));
  /** The report of tsc for FY 2027 as the Commission reads it, decrypted. */
  async function storedDocument(): Promise<FormMV1> {
    const [row] = await reports();
    if (!row) throw new Error('no report');
    const document = await openSnapshot(api.cipher, 'tsc', row);
    if (!document) throw new Error('no document');
    return document;
  }

  it('S8: a reports:submit token for tsc posts a valid document: 201 with the receipt, RPT reference and source federated', async () => {
    const document = tscFormM();

    const response = await submit(document);

    expect(response.statusCode, response.body).toBe(201);
    expect(contractErrors(CONTRACT, response.json())).toEqual([]);
    const reference = format(RPT, { issuer: 'TSC', period: 2027, sequence: 1 });
    const body = response.json<ReportBody>();
    expect(body).toMatchObject({
      commission: { slug: 'tsc', issuerCode: 'TSC', name: 'Teachers Service Commission' },
      fy: 2027,
      status: 'submitted',
      source: 'federated',
      reference,
      submittedAt: SUBMITTED_AT,
      late: false,
      dueDate: '2028-07-31',
      reviewedBy: null,
      confirmedBy: { subject: TSC_SYSTEM.sub, name: TSC_SYSTEM.name },
      counts: {
        initial: { expected: 12, declared: 10, notDeclared: 2 },
        biennial: { expected: 100, declared: 95, notDeclared: 5, noCycleInPeriod: false },
        final: { expected: 4, declared: 3, notDeclared: 1 },
        clarifications: 6,
        accessRequests: { received: 7, granted: 4, declined: 3 },
      },
    });
    // The answer, kept for replays, carries no names: the document is read as filed.
    expect(body.document).toBeNull();

    // Frozen as filed, with the platform's reference and source, and its hash recorded.
    const stored = await storedDocument();
    expect(stored).toEqual({ ...document, meta: { reference, source: 'federated' } });
    expect(validateFormM(stored).ok).toBe(true);
    const [row] = await reports();
    expect(row).toMatchObject({ tenant: 'tsc', fy: 2027, source: 'federated', reference });
    expect(row?.canonicalSha256).toBe(
      createHash('sha256').update(canonicalJson(stored)).digest('hex'),
    );
    // The PDF and receipt ids follow from the workflow.
    expect(await api.asPlatform((tx) => tx.select().from(reportReceipts))).toEqual([
      expect.objectContaining({
        reportId: body.id,
        tenant: 'tsc',
        fy: 2027,
        reference,
        source: 'federated',
        submittedAt: new Date(SUBMITTED_AT),
        late: false,
        counts: body.counts,
      }),
    ]);
    expect(await api.events()).toContainEqual(
      expect.objectContaining({
        type: 'compliance-report.submitted.v1',
        tenant: 'tsc',
        subject: body.id,
        data: {
          reportId: body.id,
          fy: 2027,
          status: 'submitted',
          reference,
          late: false,
          source: 'federated',
        },
      }),
    );
  });

  it('S8: the workflow issues the Form M PDF and the receipt with source federated and tells both officers', async () => {
    const body = (await submit(tscFormM())).json<ReportBody>();
    const reference = body.reference as string;

    await vi.waitFor(
      async () => {
        const [row] = await reports();
        if (!row?.formMDocumentId || !row.receiptDocumentId) throw new Error('not issued yet');
      },
      { timeout: 45_000, interval: 250 },
    );

    const stored = await storedDocument();
    expect(api.documents.issued).toEqual([
      expect.objectContaining({
        type: 'form-m',
        disclosureLevel: 'restricted',
        issuerTenant: 'tsc',
        subjectRef: `compliance-report:${body.id}`,
        payload: stored,
        publicPayload: { reference, type: 'form-m', issuer: 'TSC', issuedAt: SUBMITTED_AT },
      }),
      expect.objectContaining({ type: 'compliance-report-receipt', issuerTenant: 'tsc' }),
    ]);
    const [row] = await reports();
    expect(api.documents.issued[1]?.payload).toEqual({
      reference,
      sha256: row?.canonicalSha256,
      submittedAt: SUBMITTED_AT,
      commissionName: 'Teachers Service Commission',
      issuerCode: 'TSC',
      financialYear: '2027/2028',
      dueDate: '2028-07-31',
      late: false,
      source: 'federated',
    });
    await expect
      .poll(() =>
        api.notifications.sent
          .filter((message) => message.template === 'form-m-receipt-email')
          .map((message) => message.to)
          .sort(),
      )
      .toEqual(['admin@tsc.go.ke', 'supervisor@tsc.go.ke']);
    const result: unknown = await api.temporal.workflow
      .getHandle(complianceReportWorkflowId('tsc', 2027))
      .result();
    expect(result).toEqual({ compiles: 0, reminders: 0 });

    // Names stay in the encrypted snapshot and the documents: not in history, events, receipts
    // or the answer kept for replays.
    const history = await historyPayloads(api.temporal, complianceReportWorkflowId('tsc', 2027));
    const published = JSON.stringify(await api.db.select().from(outbox));
    const receipts = JSON.stringify(await api.asPlatform((tx) => tx.select().from(reportReceipts)));
    const replays = JSON.stringify(await api.db.select().from(idempotencyKeys));
    for (const name of ['Peter Kamau Njoroge', 'PF-2027-000341', 'Dr. Mercy Wanjiku Kamau']) {
      for (const stored of [history, published, receipts, replays]) {
        expect(stored).not.toContain(name);
      }
    }
  });

  it('S8: a document naming another Commission than the token tenant is 403 tenant-mismatch', async () => {
    const psc = withoutMeta(validFormM('complete-fy-2027.json'));

    const response = await submit(psc);

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ status: 403, code: 'tenant-mismatch' });
    expect(await reports()).toEqual([]);
  });

  it('S8: a token without reports:submit (Commission staff, or another scope) is 403', async () => {
    const admin = await submit(tscFormM(), {
      caller: { sub: 'admin-tsc', tenant: 'tsc', roles: ['commission-admin'] },
    });
    const otherScope = await submit(tscFormM(), {
      caller: { ...TSC_SYSTEM, scopes: ['roster:write'] },
    });
    const noTenant = await submit(tscFormM(), { caller: { ...TSC_SYSTEM, tenant: null } });

    for (const response of [admin, otherScope, noTenant]) {
      expect(response.statusCode, response.body).toBe(403);
    }
    expect(await reports()).toEqual([]);
  });

  it('S8: an invalid document is 400 with the field paths', async () => {
    const fixture = invalidFormM('part-i-bad-email.json');

    const response = await submit(asTsc(fixture.document));
    const notAForm = await submit({ schemaVersion: 'form-m.v1' });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'invalid-document' });
    expect(response.json<{ errors: { path: string }[] }>().errors.map((e) => e.path)).toEqual(
      fixture.errors,
    );
    expect(notAForm.statusCode).toBe(400);
    expect(notAForm.json<{ errors: { path: string }[] }>().errors.map((e) => e.path)).toEqual(
      expect.arrayContaining(['partI', 'partII', 'partIII']),
    );
    expect(await reports()).toEqual([]);
  });

  it('S8: business rules (period, counts against lists, Part III) are 400 with the paths; nothing is submitted and no reference used', async () => {
    const period = tscFormM();
    period.partI.period.to = '2028-07-31';
    const counts = tscFormM();
    counts.partII.initial.nonFilers.pop();
    const partIII = tscFormM();
    partIII.partIII.confirmedBy = { name: null, designation: null, date: null };

    const responses = [await submit(period), await submit(counts), await submit(partIII)];

    expect(responses.map((response) => response.statusCode)).toEqual([400, 400, 400]);
    expect(
      responses
        .map((response) => response.json<{ code: string; errors: { path: string }[] }>())
        .map(({ code, errors }) => [code, errors.map((error) => error.path)]),
    ).toEqual([
      ['inconsistent-document', ['partI.period.to']],
      ['inconsistent-document', ['partII.initial.nonFilers']],
      ['inconsistent-document', ['partIII.confirmedBy.name', 'partIII.confirmedBy.date']],
    ]);
    expect(await reports()).toEqual([]);
    // The first accepted submission still gets the first reference.
    const accepted = await submit(tscFormM());
    expect(accepted.json()).toMatchObject({
      reference: format(RPT, { issuer: 'TSC', period: 2027, sequence: 1 }),
    });
  });

  it('S8: a second submission for the same financial year is 409 report-submitted', async () => {
    expect((await submit(tscFormM())).statusCode).toBe(201);

    const duplicate = await submit(tscFormM());

    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ code: 'report-submitted' });
    expect(
      (await api.events()).filter((event) => event.type === 'compliance-report.submitted.v1'),
    ).toHaveLength(1);
  });

  it('S8: a replay with the same Idempotency-Key answers the same receipt; the key with another document is 422', async () => {
    const key = randomUUID();

    const first = await submit(tscFormM(), { key });
    const replay = await submit(tscFormM(), { key });
    const changed = tscFormM();
    changed.partI.contactDetails = 'Director, Quality Assurance';
    const reused = await submit(changed, { key });

    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.json()).toEqual(first.json());
    expect(reused.statusCode).toBe(422);
    expect(await reports()).toHaveLength(1);
    expect(
      (await api.events()).filter((event) => event.type === 'compliance-report.submitted.v1'),
    ).toHaveLength(1);
  });

  it('S8: the Idempotency-Key is required', async () => {
    const response = await submit(tscFormM(), { key: null });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ type: 'idempotency-key-missing' });
    expect(await reports()).toEqual([]);
  });

  it('S8: a submission after 31 July is late', async () => {
    api.clock.set('2028-08-05T07:00:00.000Z');

    const response = await submit(tscFormM());

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ late: true, submittedAt: '2028-08-05T07:00:00.000Z' });
  });

  it('S8: a draft the platform compiled for the year is superseded by the federated document', async () => {
    const draftId = uuidv7();
    await api.asPlatform((tx) =>
      tx
        .insert(complianceReports)
        .values({ id: draftId, tenant: 'tsc', fy: 2027, status: 'draft' }),
    );

    const response = await submit(tscFormM());

    expect(response.statusCode, response.body).toBe(201);
    expect(response.json()).toMatchObject({ id: draftId, source: 'federated' });
    const [row] = await api.asPlatform((tx) =>
      tx.select().from(complianceReports).where(eq(complianceReports.id, draftId)),
    );
    expect(row).toMatchObject({ status: 'submitted', source: 'federated' });
  });
});
