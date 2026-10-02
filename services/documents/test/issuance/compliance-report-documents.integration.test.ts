import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { GetObjectCommand } from '@aws-sdk/client-s3';
import { withTenant } from '@adili/data-access';
import { documentIssuedDataSchema } from '@adili/events/contracts/schemas';
import type { FormMV1 } from '@adili/forms';
import { CMP, DCB, format, NCR, RFL, RPT } from '@adili/numbering/references';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { issuedDocuments, outbox, verificationRecords } from '../../src/db/schema.js';
import { IssuanceService } from '../../src/issuance/issuance.service.js';
import type { DocumentDownload, IssuedDocument } from '../../src/issuance/representation.js';
import { EACC_ISSUER } from '../../src/issuance/templates/page.js';
import type { ReferralPackagePayload } from '../../src/issuance/templates/referral-package.v1.js';
import { contractErrors, okResponse } from '../support/contract.js';
import {
  type Caller,
  type DocumentsApi,
  requireEnv,
  startDocumentsApi,
} from '../support/documents-api.js';
import { footerQrCodes, pageTexts } from '../support/pdf.js';

/**
 * Spec 09 (S6, S11, S12), the documents side: the reporting service issues a submitted report's
 * Restricted Form M and EACC's signed acknowledgement of receipt, and EACC's approved national
 * consolidated report, with the payload in the request exactly as its activities build it;
 * documents renders them through compose Gotenberg, signs them with OpenBao and stores them in
 * SeaweedFS. EACC's analysts and supervisors download the Confidential referral packages
 * Commissions send them, and no other document.
 */

/** The reporting service's account (client credentials). */
const REPORTING: Caller = {
  sub: 'service-account-reporting',
  azp: 'reporting',
  scope: 'documents:internal',
};
const REVIEW: Caller = {
  sub: 'service-account-review',
  azp: 'review',
  scope: 'documents:internal',
};
const VERIFY_ORIGIN = 'http://localhost:3030';

/** FY 2027/2028: reporting numbers it with the year's end (ADR-011 §2). */
const RPT_REFERENCE = format(RPT, { issuer: 'PSC', period: 2028, sequence: 1 });
const NCR_REFERENCE = format(NCR, { issuer: 'EACC', period: 2028, sequence: 1 });
const SHA256 = '3f'.repeat(32);

const fixture = createRequire(import.meta.url).resolve(
  '@adili/schemas/forms/fixtures/form-m.v1/valid/complete-fy-2027.json',
);

/** The complete FY 2027/2028 report as submitted: reporting's `meta` with the RPT reference. */
function submittedFormM(overrides: (document: FormMV1) => void = () => undefined): FormMV1 {
  const document = JSON.parse(readFileSync(fixture, 'utf8')) as FormMV1;
  document.meta = { ...document.meta, reference: RPT_REFERENCE, source: 'hosted' };
  overrides(document);
  return document;
}

interface Problem {
  type: string;
  status: number;
  errors?: { path: string; message: string }[];
}

let api: DocumentsApi;

beforeAll(async () => {
  api = await startDocumentsApi();
});

afterAll(async () => {
  await api.close();
});

/** The request reporting's `issueSubmissionDocuments` sends (ReportActivities), for the PSC. */
function reportRequest(
  reportId: string,
  type: 'form-m' | 'compliance-report-receipt',
  payload: unknown,
) {
  return {
    templateVersion: 1,
    subjectRef: `compliance-report:${reportId}`,
    subjectPersonId: null,
    type,
    payload,
  };
}

function receiptPayload(overrides: Record<string, unknown> = {}) {
  return {
    reference: RPT_REFERENCE,
    sha256: SHA256,
    submittedAt: '2028-07-15T08:30:14.000Z',
    commissionName: 'Public Service Commission',
    issuerCode: 'PSC',
    financialYear: '2027/2028',
    dueDate: '2028-07-31',
    late: false,
    source: 'hosted',
    ...overrides,
  };
}

/** A per-Commission row of reporting's `NationalAggregates`. */
function commissionRow(
  name: string,
  status: string,
  sections: [number, number, number, number, number, number] | null,
) {
  const section = (expected: number, declared: number) => ({
    expected,
    declared,
    notDeclared: expected - declared,
    rate: expected > 0 ? Math.round((declared / expected) * 10_000) / 10_000 : null,
  });
  return {
    name,
    status,
    reportId: sections ? randomUUID() : null,
    reference: sections
      ? format(RPT, { issuer: name.slice(0, 3).toUpperCase(), period: 2028, sequence: 1 })
      : null,
    submittedAt: sections ? '2028-07-20T09:00:00.000Z' : null,
    initial: sections ? section(sections[0], sections[1]) : null,
    biennial: sections ? { ...section(sections[2], sections[3]), noCycleInPeriod: false } : null,
    final: sections ? section(sections[4], sections[5]) : null,
    clarifications: sections ? 6 : null,
    accessRequests: sections ? { received: 7, granted: 4, declined: 3 } : null,
  };
}

/** What reporting's `issueNationalReportDocument` sends (NationalReportActivities). */
function ncrRequest(nationalReportId: string, overrides: Record<string, unknown> = {}) {
  return {
    type: 'ncr',
    templateVersion: 1,
    subjectRef: `national-report:${nationalReportId}`,
    subjectPersonId: null,
    payload: {
      reference: NCR_REFERENCE,
      financialYear: '2027/2028',
      builtAt: '2028-09-24T07:00:00.000Z',
      reportsIncluded: 2,
      aggregates: {
        fy: 2027,
        reporting: {
          commissions: 3,
          reported: 2,
          onTime: 1,
          late: 1,
          notReported: 1,
          rate: 0.6667,
        },
        national: {
          initial: { expected: 9424, declared: 8970, notDeclared: 454, rate: 0.9518 },
          biennial: { expected: 331970, declared: 318497, notDeclared: 13473, rate: 0.9594 },
          final: { expected: 7909, declared: 6814, notDeclared: 1095, rate: 0.8615 },
          all: { expected: 349303, declared: 334281, notDeclared: 15022, rate: 0.957 },
          clarifications: 12,
          accessRequests: { received: 14, granted: 8, declined: 6 },
        },
        byCommission: {
          jsc: commissionRow('Judicial Service Commission', 'not-reported', null),
          psc: commissionRow(
            'Public Service Commission',
            'submitted-on-time',
            [12, 10, 100, 95, 4, 3],
          ),
          tsc: commissionRow(
            'Teachers Service Commission',
            'submitted-late',
            [9412, 8960, 331870, 318402, 7905, 6811],
          ),
        },
      },
      narrative: {
        overview:
          'This report consolidates the compliance reports received for the financial year.\n\nFigures are taken from the reports as filed.',
        findings: 'Two of three Commissions reported. Final declarations had the lowest rate.',
        recommendations: 'Commissions that have not reported should file Form M within 30 days.',
      },
      author: 'Brian Otieno',
      approver: 'Mercy Wambui',
      approvedAt: '2028-09-25T13:40:00.000Z',
      ...overrides,
    },
  };
}

/**
 * As reporting's client sends it: the issuer in X-Acting-Tenant (EACC for the national report,
 * the PSC for its own report) and an Idempotency-Key.
 */
/** A request body: its type decides the acting tenant. */
type ReportBody = { type: string } & Record<string, unknown>;

const issue = (body: ReportBody) =>
  api.post('/internal/v1/documents/issue', body, REPORTING, {
    idempotencyKey: randomUUID(),
    headers: { 'x-acting-tenant': body.type === 'ncr' ? 'eacc' : 'psc' },
  });

async function issued(body: {
  type: string;
}): Promise<{ document: IssuedDocument; texts: string[] }> {
  const response = await issue(body);
  expect(response.statusCode, response.body).toBe(201);
  const document = response.json<IssuedDocument>();
  return { document, texts: await pageTexts(await storedPdf(document.id)) };
}

async function storedPdf(documentId: string): Promise<Uint8Array> {
  const object = await api.s3.send(
    new GetObjectCommand({
      Bucket: requireEnv('S3_BUCKET_ISSUED'),
      Key: `issued/${documentId}.pdf`,
    }),
  );
  if (!object.Body) throw new Error(`no PDF for ${documentId}`);
  return object.Body.transformToByteArray();
}

async function registered(subjectRef: string) {
  return withTenant(api.db, { tenant: 'platform', subject: 'test' }, (tx) =>
    tx
      .select({ document: issuedDocuments, record: verificationRecords })
      .from(issuedDocuments)
      .innerJoin(verificationRecords, eq(verificationRecords.documentId, issuedDocuments.id))
      .where(eq(issuedDocuments.subjectRef, subjectRef)),
  );
}

async function eventsAbout(documentId: string) {
  const rows = await withTenant(api.db, { tenant: 'platform', subject: 'test' }, (tx) =>
    tx.select().from(outbox).orderBy(asc(outbox.id)),
  );
  return rows.filter((row) => row.envelope.subject === documentId).map((row) => row.envelope);
}

/** Each page carries the code, the issuer, the reference and RESTRICTED, and the QR code. */
async function expectFooters(
  document: IssuedDocument,
  texts: string[],
  issuer: string,
  reference: string,
) {
  expect(texts.length).toBeGreaterThan(0);
  texts.forEach((text, index) => {
    expect(text).toContain(document.verificationId);
    expect(text).toContain(`Issued by ${issuer} through Adili Online`);
    expect(text).toContain(`Ref ${reference}`);
    // The mark is letter-spaced, so the PDF's text spaces its letters.
    expect(text).toContain('R E S T R I C T E D');
    expect(text).toContain(`Page ${index + 1} of ${texts.length}`);
  });
  const codes = await footerQrCodes(await storedPdf(document.id));
  expect(codes).toEqual(texts.map(() => `${VERIFY_ORIGIN}/v/${document.verificationId}`));
}

/** The record's and the event's public payload: reference, type, issuer and date only. */
async function expectRestrictedPublication(
  document: IssuedDocument,
  expected: { type: string; issuerName: string; issuerCode: string; reference: string },
  secrets: string[],
) {
  const publicPayload = {
    ...expected,
    issuedAt: document.issuedAt,
    version: null,
  };
  const [row] = await registered(document.subjectRef);
  expect(row?.record.publicPayload).toEqual(publicPayload);
  const [event] = await eventsAbout(document.id);
  expect(event?.type).toBe('document.issued.v1');
  expect(documentIssuedDataSchema.safeParse(event?.data).error).toBeUndefined();
  expect(event?.data).toMatchObject({ disclosureLevel: 'restricted', publicPayload });
  const serialised = JSON.stringify(event);
  for (const secret of secrets) expect(serialised).not.toContain(secret);
}

describe('S6 the Form M of a submitted report', () => {
  const reportId = randomUUID();
  let document: IssuedDocument;
  let all: string;
  let texts: string[];

  beforeAll(async () => {
    ({ document, texts } = await issued(reportRequest(reportId, 'form-m', submittedFormM())));
    all = texts.join(' ');
  });

  it('answers 201 with a Restricted, valid Form M under the report, owned by no person', async () => {
    expect(document).toMatchObject({
      type: 'form-m',
      templateVersion: 1,
      disclosureLevel: 'restricted',
      issuerTenant: 'psc',
      subjectRef: `compliance-report:${reportId}`,
      status: 'valid',
    });
    const [row] = await registered(document.subjectRef);
    expect(row?.document).toMatchObject({ reference: RPT_REFERENCE, subjectPersonId: null });
  });

  it('prints the heading and Part I, the description of the Commission', () => {
    expect(texts[0]).toContain('FORM M');
    expect(texts[0]).toContain('(r. 25(2)(a))');
    expect(texts[0]).toContain('COMPLIANCE REPORT BY A RESPONSIBLE COMMISSION');
    expect(texts[0]).toContain(`Ref ${RPT_REFERENCE}`);
    expect(texts[0]).toContain('Financial year 2027/2028');
    expect(texts[0]).toContain('Due 31 Jul 2028');
    expect(all).toContain('PART I: DESCRIPTION OF THE RESPONSIBLE COMMISSION');
    expect(all).toContain('Public Service Commission');
    expect(all).toContain('Director, Compliance and Quality Assurance, +254 20 2223901');
    expect(all).toContain('Commission House, Harambee Avenue, Nairobi');
    expect(all).toContain('compliance@publicservice.go.ke');
    expect(all).toContain('1 Jul 2027 to 30 Jun 2028');
  });

  it('prints sections 1 to 3: the counts and each non-filer with the action taken and whether they complied', () => {
    expect(all).toContain('PART II: DECLARATION OF INCOME, ASSETS AND LIABILITIES');
    for (const heading of [
      '1. Submission of initial declaration',
      '2. Submission of biennial declaration',
      '3. Submission of final declaration',
    ]) {
      expect(all).toContain(heading);
    }
    expect(all).toMatch(/newly appointed officers\) 12 /);
    expect(all).toMatch(/made an initial declaration 10 /);
    expect(all).toMatch(/did not make a biennial declaration 5 /);
    expect(all).toMatch(/did not make a final declaration 1 /);
    expect(all).toContain(
      'Peter Kamau Njoroge Assistant Director, Human Resource PF-2027-000341 1 Sep 2027 Notice to comply · Complied: Pending Notice issued 12 October 2027',
    );
    expect(all).toContain('Warning · Complied: Yes Filed on 28 February 2028 after a warning');
    expect(all).toContain('Esther Nyambura Mwangi');
    expect(all).toContain('31 Mar 2028 No action taken · Complied: No Retired');
  });

  it('prints section 4: the clarifications in general terms with their status', () => {
    expect(all).toContain('4. Clarifications sought from public officers');
    expect(all).toContain(
      'Source of funds for a vehicle acquired during the period CLR-PSC-2027-0000004-3 Resolved',
    );
    expect(all).toContain('Shareholding in a supplier company CLR-PSC-2028-0000005-1 Overdue');
    expect(all).toContain('Withdrawn');
  });

  it('prints section 5: access requests with the reasons for declining', () => {
    expect(all).toMatch(/access to information received 7 /);
    expect(all).toMatch(/access to information granted 4 /);
    expect(all).toMatch(/access to information declined 3 /);
    expect(all).toContain('May prejudice an ongoing proceeding or investigation (r. 24(b)): 2');
    expect(all).toContain('Frivolous, vexatious or scandalous (r. 24(c)): 1');
    expect(all).not.toContain('not yet captured');
  });

  it('prints Part B, the complaints register and complaints, and Part III, the authentication', () => {
    expect(all).toContain('B. COMPLAINTS AND INVESTIGATIONS');
    expect(all).toContain('Yes ✓ No');
    expect(all).toContain('Alleged conflict of interest in a tender evaluation');
    expect(all).toContain('Referred to EACC on 14 March 2028');
    expect(all).toContain('PART III: AUTHENTICATION OF INFORMATION');
    expect(all).toContain('Compiled by: Rose Adhiambo Were');
    expect(all).toContain('Designation: Deputy Director, Compliance');
    expect(all).toContain('Date: 8 Jul 2028');
    expect(all).toContain('Confirmed by: Dr. Mercy Wanjiku Kamau');
    expect(all).toContain('Date: 15 Jul 2028');
    expect(all).toContain('Submission record (added by Adili Online');
    expect(all).toContain('Filed through Adili Online');
  });

  it('prints the verification code, issuer, RPT reference and RESTRICTED on every page, with the QR code', async () => {
    await expectFooters(document, texts, 'Public Service Commission', RPT_REFERENCE);
  });

  it('publishes reference, type, issuer and date only, on the record and the event', async () => {
    await expectRestrictedPublication(
      document,
      {
        type: 'form-m',
        issuerName: 'Public Service Commission',
        issuerCode: 'PSC',
        reference: RPT_REFERENCE,
      },
      ['Njoroge', 'PF-2027-000341', 'compliance@publicservice.go.ke'],
    );
  });

  it('returns the Form M issued for the report already, with 200', async () => {
    const again = await issue(reportRequest(reportId, 'form-m', submittedFormM()));
    expect(again.statusCode).toBe(200);
    expect(again.json<IssuedDocument>().id).toBe(document.id);
  });
});

describe('S6 Form M variants: an even year, a federated report, unrecorded access requests', () => {
  it('marks section 2 when no biennial declaration fell due, says access data is not captured, and leaves Part B open', async () => {
    const { texts } = await issued(
      reportRequest(
        randomUUID(),
        'form-m',
        submittedFormM((document) => {
          document.partII.biennial = {
            expected: 0,
            declared: 0,
            notDeclared: 0,
            nonFilers: [],
            noCycleInPeriod: true,
          };
          document.partII.accessRequests = {
            received: 0,
            granted: 0,
            declined: 0,
            declineReasons: [],
            dataUnavailable: true,
          };
          document.partII.complaints = { registerMaintained: null, items: [] };
          document.meta = { ...document.meta, reference: RPT_REFERENCE, source: 'federated' };
        }),
      ),
    );
    const all = texts.join(' ');
    expect(all).toContain('No biennial declaration fell due in this financial year');
    expect(all).toContain('Note: Access request data is not yet captured on Adili.');
    expect(all).toMatch(/requests for access to information: None/);
    expect(all).toContain(
      "Submitted from the Commission's own system through the Adili Online API",
    );
    // Part B left unanswered reads so, rather than as no complaints.
    expect(all).toMatch(/provisions of the Act\? Not completed/);
  });
});

describe('S6 Form M refusals', () => {
  it.each([
    [
      'a report without its RPT reference',
      submittedFormM((document) => {
        document.meta = { compiledAt: '2028-07-01T06:00:00+03:00', source: 'hosted' };
      }),
      'payload.meta.reference',
    ],
    [
      "another Commission's RPT reference",
      submittedFormM((document) => {
        document.meta = {
          reference: format(RPT, { issuer: 'TSC', period: 2028, sequence: 1 }),
          source: 'hosted',
        };
      }),
      'payload.meta.reference',
    ],
    [
      'a document that is not form-m.v1',
      submittedFormM((document) => {
        (document.partII.initial as { expected: unknown }).expected = 'twelve';
      }),
      'payload.partII.initial.expected',
    ],
  ])('refuses %s with 400 and registers nothing', async (_name, payload, path) => {
    const reportId = randomUUID();
    const response = await issue(reportRequest(reportId, 'form-m', payload));
    expect(response.statusCode, response.body).toBe(400);
    expect(response.json<Problem>().errors).toEqual([expect.objectContaining({ path })]);
    expect(await registered(`compliance-report:${reportId}`)).toEqual([]);
  });
});

describe('S6 S11 a report belongs to no person', () => {
  it.each([
    ['form-m', () => reportRequest(randomUUID(), 'form-m', submittedFormM())],
    [
      'compliance-report-receipt',
      () => reportRequest(randomUUID(), 'compliance-report-receipt', receiptPayload()),
    ],
    ['ncr', () => ncrRequest(randomUUID())],
  ])('refuses a %s with a person to download it with 400', async (_type, request) => {
    const body = { ...request(), subjectPersonId: randomUUID() };
    const response = await issue(body);
    expect(response.statusCode, response.body).toBe(400);
    expect(response.json<Problem>().errors).toEqual([
      expect.objectContaining({ path: 'subjectPersonId' }),
    ]);
    expect(await registered(body.subjectRef)).toEqual([]);
  });
});

describe('S6 the acknowledgement of receipt', () => {
  const reportId = randomUUID();
  let document: IssuedDocument;
  let texts: string[];

  beforeAll(async () => {
    ({ document, texts } = await issued(
      reportRequest(reportId, 'compliance-report-receipt', receiptPayload()),
    ));
  });

  it('answers 201 with a Restricted, valid receipt under the report', async () => {
    expect(document).toMatchObject({
      type: 'compliance-report-receipt',
      disclosureLevel: 'restricted',
      issuerTenant: 'psc',
      subjectRef: `compliance-report:${reportId}`,
      status: 'valid',
    });
    const [row] = await registered(document.subjectRef);
    expect(row?.document).toMatchObject({ reference: RPT_REFERENCE, subjectPersonId: null });
  });

  it("prints EACC's acknowledgement with the reference, the hash and the time of receipt", () => {
    const all = texts.join(' ');
    expect(all).toContain('Ethics and Anti-Corruption Commission');
    expect(all).toContain('Acknowledgement of receipt');
    expect(all).toContain('Compliance report (Form M) under regulation 25(2)');
    expect(all).toContain('The Accounting Officer Public Service Commission');
    expect(all).toContain('Responsible Commission Public Service Commission (PSC)');
    expect(all).toContain('Form M, financial year 2027/2028 (1 Jul 2027 to 30 Jun 2028)');
    expect(all).toContain(`Reference ${RPT_REFERENCE}`);
    expect(all).toContain('Received 15 Jul 2028, 11:30 EAT');
    expect(all).toContain('Deadline 31 Jul 2028');
    expect(all).toContain('Filing On time');
    expect(all).toContain('Submitted Through Adili Online');
    // The hash in two halves, so it fits its cell.
    expect(all).toContain(SHA256.slice(0, 32));
    expect(all).toContain(SHA256.slice(32));
    expect(all).toContain('SHA-256 of the form-m.v1 document as received');
    expect(all).toContain('It does not confirm that the report is complete or correct.');
  });

  it('prints the code, EACC, the RPT reference and RESTRICTED on every page, with the QR code', async () => {
    await expectFooters(document, texts, 'Ethics and Anti-Corruption Commission', RPT_REFERENCE);
  });

  it('publishes reference, type, issuer and date only', async () => {
    await expectRestrictedPublication(
      document,
      {
        type: 'compliance-report-receipt',
        issuerName: 'Ethics and Anti-Corruption Commission',
        issuerCode: 'EACC',
        reference: RPT_REFERENCE,
      },
      [SHA256],
    );
  });

  it('says how late a late report was received, and from where a federated one came', async () => {
    const { texts: late } = await issued(
      reportRequest(
        randomUUID(),
        'compliance-report-receipt',
        receiptPayload({
          submittedAt: '2028-08-05T07:00:00.000Z',
          late: true,
          source: 'federated',
        }),
      ),
    );
    const all = late.join(' ');
    expect(all).toContain('LATE Received 5 days after the deadline');
    expect(all).toContain("From the Commission's own system through the Adili Online API");
  });

  it.each([
    ['a hash that is not a SHA-256', { sha256: 'abc' }, 'payload.sha256'],
    [
      "another Commission's RPT reference",
      { reference: format(RPT, { issuer: 'TSC', period: 2028, sequence: 1 }) },
      'payload.reference',
    ],
    [
      'a submission time without a zone',
      { submittedAt: '2028-07-15 08:30' },
      'payload.submittedAt',
    ],
    ['a malformed financial year', { financialYear: '2027/2029' }, 'payload.financialYear'],
  ])('refuses %s with 400', async (_name, overrides, path) => {
    const response = await issue(
      reportRequest(randomUUID(), 'compliance-report-receipt', receiptPayload(overrides)),
    );
    expect(response.statusCode, response.body).toBe(400);
    expect(response.json<Problem>().errors).toEqual([expect.objectContaining({ path })]);
  });
});

describe('S11 the national consolidated report', () => {
  const nationalReportId = randomUUID();
  let document: IssuedDocument;
  let texts: string[];
  let all: string;

  beforeAll(async () => {
    ({ document, texts } = await issued(ncrRequest(nationalReportId)));
    all = texts.join(' ');
  });

  it("answers 201 with a Restricted, valid report issued by EACC's tenant", async () => {
    expect(document).toMatchObject({
      type: 'ncr',
      disclosureLevel: 'restricted',
      issuerTenant: 'eacc',
      subjectRef: `national-report:${nationalReportId}`,
      status: 'valid',
    });
    const [row] = await registered(document.subjectRef);
    expect(row?.document).toMatchObject({ reference: NCR_REFERENCE, subjectPersonId: null });
  });

  it('prints the cover: the year, the headline numbers, who prepared and who approved it', () => {
    const cover = texts[0] ?? '';
    // The eyebrow is letter-spaced, so the PDF's text spaces its letters.
    expect(cover.replace(/\s+/g, '')).toContain('FINANCIALYEAR2027/2028');
    expect(cover).toContain('National Consolidated Report');
    expect(cover).toContain('Commissions reporting 2 of 3 1 on time · 1 late · 1 not reported');
    expect(cover).toContain('Declared rate, all sections 95.7% 334,281 of 349,303 officers');
    expect(cover).toContain('Did not declare 15,022');
    expect(cover).toContain('Brian Otieno, EACC analyst');
    expect(cover).toContain('Built 24 Sep 2028 from 2 submitted reports');
    expect(cover).toContain('Mercy Wambui, EACC supervisor');
    expect(cover).toContain('On 25 Sep 2028');
  });

  it('prints the narrative sections as the analyst wrote them', () => {
    expect(all).toContain('1. Overview');
    expect(all).toContain('This report consolidates the compliance reports received');
    expect(all).toContain('Figures are taken from the reports as filed.');
    expect(all).toContain('3. Findings Two of three Commissions reported.');
    expect(all).toContain('4. Recommendations Commissions that have not reported should file');
  });

  it('prints the aggregates: national totals per section, the other sections and the reporting status', () => {
    expect(all).toContain('1. Initial declarations 9,424 8,970 454 95.2%');
    expect(all).toContain('2. Biennial declarations 331,970 318,497 13,473 95.9%');
    expect(all).toContain('3. Final declarations 7,909 6,814 1,095 86.2%');
    expect(all).toContain('All sections 349,303 334,281 15,022 95.7%');
    expect(all).toContain('4. Clarifications sought 12');
    expect(all).toContain('5. Requests for access to information received 14');
    expect(all).toContain('Reported by 31 Jul 2028 1 33.3%');
    expect(all).toContain('Not reported when this report was built 1 33.3%');
  });

  it('prints the annex: each Commission with its status, declared rates, clarifications and access requests', () => {
    const annex = all.slice(all.indexOf('Annex. Results by Commission'));
    expect(annex).toContain('CLARIFICATIONS ACCESS REQUESTS');
    expect(annex).toContain('Judicial Service Commission JSC Not reported - - - - - -');
    expect(annex).toContain('Public Service Commission PSC');
    expect(annex).toContain(
      'On time 20 Jul 2028 83.3% 10 / 12 95.0% 95 / 100 75.0% 3 / 4 6 7 4 granted · 3 declined',
    );
    expect(annex).toContain('Teachers Service Commission TSC');
    expect(annex).toContain('Late');
  });

  it.each([
    ['the aggregates', (aggregates: Record<string, unknown>) => ({ ...aggregates, extra: 1 })],
    [
      "a Commission's row",
      (aggregates: Record<string, unknown>) => {
        const byCommission = aggregates.byCommission as Record<string, object>;
        return {
          ...aggregates,
          byCommission: { ...byCommission, psc: { ...byCommission.psc, complaints: 2 } },
        };
      },
    ],
  ])('refuses a field it does not print in %s with 400', async (_name, drift) => {
    const request = ncrRequest(randomUUID());
    const response = await issue({
      ...request,
      payload: { ...request.payload, aggregates: drift(request.payload.aggregates) },
    });
    expect(response.statusCode, response.body).toBe(400);
    expect(response.json<Problem>().errors).toEqual([
      expect.objectContaining({ path: expect.stringMatching(/^payload\.aggregates/) as string }),
    ]);
  });

  it('prints the code, EACC, the NCR reference and RESTRICTED on every page, with the QR code', async () => {
    await expectFooters(document, texts, 'Ethics and Anti-Corruption Commission', NCR_REFERENCE);
  });

  it('publishes reference, type, issuer and date only', async () => {
    await expectRestrictedPublication(
      document,
      {
        type: 'ncr',
        issuerName: 'Ethics and Anti-Corruption Commission',
        issuerCode: 'EACC',
        reference: NCR_REFERENCE,
      },
      ['Brian Otieno', 'Two of three'],
    );
  });

  it('says a section the analyst left empty has no text', async () => {
    const { texts: empty } = await issued(
      ncrRequest(randomUUID(), {
        narrative: { overview: '', findings: 'Findings.', recommendations: '  ' },
      }),
    );
    expect(empty.join(' ')).toContain('1. Overview No text for this section.');
  });

  it('takes findings as long as reporting accepts (40,000 characters), and no longer', async () => {
    const findings = 'Final declarations had the lowest rate. '.repeat(1000);
    expect(findings).toHaveLength(40_000);
    const narrative = { overview: '', findings, recommendations: '' };
    const { texts: long } = await issued(ncrRequest(randomUUID(), { narrative }));
    expect(long.join(' ')).toContain('3. Findings Final declarations had the lowest rate.');

    const tooLong = await issue(
      ncrRequest(randomUUID(), { narrative: { ...narrative, findings: `${findings}.` } }),
    );
    expect(tooLong.statusCode, tooLong.body).toBe(400);
    expect(tooLong.json<Problem>().errors).toEqual([
      expect.objectContaining({ path: 'payload.narrative.findings' }),
    ]);
  });

  it.each([
    [
      "a Commission's reference instead of EACC's",
      { reference: format(NCR, { issuer: 'PSC', period: 2028, sequence: 1 }) },
      'payload.reference',
    ],
    ['an RPT reference', { reference: RPT_REFERENCE }, 'payload.reference'],
    ['no approver', { approver: '' }, 'payload.approver'],
  ])('refuses %s with 400', async (_name, overrides, path) => {
    const response = await issue(ncrRequest(randomUUID(), overrides));
    expect(response.statusCode, response.body).toBe(400);
    expect(response.json<Problem>().errors).toEqual([expect.objectContaining({ path })]);
  });
});

describe('S12 EACC downloads the referral packages Commissions send, and nothing else', () => {
  const EACC_ANALYST: Caller = { sub: 'eacc-analyst-1', tenant: 'eacc', roles: ['eacc-analyst'] };
  const EACC_SUPERVISOR: Caller = {
    sub: 'eacc-supervisor-1',
    tenant: 'eacc',
    roles: ['eacc-supervisor'],
  };
  let referralPackage: IssuedDocument;
  let formM: IssuedDocument;
  let ncr: IssuedDocument;

  const download = (id: string, caller: Caller) => api.get(`/v1/documents/${id}/download`, caller);

  /**
   * A referral package a Commission issues, as the review service asks it, about a declarant of
   * its own; EACC refers its own officers too (ADR-006: EACC is their Commission).
   */
  async function issuedPackage(
    tenant = 'psc',
    declarantPersonId: string = randomUUID(),
  ): Promise<IssuedDocument> {
    const referralId = randomUUID();
    api.review.given('referral', tenant, referralId, { ...packagePayload(), declarantPersonId });
    const response = await api.post(
      '/internal/v1/documents/issue',
      {
        type: 'referral-package',
        templateVersion: 1,
        subjectRef: `referral:${referralId}`,
        subjectPersonId: null,
        payload: { referralId },
      },
      REVIEW,
      { idempotencyKey: null, headers: { 'x-acting-tenant': tenant } },
    );
    expect(response.statusCode, response.body).toBe(201);
    return response.json<IssuedDocument>();
  }

  beforeAll(async () => {
    referralPackage = await issuedPackage();
    ({ document: formM } = await issued(reportRequest(randomUUID(), 'form-m', submittedFormM())));
    ({ document: ncr } = await issued(ncrRequest(randomUUID())));
  });

  it.each([
    ['an EACC analyst', EACC_ANALYST],
    ['an EACC supervisor', EACC_SUPERVISOR],
  ])(
    "hands %s a link to a Commission's package, audited as a download under the Commission",
    async (_name, caller) => {
      const response = await download(referralPackage.id, caller);
      expect(response.statusCode, response.body).toBe(200);
      const body = response.json<DocumentDownload>();
      expect(
        contractErrors(okResponse('/v1/documents/{documentId}/download', 'get'), body),
      ).toEqual([]);
      expect(body.sha256).toBe(referralPackage.sha256);

      const downloads = (await eventsAbout(referralPackage.id)).filter(
        (event) =>
          event.type === 'document.downloaded.v1' &&
          (event.data as { downloadedBy?: string }).downloadedBy === caller.sub,
      );
      expect(downloads).toHaveLength(1);
      expect(downloads[0]).toMatchObject({
        tenant: 'psc',
        data: { documentType: 'referral-package', issuerTenant: 'psc' },
      });

      const metadata = await api.get(`/v1/documents/${referralPackage.id}`, caller);
      expect(metadata.statusCode).toBe(200);
      expect(metadata.json<IssuedDocument>().id).toBe(referralPackage.id);
    },
  );

  it('answers 404 to anyone else: Commission staff, other EACC roles, an EACC role of a Commission', async () => {
    const others: Caller[] = [
      { sub: 'supervisor-1', tenant: 'psc', roles: ['supervisor'] },
      { sub: 'reviewer-1', tenant: 'psc', roles: ['reviewer'] },
      { sub: 'auditor-1', tenant: 'eacc', roles: ['auditor'] },
      { sub: 'admin-1', tenant: 'platform', roles: ['platform-admin'] },
      // An EACC role holds only with a token of EACC's tenant.
      { sub: 'eacc-analyst-2', tenant: 'psc', roles: ['eacc-analyst'] },
    ];
    for (const caller of others) {
      expect((await download(referralPackage.id, caller)).statusCode, caller.sub).toBe(404);
      expect((await api.get(`/v1/documents/${referralPackage.id}`, caller)).statusCode).toBe(404);
    }
  });

  it('still hands an EACC officer the documents about them as a declarant (ADR-006: EACC is their Commission)', async () => {
    const personId = randomUUID();
    const determinationId = randomUUID();
    api.review.given('determination', 'eacc', determinationId, {
      declarantName: 'Brian Otieno',
      commission: { name: EACC_ISSUER.name, issuerCode: EACC_ISSUER.code },
      declarationReference: format(DCB, { issuer: 'EACC', period: 2027, sequence: 7 }),
      determinationReference: format(CMP, { issuer: 'EACC', period: 2027, sequence: 1 }),
      outcome: 'compliant',
      outcomeLabel: 'Compliant',
      reasons: 'All items reconcile.',
      decidedAt: new Date().toISOString(),
      portalUrl: 'http://localhost:3010/decisions/0192f0c4-8a51-7cc2-9d1e-3b3f2a7e4c10',
      declarantPersonId: personId,
    });
    const issuedLetter = await api.post(
      '/internal/v1/documents/issue',
      {
        type: 'decision-letter',
        templateVersion: 1,
        subjectRef: `determination:${determinationId}`,
        subjectPersonId: personId,
        payload: { determinationId },
      },
      REVIEW,
      { idempotencyKey: null, headers: { 'x-acting-tenant': 'eacc' } },
    );
    expect(issuedLetter.statusCode, issuedLetter.body).toBe(201);
    const letter = issuedLetter.json<IssuedDocument>();

    const analyst: Caller = { ...EACC_ANALYST, personId };
    expect((await download(letter.id, analyst)).statusCode).toBe(200);
    expect((await download(letter.id, EACC_SUPERVISOR)).statusCode).toBe(404);
  });

  it('never hands an EACC officer the package referring them, whichever EACC role they hold', async () => {
    const personId = randomUUID();
    const own = await issuedPackage('eacc', personId);
    for (const caller of [EACC_ANALYST, EACC_SUPERVISOR]) {
      const referred: Caller = { ...caller, personId };
      expect((await download(own.id, referred)).statusCode, caller.sub).toBe(404);
      expect((await api.get(`/v1/documents/${own.id}`, referred)).statusCode).toBe(404);
      // Any other EACC analyst or supervisor downloads it.
      const colleague: Caller = { ...caller, personId: randomUUID() };
      expect((await download(own.id, colleague)).statusCode, caller.sub).toBe(200);
    }
    expect((await download(own.id, EACC_ANALYST)).statusCode).toBe(200);
  });

  it("answers 404 to a service acting for EACC on a Commission's package: no metadata, download, supersede or announcement", async () => {
    const asEacc = { idempotencyKey: null, headers: { 'x-acting-tenant': 'eacc' } };
    const get = (path: string) => api.get(path, REPORTING, asEacc.headers);
    expect((await get(`/internal/v1/documents/${referralPackage.id}`)).statusCode).toBe(404);
    expect((await get(`/internal/v1/documents/${referralPackage.id}/download`)).statusCode).toBe(
      404,
    );
    const newer = await issuedPackage();
    const supersede = await api.post(
      `/internal/v1/documents/${referralPackage.id}/supersede`,
      { supersededBy: newer.id },
      REPORTING,
      asEacc,
    );
    expect(supersede.statusCode, supersede.body).toBe(404);

    const before = (await eventsAbout(referralPackage.id)).length;
    await expect(
      api.app.get(IssuanceService).announce('eacc', 'test', referralPackage.id),
    ).rejects.toMatchObject({ problem: { status: 404 } });
    expect(await eventsAbout(referralPackage.id)).toHaveLength(before);

    // The Commission itself still reads it.
    const asPsc = await api.get(`/internal/v1/documents/${referralPackage.id}`, REVIEW, {
      'x-acting-tenant': 'psc',
    });
    expect(asPsc.statusCode).toBe(200);
  });

  it("answers 404 to EACC for any other document: a Commission's Form M, even EACC's own report", async () => {
    for (const document of [formM, ncr]) {
      expect((await download(document.id, EACC_ANALYST)).statusCode).toBe(404);
      expect((await download(document.id, EACC_SUPERVISOR)).statusCode).toBe(404);
    }
    expect((await download(randomUUID(), EACC_ANALYST)).statusCode).toBe(404);
  });
});

/** A referral package's payload, as the review service holds it (spec 08). */
function packagePayload(): ReferralPackagePayload {
  return {
    reference: format(RFL, { issuer: 'PSC', period: 2028, sequence: 31 }),
    grounds: 'undeclared-assets',
    groundsLabel: 'Undeclared assets',
    cycleYear: 2027,
    commission: { name: 'Public Service Commission', issuerCode: 'PSC' },
    declarant: { name: 'Daniel Ochieng Otieno', personnelFileNumber: 'PSC/2009/0917' },
    narrative: 'Two parcels registered to the declarant are not declared.',
    proposedBy: 'Mercy Nyambura',
    proposedAt: '2028-02-03T07:00:00.000Z',
    approvedBy: 'Lucy Wambui',
    approvedAt: '2028-02-10T08:32:00.000Z',
    manifest: [
      { kind: 'flag', reference: 'CASE-1 land-undeclared', sha256: SHA256, documentId: null },
    ],
    versions: [],
    flags: [],
    clarifications: [],
    obligations: [],
    letters: [],
  };
}
