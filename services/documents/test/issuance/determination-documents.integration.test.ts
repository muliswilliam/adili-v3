import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { GetObjectCommand } from '@aws-sdk/client-s3';
import { withTenant } from '@adili/data-access';
import { documentIssuedDataSchema } from '@adili/events/contracts/schemas';
import type { DeclarationV1 } from '@adili/forms';
import { ADM, CLR, CMP, DCB, format, RFL } from '@adili/numbering/references';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { issuedDocuments, outbox, verificationRecords } from '../../src/db/schema.js';
import type { IssuedDocument } from '../../src/issuance/representation.js';
import type { ActionLetterPayload } from '../../src/issuance/templates/action-letters.v1.js';
import type { DecisionLetterPayload } from '../../src/issuance/templates/decision-letter.v1.js';
import type { ReferralPackagePayload } from '../../src/issuance/templates/referral-package.v1.js';
import type { ReviewRecord } from '../../src/review/review-client.js';
import { contractErrors, okResponse } from '../support/contract.js';
import {
  type Caller,
  type DocumentsApi,
  requireEnv,
  startDocumentsApi,
} from '../support/documents-api.js';
import { footerQrCodes, pageTexts } from '../support/pdf.js';

/**
 * Spec 08 (S1, S5, S6, S10, S13), the documents side: the review service asks for a decision
 * letter, a ladder step's letter or a referral's evidence package by its record's id; documents
 * pulls the fields from the review service (faked here) for the same Commission, renders the
 * document through compose Gotenberg, signs it with OpenBao and stores it in SeaweedFS. The
 * letters are Restricted, the package Confidential.
 */

/** The review service's account (client credentials), issuing for a Commission. */
const REVIEW: Caller = {
  sub: 'service-account-review',
  azp: 'review',
  scope: 'documents:internal',
};
const DECLARANT_PERSON = randomUUID();
const VERIFY_ORIGIN = 'http://localhost:3030';
const COMMISSION = { name: 'Public Service Commission', issuerCode: 'PSC' };

const DECLARATION_REFERENCE = format(DCB, { issuer: 'PSC', period: 2027, sequence: 42 });
const CMP_REFERENCE = format(CMP, { issuer: 'PSC', period: 2027, sequence: 1 });
const ADM_REFERENCE = format(ADM, { issuer: 'PSC', period: 2028, sequence: 233 });
const CLR_REFERENCE = format(CLR, { issuer: 'PSC', period: 2027, sequence: 9 });
const RFL_REFERENCE = format(RFL, { issuer: 'PSC', period: 2028, sequence: 31 });

const fixture = createRequire(import.meta.url).resolve(
  '@adili/schemas/forms/fixtures/declaration.v1/valid/biennial-household.json',
);
const DECLARATION = JSON.parse(readFileSync(fixture, 'utf8')) as DeclarationV1;

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

beforeEach(() => {
  api.review.unavailable(false);
  api.clock.reset();
});

function decisionPayload(overrides: Partial<DecisionLetterPayload> = {}): DecisionLetterPayload {
  return {
    declarantName: 'James Ochieng Otieno',
    commission: COMMISSION,
    declarationReference: DECLARATION_REFERENCE,
    determinationReference: CMP_REFERENCE,
    outcome: 'non-compliant',
    outcomeLabel: 'Non-compliant',
    reasons:
      'The payment schedule shows KES 1,500,000 paid for Plot Kapsaret/Simat/1234. Your declaration states KES 1,200,000.',
    decidedAt: new Date().toISOString(),
    portalUrl: 'http://localhost:3010/decisions/0192f0c4-8a51-7cc2-9d1e-3b3f2a7e4c10',
    ...overrides,
  };
}

function actionPayload(overrides: Partial<ActionLetterPayload> = {}): ActionLetterPayload {
  return {
    declarantName: 'Grace Wanjiru Kamau',
    personnelFileNumber: 'PSC/2019/0077',
    commission: COMMISSION,
    reference: ADM_REFERENCE,
    step: 'notice-to-comply',
    stepLabel: 'Notice to comply',
    subjectKind: 'obligation',
    subjectReference: 'biennial:2027',
    whatToDo: 'file-declaration',
    issuedAt: '2028-01-05T07:00:00.000Z',
    actBy: '2028-01-19T07:00:00.000Z',
    salaryStoppedFrom: null,
    respondUrl: 'http://localhost:3010/notices/0192f0c4-8a51-7cc2-9d1e-3b3f2a7e4c11',
    ...overrides,
  };
}

const SHA_A = 'a'.repeat(64);
const SHA_B = '0123456789abcdef'.repeat(4);
const LETTER_ID = randomUUID();
const ATTACHMENT_ID = randomUUID();

function packagePayload(overrides: Partial<ReferralPackagePayload> = {}): ReferralPackagePayload {
  return {
    reference: RFL_REFERENCE,
    grounds: 'undeclared-assets',
    groundsLabel: 'Undeclared assets',
    cycleYear: 2027,
    commission: COMMISSION,
    declarant: { name: 'Daniel Ochieng Otieno', personnelFileNumber: 'PSC/2009/0917' },
    narrative:
      'Two parcels registered to the declarant are not declared; the response did not explain them.',
    proposedBy: 'Mercy Nyambura',
    proposedAt: '2028-02-03T07:00:00.000Z',
    approvedBy: 'Lucy Wambui',
    approvedAt: '2028-02-10T08:32:00.000Z',
    manifest: [
      {
        kind: 'declaration-version',
        reference: `${DECLARATION_REFERENCE} v1`,
        sha256: SHA_A,
        documentId: null,
      },
      { kind: 'flag', reference: 'CASE-1 land-undeclared', sha256: SHA_B, documentId: null },
      { kind: 'clarification', reference: CLR_REFERENCE, sha256: SHA_A, documentId: null },
      {
        kind: 'clarification-attachment',
        reference: `${CLR_REFERENCE} Sale agreement.pdf`,
        sha256: SHA_B,
        documentId: ATTACHMENT_ID,
      },
      { kind: 'letter', reference: CLR_REFERENCE, sha256: SHA_A, documentId: LETTER_ID },
    ],
    versions: [
      {
        reference: DECLARATION_REFERENCE,
        version: 1,
        type: 'biennial',
        statementDate: DECLARATION.statementDate,
        submittedAt: '2027-11-15T07:42:00.000Z',
        late: false,
        document: DECLARATION,
      },
    ],
    flags: [
      {
        caseReference: 'CASE-1',
        ruleId: 'land-undeclared',
        severity: 'high',
        title: 'Land parcel not declared',
        indicator: 'ArdhiSasa lists 2 parcels registered to the declarant; not in the declaration.',
        evidence: { parcels: 2 },
        reviewedAt: '2028-01-20T07:00:00.000Z',
        reviewNote: 'Confirmed against the registry.',
      },
    ],
    clarifications: [
      {
        reference: CLR_REFERENCE,
        status: 'responded',
        items: [
          {
            id: 'item-1',
            requirement: 'explain-discrepancy',
            text: 'Explain the two parcels.',
            aiJobId: null,
          },
          {
            id: 'item-2',
            requirement: 'provide-omitted',
            text: 'Declare the loan secured on the parcels.',
            aiJobId: randomUUID(),
          },
        ],
        issuedAt: '2027-12-01T07:00:00.000Z',
        dueAt: '2027-12-31T07:00:00.000Z',
        respondedAt: '2027-12-20T07:00:00.000Z',
        response: {
          items: [{ itemId: 'item-1', text: 'They belong to my brother.' }],
          attachments: [{ itemId: 'item-1', uploadId: ATTACHMENT_ID, sha256: SHA_B }],
          submittedAt: '2027-12-20T07:00:00.000Z',
        },
      },
    ],
    obligations: [],
    letters: [{ reference: CLR_REFERENCE, documentId: LETTER_ID }],
    ...overrides,
  };
}

/** A record the review service holds the payload of, for the tenant; its id. */
function held(record: ReviewRecord, payload: object, tenant = 'psc'): string {
  const id = randomUUID();
  api.review.given(record, tenant, id, payload);
  return id;
}

/** A determination the review service holds, with the declarant who may download its letter. */
const determination = (payload: object = decisionPayload(), tenant = 'psc') =>
  held('determination', { ...payload, declarantPersonId: DECLARANT_PERSON }, tenant);

/** A referral the review service holds, with the declarant it refers (who never downloads it). */
const referral = (payload: object = packagePayload()) =>
  held('referral', { ...payload, declarantPersonId: DECLARANT_PERSON });

/** An administrative action the review service holds; `person` null when never onboarded. */
const action = (payload: object = actionPayload(), person: string | null = DECLARANT_PERSON) =>
  held('action', { ...payload, declarantPersonId: person });

const decisionBody = (determinationId: string) => ({
  type: 'decision-letter',
  templateVersion: 1,
  subjectRef: `determination:${determinationId}`,
  subjectPersonId: DECLARANT_PERSON,
  payload: { determinationId },
});

const actionBody = (
  type: string,
  actionId: string,
  subjectPersonId: string | null = DECLARANT_PERSON,
) => ({
  type,
  templateVersion: 1,
  subjectRef: `action:${actionId}`,
  subjectPersonId,
  payload: { actionId },
});

const packageBody = (referralId: string) => ({
  type: 'referral-package',
  templateVersion: 1,
  subjectRef: `referral:${referralId}`,
  subjectPersonId: null,
  payload: { referralId },
});

const issue = (body: unknown, tenant = 'psc') =>
  api.post('/internal/v1/documents/issue', body, REVIEW, {
    idempotencyKey: null,
    headers: { 'x-acting-tenant': tenant },
  });

async function issued(body: unknown): Promise<{ document: IssuedDocument; texts: string[] }> {
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

async function issuedEvent(documentId: string) {
  const events = await withTenant(api.db, { tenant: 'platform', subject: 'test' }, (tx) =>
    tx.select().from(outbox).where(eq(outbox.eventType, 'document.issued.v1')),
  );
  return events.find((each) => each.envelope.subject === documentId)?.envelope;
}

/** Each page carries the code, the issuer, the reference and the mark, and the QR code. */
async function expectFooters(
  document: IssuedDocument,
  texts: string[],
  reference: string,
  mark: string,
) {
  expect(texts.length).toBeGreaterThan(0);
  texts.forEach((text, index) => {
    expect(text).toContain(document.verificationId);
    expect(text).toContain('Issued by Public Service Commission through Adili Online');
    expect(text).toContain(`Ref ${reference}`);
    // The mark is letter-spaced, so the PDF's text spaces its letters.
    expect(text).toContain(mark.split('').join(' '));
    expect(text).toContain(`Page ${index + 1} of ${texts.length}`);
  });
  const codes = await footerQrCodes(await storedPdf(document.id));
  expect(codes).toEqual(texts.map(() => `${VERIFY_ORIGIN}/v/${document.verificationId}`));
}

describe('S1 the decision letter', () => {
  let determinationId: string;
  let document: IssuedDocument;
  let texts: string[];

  beforeAll(async () => {
    determinationId = determination();
    ({ document, texts } = await issued(decisionBody(determinationId)));
  });

  it('answers 201 with a Restricted, valid decision letter', () => {
    expect(
      contractErrors(okResponse('/internal/v1/documents/issue', 'post', 201), document),
    ).toEqual([]);
    expect(document).toMatchObject({
      type: 'decision-letter',
      templateVersion: 1,
      disclosureLevel: 'restricted',
      issuerTenant: 'psc',
      subjectRef: `determination:${determinationId}`,
      status: 'valid',
    });
  });

  it('pulls the letter fields from the review service for the issuing Commission', () => {
    expect(api.review.pulls.filter((pull) => pull.id === determinationId)).toEqual([
      { record: 'determination', tenant: 'psc', id: determinationId },
    ]);
  });

  it('prints the reference, the outcome, its reasons, what happens next and how to check it', () => {
    const letter = texts.join(' ');
    expect(letter).toContain(
      `COMPLIANCE DETERMINATION: BIENNIAL DECLARATION ${DECLARATION_REFERENCE}`,
    );
    expect(letter).toContain('Dear James Ochieng Otieno');
    expect(letter).toContain(CMP_REFERENCE);
    expect(letter).toContain(
      `completed its review of your biennial declaration ${DECLARATION_REFERENCE}`,
    );
    expect(letter).toContain('Non-compliant');
    expect(letter).toContain('Reasons');
    expect(letter).toContain('Your declaration states KES 1,200,000.');
    expect(letter).toContain('Your Commission may take administrative action');
    expect(letter).toContain('open Decisions');
    expect(letter).toContain('localhost:3010');
    expect(letter).toContain('The check shows only the reference, type, Commission and date');
    // Issued the day it was decided: no note of a letter produced later.
    expect(letter).not.toContain('produced on request');
  });

  it('prints the verification code, issuer, CMP reference and RESTRICTED on every page, with the QR code', async () => {
    await expectFooters(document, texts, CMP_REFERENCE, 'RESTRICTED');
  });

  it('publishes reference, type, issuer and date only, on the record and the event', async () => {
    const [row] = await registered(document.subjectRef);
    const publicPayload = {
      type: 'decision-letter',
      issuerName: 'Public Service Commission',
      issuerCode: 'PSC',
      issuedAt: document.issuedAt,
      reference: CMP_REFERENCE,
      version: null,
    };
    expect(row?.record.publicPayload).toEqual(publicPayload);
    expect(row?.document).toMatchObject({
      reference: CMP_REFERENCE,
      subjectPersonId: DECLARANT_PERSON,
    });
    const event = await issuedEvent(document.id);
    expect(documentIssuedDataSchema.safeParse(event?.data).error).toBeUndefined();
    expect(event?.data).toMatchObject({ documentType: 'decision-letter', publicPayload });
    const serialised = JSON.stringify(event);
    for (const secret of ['Otieno', 'Kapsaret', DECLARATION_REFERENCE, DECLARANT_PERSON]) {
      expect(serialised).not.toContain(secret);
    }
  });

  it('returns the letter already issued for the determination, with 200 and no second pull', async () => {
    const pulls = api.review.pulls.length;
    const response = await issue(decisionBody(determinationId));
    expect(response.statusCode).toBe(200);
    expect(response.json<IssuedDocument>()).toEqual(document);
    expect(api.review.pulls).toHaveLength(pulls);
  });

  it.each([
    ['compliant', 'Compliant', 'meets the requirements of the Conflict of Interest Act, 2025'],
    ['further-action', 'Further action', 'needs further action'],
  ] as const)('renders a %s determination', async (outcome, label, says) => {
    const { texts: page } = await issued(
      decisionBody(determination(decisionPayload({ outcome, outcomeLabel: label }))),
    );
    const letter = page.join(' ');
    expect(letter).toContain(label);
    expect(letter).toContain(says);
    expect(letter).not.toContain('may take administrative action');
  });

  it("S4 renders a bulk closure's letter on demand, without the system's reasons, saying both dates", async () => {
    const decidedAt = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
    const { texts: page } = await issued(
      decisionBody(
        determination(
          decisionPayload({
            outcome: 'compliant-no-issues',
            outcomeLabel: 'Compliant: no issues identified',
            reasons: 'Proposed by the system: low priority band, no open risk flags.',
            decidedAt,
          }),
        ),
      ),
    );
    const letter = page.join(' ');
    expect(letter).toContain('Compliant: no issues identified');
    expect(letter).toContain('identified no issues with your declaration');
    expect(letter).not.toContain('Proposed by the system');
    expect(letter).toContain('This letter was produced on request on');
  });

  it('keeps the closing with the text before it when long reasons run onto a second page', async () => {
    const paragraph =
      'The payment schedule from the Ministry of Lands shows KES 14,500,000 paid on 3 March 2027 for Plot Kapsaret/Simat/1234 in Uasin Gishu County. Your declaration states the value as KES 1,200,000 and lists no loan or other source of funds for the difference.';
    const { texts: pages } = await issued(
      decisionBody(
        determination(decisionPayload({ reasons: Array(4).fill(paragraph).join('\n\n') })),
      ),
    );
    expect(pages.length).toBeGreaterThan(1);
    const last = pages.at(-1) ?? '';
    expect(last).toContain('Yours faithfully');
    expect(last).toContain('Keep this letter for your records');
    expect(last).toContain('Check that this letter is genuine');
  });
});

describe('S5, S6, S10 the administrative action ladder letters', () => {
  it('S5 the notice to comply: what failed, what to do, by when and how to respond', async () => {
    const actionId = action();
    const { document, texts } = await issued(actionBody('notice-to-comply', actionId));
    expect(document).toMatchObject({
      type: 'notice-to-comply',
      disclosureLevel: 'restricted',
      subjectRef: `action:${actionId}`,
    });
    const letter = texts.join(' ');
    expect(letter).toContain('NOTICE TO COMPLY: BIENNIAL DECLARATION FOR 2027 NOT FILED');
    expect(letter).toContain('Grace Wanjiru Kamau');
    expect(letter).toContain('Personnel file PSC/2019/0077');
    expect(letter).toContain(ADM_REFERENCE);
    expect(letter).toContain('You have not filed your biennial declaration for 2027');
    expect(letter).toContain('File your biennial declaration for 2027 on Adili Online.');
    expect(letter).toContain('By when 19 Jan 2028');
    expect(letter).toContain('The Commission may issue a warning');
    expect(letter).toContain(`open Notices and select ${ADM_REFERENCE}`);
    expect(letter).toContain('PDF, JPEG, PNG or HEIC, up to 20 MB each');
    expect(letter).toContain('does not by itself stop this action');
    await expectFooters(document, texts, ADM_REFERENCE, 'RESTRICTED');

    const [row] = await registered(document.subjectRef);
    expect(row?.record.publicPayload).toEqual({
      type: 'notice-to-comply',
      issuerName: 'Public Service Commission',
      issuerCode: 'PSC',
      issuedAt: document.issuedAt,
      reference: ADM_REFERENCE,
      version: null,
    });
  });

  it('S11 the warning on a clarification ladder: the clarification to answer', async () => {
    const actionId = action(
      actionPayload({
        step: 'warning',
        stepLabel: 'Warning',
        subjectKind: 'clarification',
        subjectReference: CLR_REFERENCE,
        whatToDo: 'respond-to-clarification',
      }),
    );
    const { texts } = await issued(actionBody('warning', actionId));
    const letter = texts.join(' ');
    expect(letter).toContain(`WARNING: CLARIFICATION ${CLR_REFERENCE} NOT ANSWERED`);
    expect(letter).toContain("You did not act on the Commission's notice to comply");
    expect(letter).toContain(`Respond to clarification ${CLR_REFERENCE} on Adili Online.`);
    expect(letter).toContain('The Commission may stop your salary until you comply');
  });

  it('S6 the salary stoppage: stopped from when, reinstated on compliance', async () => {
    const actionId = action(
      actionPayload({
        step: 'salary-stoppage',
        stepLabel: 'Salary stoppage',
        actBy: '2028-03-05T07:00:00.000Z',
        salaryStoppedFrom: '2028-02-05',
      }),
    );
    const { texts } = await issued(actionBody('salary-stoppage', actionId));
    const letter = texts.join(' ');
    expect(letter).toContain('Your salary has been stopped pending compliance');
    expect(letter).toContain('Salary stopped from 5 Feb 2028');
    expect(letter).toContain('Your salary is reinstated automatically once you do');
    expect(letter).toContain('If you have not complied by 5 Mar 2028');
  });

  it('S10 the disciplinary referral: referred to the employer, no deadline', async () => {
    const actionId = action(
      actionPayload({
        step: 'disciplinary-referral',
        stepLabel: 'Disciplinary referral',
        actBy: null,
      }),
    );
    const { texts } = await issued(actionBody('disciplinary-referral', actionId));
    const letter = texts.join(' ');
    expect(letter).toContain('DISCIPLINARY REFERRAL: BIENNIAL DECLARATION FOR 2027 NOT FILED');
    expect(letter).toContain('referred you to your employer for disciplinary proceedings');
    expect(letter).toContain('Remains stopped until you comply');
    expect(letter).not.toContain('By when');
  });

  it('issues the letter of an officer who never onboarded, with nobody to download it', async () => {
    const actionId = action(actionPayload(), null);
    const response = await issue(actionBody('notice-to-comply', actionId, null));
    expect(response.statusCode, response.body).toBe(201);
    const [row] = await registered(`action:${actionId}`);
    expect(row?.document.subjectPersonId).toBeNull();
  });

  it("refuses a step letter whose pulled step is another's with 400, and registers nothing", async () => {
    const actionId = action();
    const response = await issue(actionBody('warning', actionId));
    expect(response.statusCode).toBe(400);
    expect(response.json<Problem>().errors?.[0]).toMatchObject({ path: 'payload' });
    expect(await registered(`action:${actionId}`)).toEqual([]);
  });

  it.each([
    [
      'an ADM reference of another Commission',
      { reference: format(ADM, { issuer: 'TSC', period: 2028, sequence: 1 }) },
    ],
    [
      'a clarification subject without its CLR reference',
      { subjectKind: 'clarification' as const },
    ],
    ['no date to act by on a notice', { actBy: null }],
    ['a salary stopped on a notice', { salaryStoppedFrom: '2028-02-05' }],
  ])('refuses a pulled payload with %s with 400', async (_, overrides) => {
    const actionId = action(actionPayload(overrides));
    const response = await issue(actionBody('notice-to-comply', actionId));
    expect(response.statusCode).toBe(400);
    expect(response.json<Problem>().errors?.[0]).toMatchObject({ path: 'payload' });
  });

  it("refuses a request naming another person than the action's declarant with 400", async () => {
    const actionId = action();
    for (const person of [randomUUID(), null]) {
      const response = await issue(actionBody('notice-to-comply', actionId, person));
      expect(response.statusCode).toBe(400);
      expect(response.json<Problem>().errors).toEqual([
        expect.objectContaining({ path: 'subjectPersonId' }),
      ]);
    }
  });
});

describe('S13 the referral package', () => {
  let referralId: string;
  let document: IssuedDocument;
  let texts: string[];

  beforeAll(async () => {
    referralId = referral();
    ({ document, texts } = await issued(packageBody(referralId)));
  });

  it('answers 201 with a Confidential package nobody owns as a person', async () => {
    expect(document).toMatchObject({
      type: 'referral-package',
      disclosureLevel: 'confidential',
      subjectRef: `referral:${referralId}`,
      status: 'valid',
    });
    const [row] = await registered(document.subjectRef);
    // The declarant is recorded only to keep the package from them, never as its owner.
    expect(row?.document).toMatchObject({
      reference: RFL_REFERENCE,
      subjectPersonId: null,
      excludedPersonId: DECLARANT_PERSON,
    });
    expect(api.review.pulls.filter((pull) => pull.id === referralId)).toEqual([
      { record: 'referral', tenant: 'psc', id: referralId },
    ]);
  });

  it('publishes nothing but validity: no public payload on the record or the event', async () => {
    const [row] = await registered(document.subjectRef);
    expect(row?.record.publicPayload).toBeNull();
    const event = await issuedEvent(document.id);
    expect(event?.data).toMatchObject({
      documentType: 'referral-package',
      disclosureLevel: 'confidential',
      publicPayload: null,
    });
    const serialised = JSON.stringify(event);
    for (const secret of ['Otieno', RFL_REFERENCE, 'brother', DECLARATION_REFERENCE]) {
      expect(serialised).not.toContain(secret);
    }
  });

  it('prints the cover sheet: grounds, legal basis, officer, narrative, proposer and approver', () => {
    const cover = texts[0] ?? '';
    expect(cover).toContain('Referral to the Ethics and Anti-Corruption Commission');
    expect(cover).toContain(RFL_REFERENCE);
    expect(cover).toContain('Undeclared assets');
    expect(cover).toContain('Regulation 20(1)(c)');
    expect(cover).toContain('Daniel Ochieng Otieno');
    expect(cover).toContain('Personnel file PSC/2009/0917');
    expect(cover).toContain('Two parcels registered to the declarant are not declared');
    expect(cover).toContain('Mercy Nyambura');
    expect(cover).toContain('Lucy Wambui');
    expect(cover).toContain('5 items');
    expect(cover).toContain('The public officer has not been told about this referral');
    expect(cover).toContain('The check shows only whether the package is valid');
  });

  it('prints the manifest: each item with its kind, reference and SHA-256', () => {
    const all = texts.join(' ');
    const manifest = all.slice(all.indexOf('Manifest'));
    for (const kind of [
      'Declaration version',
      'Risk flag',
      'Clarification and response',
      'Clarification attachment',
      'Letter',
    ]) {
      expect(manifest).toContain(kind);
    }
    expect(manifest).toContain(`${DECLARATION_REFERENCE} v1`);
    expect(manifest).toContain('CASE-1 land-undeclared');
    expect(manifest).toContain(LETTER_ID);
    // Each hash in two halves, so it fits its column.
    expect(manifest).toContain(SHA_B.slice(0, 32));
    expect(manifest).toContain(SHA_B.slice(32));
  });

  it('prints the evidence: flags as indicators, the clarification and response, the declaration', () => {
    const all = texts.join(' ');
    expect(all).toContain('Land parcel not declared');
    expect(all).toContain('an indicator for the reviewer');
    expect(all).toContain('1. Explain the discrepancy or inconsistency');
    expect(all).toContain('Explain the two parcels.');
    // An item drafted with AI stays labelled (ADR-007); it had no answer.
    expect(all).toContain('2. Provide the omitted information AI-assisted draft');
    expect(all).toContain('No response');
    expect(all).toContain('They belong to my brother.');
    expect(all).toContain('1 attachment, listed in the manifest');
    expect(all).toContain(`${DECLARATION_REFERENCE} · Version 1`);
    expect(all).toContain('Biodata');
  });

  it('prints the code, the RFL reference and CONFIDENTIAL on every page, with the QR code', async () => {
    await expectFooters(document, texts, RFL_REFERENCE, 'CONFIDENTIAL');
  });

  it('refuses a package with a person to download it with 400, before pulling the package', async () => {
    const id = referral();
    const pulls = api.review.pulls.length;
    const response = await issue({ ...packageBody(id), subjectPersonId: DECLARANT_PERSON });
    expect(response.statusCode).toBe(400);
    expect(response.json<Problem>().errors).toEqual([
      expect.objectContaining({ path: 'subjectPersonId' }),
    ]);
    expect(api.review.pulls).toHaveLength(pulls);
    expect(await registered(`referral:${id}`)).toEqual([]);
  });

  it('refuses a pulled package that names no declarant with 400', async () => {
    const id = held('referral', packagePayload());
    const response = await issue(packageBody(id));
    expect(response.statusCode).toBe(400);
    expect(response.json<Problem>().errors).toEqual([expect.objectContaining({ path: 'payload' })]);
  });

  it('refuses a package with an empty manifest with 400', async () => {
    const id = referral(packagePayload({ manifest: [] }));
    expect((await issue(packageBody(id))).statusCode).toBe(400);
  });
});

describe('spec 08 issuing: refusals and outages', () => {
  it('refuses a record the review service does not hold for the tenant with 400', async () => {
    const id = determination(decisionPayload(), 'tsc');
    const response = await issue(decisionBody(id), 'psc');
    expect(response.statusCode).toBe(400);
    expect(response.json<Problem>().errors).toEqual([
      expect.objectContaining({ path: 'payload.determinationId' }),
    ]);
  });

  it.each([
    ['decision-letter', 'determination', { determinationId: randomUUID() }],
    ['warning', 'action', { actionId: randomUUID() }],
    ['referral-package', 'referral', { referralId: randomUUID() }],
  ])(
    "refuses a %s under another subject than its record's, before pulling",
    async (type, kind, payload) => {
      const pulls = api.review.pulls.length;
      const response = await issue({
        type,
        templateVersion: 1,
        subjectRef: `${kind}:${randomUUID()}`,
        subjectPersonId: null,
        payload,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json<Problem>().errors).toEqual([
        expect.objectContaining({ path: 'subjectRef' }),
      ]);
      expect(api.review.pulls).toHaveLength(pulls);
    },
  );

  it('refuses a request carrying the letter fields instead of the record id', async () => {
    const response = await issue({ ...decisionBody(randomUUID()), payload: decisionPayload() });
    expect(response.statusCode).toBe(400);
  });

  it('refuses a CMP reference of another Commission with 400', async () => {
    const id = determination(
      decisionPayload({
        determinationReference: format(CMP, { issuer: 'TSC', period: 2027, sequence: 1 }),
      }),
    );
    const response = await issue(decisionBody(id));
    expect(response.statusCode).toBe(400);
    expect(response.json<Problem>().errors?.[0]).toMatchObject({ path: 'payload' });
  });

  it('answers 502 review-unavailable when the review service fails, and registers nothing', async () => {
    const id = referral();
    api.review.unavailable();
    const response = await issue(packageBody(id));
    expect(response.statusCode).toBe(502);
    expect(response.json<Problem>().type).toBe('review-unavailable');
    expect(await registered(`referral:${id}`)).toEqual([]);

    api.review.unavailable(false);
    expect((await issue(packageBody(id))).statusCode).toBe(201);
  });
});

describe('internalGetDocument (spec 08: a letter in a referral manifest)', () => {
  let document: IssuedDocument;

  beforeAll(async () => {
    ({ document } = await issued(actionBody('notice-to-comply', action())));
  });

  const read = (id: string, tenant: string, caller: Caller = REVIEW) =>
    api.get(`/internal/v1/documents/${id}`, caller, { 'x-acting-tenant': tenant });

  it("answers the issuing Commission's service with the document and the SHA-256 of its PDF", async () => {
    const response = await read(document.id, 'psc');
    expect(response.statusCode).toBe(200);
    const body = response.json<IssuedDocument>();
    expect(contractErrors(okResponse('/internal/v1/documents/{documentId}', 'get'), body)).toEqual(
      [],
    );
    expect(body).toEqual(document);
    expect(body.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("answers 404 for another Commission's or an unknown document", async () => {
    expect((await read(document.id, 'tsc')).statusCode).toBe(404);
    expect((await read(randomUUID(), 'psc')).statusCode).toBe(404);
  });

  it('is for services only', async () => {
    const officer: Caller = { sub: 'officer-1', tenant: 'psc', roles: ['review-supervisor'] };
    expect((await read(document.id, 'psc', officer)).statusCode).toBe(403);
  });
});
