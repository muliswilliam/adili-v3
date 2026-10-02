import { randomUUID } from 'node:crypto';

import { GetObjectCommand } from '@aws-sdk/client-s3';
import { withTenant } from '@adili/data-access';
import { documentIssuedDataSchema } from '@adili/events/contracts/schemas';
import { CLR, DCI, format } from '@adili/numbering/references';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { issuedDocuments, outbox, verificationRecords } from '../../src/db/schema.js';
import type { IssuedDocument } from '../../src/issuance/representation.js';
import type { ClarificationLetterPayload } from '../../src/issuance/templates/clarification-letter.v1.js';
import { contractErrors, okResponse } from '../support/contract.js';
import {
  type Caller,
  type DocumentsApi,
  requireEnv,
  startDocumentsApi,
} from '../support/documents-api.js';
import { footerQrCodes, pageTexts } from '../support/pdf.js';

/**
 * Spec 07a S17: the review service asks for a clarification's letter by its id; documents pulls
 * the letter's fields from the review service (faked here) for the same Commission, renders the
 * Restricted letter through compose Gotenberg, signs it with OpenBao and stores it in SeaweedFS.
 */

/** The review service's account (client credentials), issuing for a Commission. */
const REVIEW: Caller = {
  sub: 'service-account-review',
  azp: 'review',
  scope: 'documents:internal',
};
const DECLARANT_PERSON = randomUUID();
const VERIFY_ORIGIN = 'http://localhost:3030';

const CLR_REFERENCE = format(CLR, { issuer: 'TSC', period: 2026, sequence: 871 });
const DECLARATION_REFERENCE = format(DCI, { issuer: 'TSC', period: 2026, sequence: 3418 });

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
});

function letterPayload(
  overrides: Partial<ClarificationLetterPayload> = {},
): ClarificationLetterPayload {
  return {
    declarantName: 'John Kamau Otieno',
    commission: { name: 'Teachers Service Commission', issuerCode: 'TSC' },
    declarationReference: DECLARATION_REFERENCE,
    clarificationReference: CLR_REFERENCE,
    items: [
      {
        label: 'Assets · Land · Plot Kapsaret/Simat/1234 · John Kamau Otieno',
        requirementLabel: 'Explain the discrepancy or inconsistency',
        text: 'You declared the plot at KES 1,200,000. The sale agreement you attached shows a purchase price of KES 3,500,000. Please explain the difference.',
      },
      {
        label: 'Liabilities · John Kamau Otieno',
        requirementLabel: 'Provide the omitted information',
        text: 'Your payslip shows a monthly deduction to Mwalimu National SACCO. Please declare the loan balance and attach a loan statement.',
      },
    ],
    issuedAt: '2026-09-14T06:20:00.000Z',
    dueAt: '2026-10-14T06:20:00.000Z',
    portalUrl: 'http://localhost:3010/clarifications/0192f0c4-8a51-7cc2-9d1e-3b3f2a7e4c10',
    ...overrides,
  };
}

/** A clarification the review service holds the letter payload of, for the tenant. */
function clarification(
  payload: object = letterPayload(),
  tenant = 'tsc',
  declarantPersonId: string | null = DECLARANT_PERSON,
): string {
  const id = randomUUID();
  api.review.given(
    'clarification',
    tenant,
    id,
    declarantPersonId ? { ...payload, declarantPersonId } : payload,
  );
  return id;
}

function letterBody(clarificationId: string) {
  return {
    type: 'clarification-letter',
    templateVersion: 1,
    subjectRef: `clarification:${clarificationId}`,
    subjectPersonId: DECLARANT_PERSON,
    payload: { clarificationId },
  };
}

const issue = (body: unknown, tenant = 'tsc') =>
  api.post('/internal/v1/documents/issue', body, REVIEW, {
    idempotencyKey: null,
    headers: { 'x-acting-tenant': tenant },
  });

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

describe('S17 issuing a clarification letter', () => {
  let clarificationId: string;
  let document: IssuedDocument;
  let texts: string[];

  beforeAll(async () => {
    clarificationId = clarification();
    const response = await issue(letterBody(clarificationId));
    expect(response.statusCode, response.body).toBe(201);
    document = response.json<IssuedDocument>();
    texts = await pageTexts(await storedPdf(document.id));
  });

  it('answers 201 with a Restricted, valid clarification letter', () => {
    expect(
      contractErrors(okResponse('/internal/v1/documents/issue', 'post', 201), document),
    ).toEqual([]);
    expect(document).toMatchObject({
      type: 'clarification-letter',
      templateVersion: 1,
      disclosureLevel: 'restricted',
      issuerTenant: 'tsc',
      subjectRef: `clarification:${clarificationId}`,
      status: 'valid',
      verifyUrl: `${VERIFY_ORIGIN}/v/${document.verificationId}`,
    });
  });

  it('pulls the letter fields from the review service for the issuing Commission', () => {
    expect(api.review.pulls.filter((pull) => pull.id === clarificationId)).toEqual([
      { record: 'clarification', tenant: 'tsc', id: clarificationId },
    ]);
  });

  it('prints the items with what each requires, the due date and how to respond', () => {
    const letter = texts.join(' ');
    // The subject line, set in capitals.
    expect(letter).toContain(
      `REQUEST FOR CLARIFICATION: INITIAL DECLARATION ${DECLARATION_REFERENCE}`,
    );
    expect(letter).toContain('John Kamau Otieno');
    expect(letter).toContain('Teachers Service Commission');
    expect(letter).toContain(CLR_REFERENCE);
    expect(letter).toContain(DECLARATION_REFERENCE);
    expect(letter).toContain(`reviewed your initial declaration ${DECLARATION_REFERENCE}`);
    expect(letter).toContain('Please clarify the 2 items below');
    expect(letter).toContain('Assets · Land · Plot Kapsaret/Simat/1234 · John Kamau Otieno');
    expect(letter).toContain('What we need: Explain the discrepancy or inconsistency');
    expect(letter).toContain('What we need: Provide the omitted information');
    expect(letter).toContain('Please declare the loan balance and attach a loan statement.');
    expect(letter).toContain('14 Sep 2026');
    expect(letter).toContain('Respond by 14 Oct 2026');
    expect(letter).toContain('You have 30 days from receipt of this letter to respond');
    expect(letter).toContain('How to respond');
    expect(letter).toContain('Sign in to Adili Online at localhost:3010');
    expect(letter).toContain(`Open Clarifications and select ${CLR_REFERENCE}`);
    expect(letter).toContain('PDF, JPEG, PNG or HEIC, up to 20 MB each');
    expect(letter).toContain('You can respond once');
    expect(letter).toContain(
      'A response after 14 Oct 2026 is still accepted and is recorded as late',
    );
  });

  it('prints the verification code, issuer and CLR reference in the footer of every page, with the QR code', async () => {
    expect(texts.length).toBeGreaterThan(0);
    texts.forEach((text, index) => {
      expect(text).toContain(document.verificationId);
      expect(text).toContain('Issued by Teachers Service Commission through Adili Online');
      expect(text).toContain(`Ref ${CLR_REFERENCE}`);
      expect(text).toContain(`Page ${index + 1} of ${texts.length}`);
      // A letter is not versioned.
      expect(text).not.toMatch(/Version \d/);
    });
    const codes = await footerQrCodes(await storedPdf(document.id));
    expect(codes).toEqual(texts.map(() => `${VERIFY_ORIGIN}/v/${document.verificationId}`));
  });

  it('publishes reference, type, issuer and date only, on the record and the event', async () => {
    const [row] = await registered(document.subjectRef);
    const publicPayload = {
      type: 'clarification-letter',
      issuerName: 'Teachers Service Commission',
      issuerCode: 'TSC',
      issuedAt: document.issuedAt,
      reference: CLR_REFERENCE,
      version: null,
    };
    expect(row?.record.publicPayload).toEqual(publicPayload);
    expect(row?.document).toMatchObject({
      reference: CLR_REFERENCE,
      subjectVersion: null,
      subjectPersonId: DECLARANT_PERSON,
    });

    const events = await withTenant(api.db, { tenant: 'platform', subject: 'test' }, (tx) =>
      tx.select().from(outbox).where(eq(outbox.eventType, 'document.issued.v1')),
    );
    const event = events.find((each) => each.envelope.subject === document.id);
    expect(documentIssuedDataSchema.safeParse(event?.envelope.data).error).toBeUndefined();
    expect(event?.envelope.data).toMatchObject({
      documentType: 'clarification-letter',
      publicPayload,
    });
    // Nothing of who the letter is for or what it asks.
    const serialised = JSON.stringify(event?.envelope);
    for (const secret of ['John', 'Kapsaret', 'SACCO', DECLARATION_REFERENCE, DECLARANT_PERSON]) {
      expect(serialised).not.toContain(secret);
    }
  });

  it('returns the letter already issued for the clarification, with 200 and no second pull', async () => {
    const pulls = api.review.pulls.length;
    const response = await issue(letterBody(clarificationId));
    expect(response.statusCode).toBe(200);
    expect(response.json<IssuedDocument>()).toEqual(document);
    expect(api.review.pulls).toHaveLength(pulls);
  });
});

describe('S17 a long clarification letter', () => {
  it('runs over pages, each with the footer, the QR code and no item split across pages', async () => {
    const items = Array.from({ length: 9 }, (_, index) => ({
      label: `Assets · Motor vehicle KDA ${100 + index}A · John Kamau Otieno`,
      requirementLabel: 'Correct the entry',
      text: `Item ${index + 1}: the logbook shows a different registered owner from the one declared. ${'Please confirm who owns the vehicle and correct the entry so it matches the logbook. '.repeat(3)}`,
    }));
    const response = await issue(letterBody(clarification(letterPayload({ items }))));
    expect(response.statusCode, response.body).toBe(201);
    const document = response.json<IssuedDocument>();
    const pdf = await storedPdf(document.id);

    const texts = await pageTexts(pdf);
    expect(texts.length).toBeGreaterThan(1);
    texts.forEach((text, index) => {
      expect(text).toContain(document.verificationId);
      expect(text).toContain(`Page ${index + 1} of ${texts.length}`);
    });
    for (let index = 1; index <= items.length; index++) {
      // Each item's text sits on one page.
      expect(texts.filter((text) => text.includes(`Item ${index}: `))).toHaveLength(1);
    }
    const codes = await footerQrCodes(pdf);
    expect(codes).toEqual(texts.map(() => `${VERIFY_ORIGIN}/v/${document.verificationId}`));
  });
});

describe('S17 issuing a clarification letter: refusals and outages', () => {
  it('refuses a clarification the review service does not hold for the tenant with 400', async () => {
    // Held for another Commission: review answers 404 for this one.
    const id = clarification(letterPayload(), 'psc');
    const response = await issue(letterBody(id), 'tsc');
    expect(response.statusCode).toBe(400);
    expect(response.json<Problem>().errors).toEqual([
      expect.objectContaining({ path: 'payload.clarificationId' }),
    ]);
    expect(await registered(`clarification:${id}`)).toEqual([]);
  });

  it.each([
    [
      'a CLR reference of another Commission',
      { clarificationReference: format(CLR, { issuer: 'PSC', period: 2026, sequence: 1 }) },
    ],
    [
      'a CLR reference with a wrong check character',
      {
        clarificationReference: `${CLR_REFERENCE.slice(0, -1)}${CLR_REFERENCE.endsWith('A') ? 'B' : 'A'}`,
      },
    ],
    ['no items', { items: [] }],
    ['a due date before the date of issue', { dueAt: '2026-09-01T06:20:00.000Z' }],
  ])('refuses a pulled payload with %s with 400, and registers nothing', async (_, overrides) => {
    const id = clarification(letterPayload(overrides));
    const response = await issue(letterBody(id));
    expect(response.statusCode).toBe(400);
    expect(response.json<Problem>().errors?.[0]).toMatchObject({ path: 'payload' });
    expect(await registered(`clarification:${id}`)).toEqual([]);
  });

  it("refuses a request naming another person than the clarification's declarant with 400", async () => {
    const id = clarification();
    const response = await issue({ ...letterBody(id), subjectPersonId: randomUUID() });
    expect(response.statusCode).toBe(400);
    expect(response.json<Problem>().errors).toEqual([
      expect.objectContaining({ path: 'subjectPersonId' }),
    ]);
    const nobody = await issue({ ...letterBody(id), subjectPersonId: null });
    expect(nobody.statusCode).toBe(400);
    expect(await registered(`clarification:${id}`)).toEqual([]);
  });

  it("refuses a subject other than the clarification's with 400, before pulling", async () => {
    const id = clarification();
    const pulls = api.review.pulls.length;
    const response = await issue({
      ...letterBody(id),
      subjectRef: `clarification:${randomUUID()}`,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<Problem>().errors).toEqual([
      expect.objectContaining({ path: 'subjectRef' }),
    ]);
    expect(api.review.pulls).toHaveLength(pulls);
  });

  it('refuses a pulled payload that names no declarant with 400', async () => {
    const id = clarification(letterPayload(), 'tsc', null);
    const response = await issue(letterBody(id));
    expect(response.statusCode).toBe(400);
    expect(response.json<Problem>().errors?.[0]).toMatchObject({ path: 'payload' });
  });

  it('refuses a request carrying the letter fields instead of the clarification id', async () => {
    const response = await issue({ ...letterBody(randomUUID()), payload: letterPayload() });
    expect(response.statusCode).toBe(400);
  });

  it('answers 502 review-unavailable when the review service fails, and registers nothing', async () => {
    const id = clarification();
    api.review.unavailable();
    const response = await issue(letterBody(id));
    expect(response.statusCode).toBe(502);
    expect(response.json<Problem>().type).toBe('review-unavailable');
    expect(await registered(`clarification:${id}`)).toEqual([]);

    api.review.unavailable(false);
    expect((await issue(letterBody(id))).statusCode).toBe(201);
  });
});
