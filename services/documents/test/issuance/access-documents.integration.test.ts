import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { GetObjectCommand } from '@aws-sdk/client-s3';
import { withTenant } from '@adili/data-access';
import type { DeclarationV1, Statement } from '@adili/forms';
import {
  documentDownloadedDataSchema,
  documentIssuedDataSchema,
} from '@adili/events/contracts/schemas';
import { asc, eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { issuedDocuments, outbox, verificationRecords } from '../../src/db/schema.js';
import type { DocumentDownload, IssuedDocument } from '../../src/issuance/representation.js';
import type { AccessPackagePayload } from '../../src/issuance/templates/access-package.v1.js';
import type { CertifiedCopyPayload } from '../../src/issuance/templates/certified-copy.v1.js';
import type { DisclosedDeclaration } from '../../src/issuance/templates/declaration-content.js';
import { contractErrors, okResponse } from '../support/contract.js';
import {
  type Caller,
  type DocumentsApi,
  requireEnv,
  startDocumentsApi,
} from '../support/documents-api.js';
import { footerQrCodes, pageTexts } from '../support/pdf.js';

/**
 * Spec 10 S10 (and the documents side of S7, S11 and S13): the access package, confidential and
 * watermarked with its recipient on every page, downloadable by its subject person within its
 * window; the declarant's certified copy. Rendered through compose Gotenberg and signed through
 * OpenBao as in the service; the watermark is read back from the produced PDF.
 */

/** The access service's account (client credentials), issuing for a Commission. */
const ACCESS: Caller = {
  sub: 'service-account-access',
  azp: 'access',
  scope: 'documents:internal',
};

const APPLICANT_PERSON = randomUUID();
const APPLICANT: Caller = {
  sub: 'applicant-1',
  tenant: 'public',
  personId: APPLICANT_PERSON,
  roles: ['applicant'],
  azp: 'portal',
};
/** A law-enforcement officer, with a person record of kind `law-enforcement` (#263). */
const LEA_OFFICER_PERSON = randomUUID();
const LEA_OFFICER: Caller = {
  sub: 'lea-officer-1',
  tenant: 'lea',
  personId: LEA_OFFICER_PERSON,
  roles: ['law-enforcement'],
};
const DECLARANT_PERSON = randomUUID();
const DECLARANT: Caller = { sub: 'declarant-1', personId: DECLARANT_PERSON, roles: ['declarant'] };
const ACCESS_OFFICER: Caller = { sub: 'officer-1', tenant: 'psc', roles: ['access-officer'] };

const ARQ = 'ARQ-PSC-2026-0000012-5';
const LEA = 'LEA-PSC-2026-0000004-M';
const DAY_MS = 24 * 60 * 60 * 1000;
const WATERMARK = 'Issued to Amina Achieng Otieno · ARQ-PSC-2026-0000012-5 · 1 Oct 2026';

const fixture = createRequire(import.meta.url).resolve(
  '@adili/schemas/forms/fixtures/declaration.v1/valid/biennial-household.json',
);
const DECLARATION = JSON.parse(readFileSync(fixture, 'utf8')) as DeclarationV1;
const [OFFICER_STATEMENT, SPOUSE_STATEMENT] = DECLARATION.statements;
const CHILD = DECLARATION.children.items[0];

interface Problem {
  type: string;
  status: number;
  errors?: { path: string; message: string }[];
}

let api: DocumentsApi;

beforeAll(async () => {
  api = await startDocumentsApi();
  return () => api.close();
});

afterEach(() => {
  api.clock.reset();
});

/**
 * The disclosure a grant of the officer and spouses, bio, income and assets renders: no
 * children, no liabilities, no other information.
 */
function disclosedContent(): DisclosedDeclaration {
  const withoutLiabilities = (statement: Statement | undefined) => {
    if (!statement) throw new Error('the fixture has an officer and a spouse statement');
    const disclosed: Partial<Statement> = { ...statement };
    delete disclosed.liabilities;
    delete disclosed.liabilitiesNil;
    return disclosed as NonNullable<DisclosedDeclaration['statements']>[number];
  };
  const officer = withoutLiabilities(OFFICER_STATEMENT);
  const spouse = withoutLiabilities(SPOUSE_STATEMENT);
  return {
    schemaVersion: DECLARATION.schemaVersion,
    type: DECLARATION.type,
    statementDate: DECLARATION.statementDate,
    incomePeriod: DECLARATION.incomePeriod,
    officer: DECLARATION.officer,
    spouses: DECLARATION.spouses,
    statements: [officer, spouse],
    attestation: DECLARATION.attestation,
  };
}

function packagePayload(overrides: Partial<AccessPackagePayload> = {}): AccessPackagePayload {
  return {
    disclosure: {
      schemaVersion: 'disclosure.v1',
      grantReference: ARQ,
      personName: 'James Ochieng Otieno',
      commission: { slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission' },
      versions: [
        {
          reference: 'DCB-PSC-2025-0000001-T',
          version: 1,
          type: 'biennial',
          statementDate: '2025-11-01',
          submittedAt: '2025-11-15T07:42:00.000Z',
          content: disclosedContent(),
        },
        {
          reference: 'DCB-PSC-2027-0000001-1',
          version: 2,
          type: 'biennial',
          statementDate: '2027-11-01',
          submittedAt: '2027-12-01T09:00:00.000Z',
          content: disclosedContent(),
        },
      ],
    },
    legalBasis: 'act-s36-1',
    recipient: { name: 'Amina Achieng Otieno', organisation: null },
    grantedAt: '2026-10-01T06:30:00.000Z',
    scope: {
      years: [2027, 2025],
      includeSpouses: true,
      includeChildren: false,
      sections: ['bio', 'income', 'assets'],
    },
    ...overrides,
  };
}

function packageBody(overrides: Record<string, unknown> = {}) {
  return {
    type: 'access-package',
    templateVersion: 1,
    subjectRef: `access-request:${randomUUID()}`,
    subjectPersonId: APPLICANT_PERSON,
    watermark: { recipientName: 'Amina Achieng Otieno', reference: ARQ, date: '2026-10-01' },
    downloadWindowDays: 14,
    payload: packagePayload(),
    ...overrides,
  };
}

function copyPayload(): CertifiedCopyPayload {
  return {
    commission: { slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission' },
    declarantName: 'James Ochieng Otieno',
    reference: 'DCB-PSC-2027-0000001-1',
    version: 1,
    type: 'biennial',
    statementDate: '2027-11-01',
    submittedAt: '2027-11-15T07:42:00.000Z',
    document: DECLARATION,
  };
}

const issue = (body: unknown) =>
  api.post('/internal/v1/documents/issue', body, ACCESS, {
    idempotencyKey: null,
    headers: { 'x-acting-tenant': 'psc' },
  });

async function issued(body: unknown): Promise<IssuedDocument> {
  const response = await issue(body);
  expect(response.statusCode, response.body).toBe(201);
  return response.json<IssuedDocument>();
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

async function eventsAbout(documentId: string) {
  const rows = await withTenant(api.db, { tenant: 'platform', subject: 'test' }, (tx) =>
    tx.select().from(outbox).orderBy(asc(outbox.id)),
  );
  return rows.filter((row) => row.envelope.subject === documentId).map((row) => row.envelope);
}

/** Page text without spaces: pdf.js reads letter-spaced marks letter by letter. */
const compact = (text: string) => text.replace(/\s+/g, '');

const download = (id: string, caller: Caller) => api.get(`/v1/documents/${id}/download`, caller);

describe('S10 issuing an access package', () => {
  let document: IssuedDocument;
  let texts: string[];

  beforeAll(async () => {
    document = await issued(packageBody());
    texts = await pageTexts(await storedPdf(document.id));
  });

  it('answers 201 with a confidential document and its fourteen-day download window', () => {
    expect(
      contractErrors(okResponse('/internal/v1/documents/issue', 'post', 201), document),
    ).toEqual([]);
    expect(document).toMatchObject({
      type: 'access-package',
      disclosureLevel: 'confidential',
      issuerTenant: 'psc',
      status: 'valid',
    });
    expect(Date.parse(document.downloadExpiresAt ?? '')).toBe(
      Date.parse(document.issuedAt) + 14 * DAY_MS,
    );
  });

  it('carries the watermark with recipient, reference and date on every page', () => {
    // The two declarations start on pages of their own: a package of several pages.
    expect(texts.length).toBeGreaterThanOrEqual(3);
    for (const text of texts) expect(text).toContain(WATERMARK);
  });

  it('marks every page confidential with the request reference and the QR code', async () => {
    for (const text of texts) {
      expect(compact(text)).toContain('CONFIDENTIAL');
      expect(text).toContain(`Ref ${ARQ}`);
      expect(text).toContain(document.verificationId);
    }
    const codes = await footerQrCodes(await storedPdf(document.id));
    expect(codes).toEqual(codes.map(() => document.verifyUrl));
  });

  it('prints the granted scope and only the granted persons and sections', () => {
    const all = texts.join(' ');
    expect(texts[0]).toContain('Access package');
    expect(texts[0]).toContain('Issued to Amina Achieng Otieno');
    expect(texts[0]).toContain('Declarations of 2025, 2027');
    expect(texts[0]).toContain('Sections: Biodata, Income, Assets');
    expect(texts[0]).toContain('section 36(4)');
    expect(all).toContain('DCB-PSC-2025-0000001-T · Version 1');
    expect(all).toContain(OFFICER_STATEMENT?.income[0]?.description);
    expect(all).toContain(SPOUSE_STATEMENT?.assets[0]?.description);
    // Neither the children nor the liabilities were granted, nor household identifiers printed.
    expect(all).not.toContain(CHILD?.name.firstName);
    expect(all).toContain('Income and assets');
    expect(all).not.toContain('LIABILITIES');
    expect(all).not.toContain('OUTSTANDING');
    expect(all).not.toContain(SPOUSE_STATEMENT?.liabilities[0]?.creditor);
    for (const spouse of DECLARATION.spouses.items) {
      if (spouse.nationalId) expect(all).not.toContain(spouse.nationalId);
    }
  });

  it('shows validity only on the verify page: no public payload, in the record or the event', async () => {
    const [record] = await withTenant(api.db, { tenant: 'platform', subject: 'test' }, (tx) =>
      tx.select().from(verificationRecords).where(eq(verificationRecords.documentId, document.id)),
    );
    expect(record).toMatchObject({ disclosureLevel: 'confidential', publicPayload: null });
    const [event] = await eventsAbout(document.id);
    expect(event?.type).toBe('document.issued.v1');
    expect(documentIssuedDataSchema.safeParse(event?.data).error).toBeUndefined();
    expect(event?.data).toMatchObject({ disclosureLevel: 'confidential', publicPayload: null });
    const serialised = JSON.stringify(event);
    expect(serialised).not.toContain('Amina');
    expect(serialised).not.toContain('Ochieng');
  });

  it('registers the request reference the package answers', async () => {
    const [row] = await withTenant(api.db, { tenant: 'platform', subject: 'test' }, (tx) =>
      tx.select().from(issuedDocuments).where(eq(issuedDocuments.id, document.id)),
    );
    expect(row).toMatchObject({ reference: ARQ, subjectVersion: null });
  });

  it('returns the package already issued for the request, window unchanged, with 200', async () => {
    const again = await issue({ ...packageBody(), subjectRef: document.subjectRef });
    expect(again.statusCode).toBe(200);
    expect(again.json<IssuedDocument>()).toEqual(document);
  });
});

describe('S10 an access package needs its watermark, window and recipient', () => {
  it('refuses a package without them with 400 naming each, and issues nothing', async () => {
    const body = packageBody({
      watermark: undefined,
      downloadWindowDays: undefined,
      subjectPersonId: null,
    });
    const response = await issue(body);
    expect(response.statusCode).toBe(400);
    expect(
      response
        .json<Problem>()
        .errors?.map((error) => error.path)
        .sort(),
    ).toEqual(['downloadWindowDays', 'subjectPersonId', 'watermark']);
    const rows = await withTenant(api.db, { tenant: 'platform', subject: 'test' }, (tx) =>
      tx.select().from(issuedDocuments).where(eq(issuedDocuments.subjectRef, body.subjectRef)),
    );
    expect(rows).toEqual([]);
  });

  it.each([
    ['a download window of no days', { downloadWindowDays: 0 }, 'downloadWindowDays'],
    [
      'a watermark without a date',
      { watermark: { recipientName: 'A', reference: ARQ } },
      'watermark.date',
    ],
  ])('refuses %s with 400', async (_, overrides, path) => {
    const response = await issue(packageBody(overrides));
    expect(response.statusCode).toBe(400);
    expect(response.json<Problem>().errors).toEqual([expect.objectContaining({ path })]);
  });

  it('refuses a disclosure with an undisclosable field, naming it', async () => {
    const payload = packagePayload();
    const content = payload.disclosure.versions[0]?.content as Record<string, unknown>;
    content.notes = 'Not a part of declaration.v1';
    const response = await issue(packageBody({ payload }));
    expect(response.statusCode).toBe(400);
    expect(response.json<Problem>().errors).toEqual([
      expect.objectContaining({ path: 'payload.disclosure.versions.0.content' }),
    ]);
  });
});

describe('S10 an access package of the bio section only', () => {
  it('prints the particulars and no statements', async () => {
    const content: DisclosedDeclaration = {
      schemaVersion: DECLARATION.schemaVersion,
      type: DECLARATION.type,
      statementDate: DECLARATION.statementDate,
      officer: DECLARATION.officer,
      attestation: DECLARATION.attestation,
    };
    const payload = packagePayload({
      scope: { years: [2027], includeSpouses: false, includeChildren: false, sections: ['bio'] },
    });
    const [, version] = payload.disclosure.versions;
    if (!version) throw new Error('the payload has two versions');
    payload.disclosure.versions = [{ ...version, content }];
    const document = await issued(packageBody({ payload }));
    const all = (await pageTexts(await storedPdf(document.id))).join(' ');
    expect(all).toContain('Biodata');
    expect(all).toContain(DECLARATION.officer.birth.place);
    expect(all).not.toContain('INCOME');
    expect(all).not.toContain('Household');
    for (const spouse of DECLARATION.spouses.items)
      expect(all).not.toContain(spouse.name.firstName);
  });
});

describe('S10 downloading an access package within its window', () => {
  it('hands the applicant a link and records document.downloaded.v1', async () => {
    const document = await issued(packageBody());
    const response = await download(document.id, APPLICANT);
    expect(response.statusCode, response.body).toBe(200);
    expect(
      contractErrors(
        okResponse('/v1/documents/{documentId}/download', 'get'),
        response.json<DocumentDownload>(),
      ),
    ).toEqual([]);
    expect(response.json<DocumentDownload>().sha256).toBe(document.sha256);

    const downloads = (await eventsAbout(document.id)).filter(
      (event) => event.type === 'document.downloaded.v1',
    );
    expect(downloads).toHaveLength(1);
    expect(documentDownloadedDataSchema.safeParse(downloads[0]?.data).error).toBeUndefined();
    expect(downloads[0]).toMatchObject({
      tenant: 'psc',
      subject: document.id,
      data: {
        documentId: document.id,
        verificationId: document.verificationId,
        documentType: 'access-package',
        issuerTenant: 'psc',
        subjectRef: document.subjectRef,
        downloadedBy: 'applicant-1',
        downloadExpiresAt: document.downloadExpiresAt,
      },
    });
    expect(JSON.stringify(downloads[0])).not.toContain(APPLICANT_PERSON);
  });

  it('still hands out a link a moment before the window ends', async () => {
    const document = await issued(packageBody());
    api.clock.advance(14 * DAY_MS - 60_000);
    expect((await download(document.id, APPLICANT)).statusCode).toBe(200);
  });

  it('answers 404 to anyone but the subject person: another applicant, the declarant, staff', async () => {
    const document = await issued(packageBody());
    const other: Caller = { ...APPLICANT, sub: 'applicant-2', personId: randomUUID() };
    for (const caller of [other, DECLARANT, ACCESS_OFFICER]) {
      expect((await download(document.id, caller)).statusCode).toBe(404);
    }
    expect(
      (await eventsAbout(document.id)).filter((event) => event.type === 'document.downloaded.v1'),
    ).toEqual([]);
  });

  it('refuses a download once the window has ended with 410, recording no download', async () => {
    const document = await issued(packageBody());
    api.clock.advance(14 * DAY_MS);
    const response = await download(document.id, APPLICANT);
    expect(response.statusCode).toBe(410);
    expect(response.json<Problem>().type).toBe('download-window-closed');
    expect(
      (await eventsAbout(document.id)).filter((event) => event.type === 'document.downloaded.v1'),
    ).toEqual([]);
    // The metadata stays readable, with the window it had.
    const metadata = await api.get(`/v1/documents/${document.id}`, APPLICANT);
    expect(metadata.json<IssuedDocument>().downloadExpiresAt).toBe(document.downloadExpiresAt);
  });

  it('hands a law-enforcement package to the officer it was issued to (S11)', async () => {
    const document = await issued(
      packageBody({
        subjectRef: `lea-request:${randomUUID()}`,
        subjectPersonId: LEA_OFFICER_PERSON,
        watermark: { recipientName: 'Peter Mwangi, DCI', reference: LEA, date: '2026-10-01' },
        payload: packagePayload({
          disclosure: { ...packagePayload().disclosure, grantReference: LEA },
          legalBasis: 'act-s36-2',
          recipient: {
            name: 'Peter Mwangi',
            organisation: 'Directorate of Criminal Investigations',
          },
        }),
      }),
    );
    const texts = await pageTexts(await storedPdf(document.id));
    for (const text of texts)
      expect(text).toContain(`Issued to Peter Mwangi, DCI · ${LEA} · 1 Oct 2026`);
    expect(texts[0]).toContain('Peter Mwangi, Directorate of Criminal Investigations');
    expect(texts[0]).toContain('section 36(2)');

    expect((await download(document.id, LEA_OFFICER)).statusCode).toBe(200);
    expect((await download(document.id, APPLICANT)).statusCode).toBe(404);
  });
});

describe('S13 issuing a certified copy', () => {
  let document: IssuedDocument;
  let texts: string[];

  beforeAll(async () => {
    document = await issued({
      type: 'certified-copy',
      templateVersion: 1,
      subjectRef: `certified-copy:${randomUUID()}`,
      subjectPersonId: DECLARANT_PERSON,
      payload: copyPayload(),
    });
    texts = await pageTexts(await storedPdf(document.id));
  });

  it('is restricted, with the reference, type, Commission and date public, and no window', async () => {
    expect(document).toMatchObject({
      type: 'certified-copy',
      disclosureLevel: 'restricted',
      downloadExpiresAt: null,
    });
    const [event] = await eventsAbout(document.id);
    expect(event?.data).toMatchObject({
      publicPayload: {
        type: 'certified-copy',
        issuerName: 'Public Service Commission',
        issuerCode: 'PSC',
        reference: 'DCB-PSC-2027-0000001-1',
        version: 1,
      },
    });
  });

  it('prints the whole version, certified, with the mark on every page and no watermark', () => {
    const all = texts.join(' ');
    for (const text of texts) {
      expect(compact(text)).toContain('CERTIFIEDCOPY');
      expect(text).toContain('DCB-PSC-2027-0000001-1');
      expect(text).not.toContain('Issued to');
    }
    expect(texts[0]).toContain('Certified a true copy of version 1');
    expect(all).toContain(CHILD?.name.firstName);
    expect(all).toContain(SPOUSE_STATEMENT?.liabilities[0]?.creditor);
    expect(all).toContain(DECLARATION.attestation.text);
  });

  it('downloads for the declarant only', async () => {
    expect((await download(document.id, DECLARANT)).statusCode).toBe(200);
    expect((await download(document.id, APPLICANT)).statusCode).toBe(404);
    const downloads = (await eventsAbout(document.id)).filter(
      (event) => event.type === 'document.downloaded.v1',
    );
    expect(downloads.map((event) => event.data)).toEqual([
      expect.objectContaining({ documentType: 'certified-copy', downloadExpiresAt: null }),
    ]);
  });

  it('refuses a certified copy for no one with 400', async () => {
    const response = await issue({
      type: 'certified-copy',
      templateVersion: 1,
      subjectRef: `certified-copy:${randomUUID()}`,
      subjectPersonId: null,
      payload: copyPayload(),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<Problem>().errors).toEqual([
      expect.objectContaining({ path: 'subjectPersonId' }),
    ]);
  });
});
