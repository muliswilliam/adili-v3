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
import { DCB, format } from '@adili/numbering/references';
import { asc, desc, eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { issuedDocuments, outbox, verificationRecords } from '../../src/db/schema.js';
import type { DocumentDownload, IssuedDocument } from '../../src/issuance/representation.js';
import type { AccessNilLetterPayload } from '../../src/issuance/templates/access-nil-letter.v1.js';
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

const ARQ = 'ARQ-PSC-2026-0000012-H';
const LEA = 'LEA-PSC-2026-0000004-3';
const DAY_MS = 24 * 60 * 60 * 1000;
const WATERMARK = 'Issued to Amina Achieng Otieno · ARQ-PSC-2026-0000012-H · 1 Oct 2026';

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
    spouses: {
      none: DECLARATION.spouses.none,
      items: DECLARATION.spouses.items.map((item) => {
        const disclosed: Partial<typeof item> = { ...item };
        delete disclosed.nationalId;
        delete disclosed.kraPin;
        return disclosed as NonNullable<DisclosedDeclaration['spouses']>['items'][number];
      }),
    },
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
      includeClarifications: false,
    },
    clarifications: null,
    ...overrides,
  };
}

/** A clarification of the 2027 declaration, answered late with a file, as review discloses it. */
const ANSWERED_CLARIFICATION: NonNullable<AccessPackagePayload['clarifications']>[number] = {
  declarationReference: 'DCB-PSC-2027-0000001-1',
  reference: 'CLR-PSC-2028-0000003-4',
  status: 'responded',
  issuedAt: '2028-01-10T09:00:00.000Z',
  dueAt: '2028-02-09T09:00:00.000Z',
  respondedAt: '2028-02-12T09:00:00.000Z',
  responseLate: true,
  resolvedAt: null,
  items: [
    {
      label: 'Assets · Plot KSM/123 · James Ochieng Otieno',
      requirementLabel: 'Explain the discrepancy or inconsistency',
      text: 'Explain the increase in the value of the plot since your last declaration.',
      response: {
        text: 'The plot was revalued by a registered valuer in 2027.',
        attachmentNames: ['valuation-report.pdf'],
      },
    },
  ],
};

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
    // Nor the clarifications.
    expect(all).not.toContain('Clarification');
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
    [
      'a grant reference with a wrong check character',
      {
        payload: packagePayload({
          disclosure: { ...packagePayload().disclosure, grantReference: 'ARQ-PSC-2026-0000012-5' },
        }),
      },
      'payload.disclosure.grantReference',
    ],
  ])('refuses %s with 400', async (_, overrides, path) => {
    const response = await issue(packageBody(overrides));
    expect(response.statusCode).toBe(400);
    expect(response.json<Problem>().errors).toEqual([expect.objectContaining({ path })]);
  });

  it.each([
    ["a spouse's national ID", 'spouses', { nationalId: '12345678' }],
    ["a spouse's KRA PIN", 'spouses', { kraPin: 'A012345678Z' }],
    ["a child's national ID", 'children', { nationalId: '87654321' }],
    ["a child's date of birth", 'children', { dateOfBirth: '2015-03-14' }],
  ] as const)('refuses a disclosure carrying %s (data minimisation)', async (_, members, field) => {
    const payload = packagePayload();
    const content = payload.disclosure.versions[0]?.content as Record<string, unknown>;
    const child = { id: CHILD?.id, name: CHILD?.name, includedAtStatementDate: true };
    const member = members === 'spouses' ? disclosedContent().spouses?.items[0] : child;
    content[members] = { none: false, items: [{ ...member, ...field }] };
    const response = await issue(packageBody({ payload }));
    expect(response.statusCode, response.body).toBe(400);
    expect(response.json<Problem>().errors).toEqual([
      expect.objectContaining({ path: `payload.disclosure.versions.0.content.${members}.items.0` }),
    ]);
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
      scope: {
        years: [2027],
        includeSpouses: false,
        includeChildren: false,
        sections: ['bio'],
        includeClarifications: false,
      },
    });
    const [, version] = payload.disclosure.versions;
    if (!version) throw new Error('the payload has two versions');
    payload.disclosure.versions = [{ ...version, content }];
    const document = await issued(packageBody({ payload }));
    const all = (await pageTexts(await storedPdf(document.id))).join(' ');
    expect(all).toContain('Biodata');
    expect(all).toContain(DECLARATION.officer.birth.place);
    // The biodata names the Commission, not its tenant key.
    expect(all).not.toMatch(/Responsible Commission\s*psc\b/);
    expect(all.split('Public Service Commission (PSC)').length - 1).toBe(2);
    expect(all).not.toContain('INCOME');
    expect(all).not.toContain('Household');
    for (const spouse of DECLARATION.spouses.items)
      expect(all).not.toContain(spouse.name.firstName);
  });
});

describe('S10 an access package with the clarifications a Form K grant includes', () => {
  it("prints each declaration's clarifications, as lettered and answered, and says when it has none", async () => {
    const payload = packagePayload({
      scope: { ...packagePayload().scope, includeClarifications: true },
      clarifications: [ANSWERED_CLARIFICATION],
    });
    const document = await issued(packageBody({ payload }));
    const texts = await pageTexts(await storedPdf(document.id));
    const all = texts.join(' ');

    expect(texts[0]).toContain('Clarifications the declarant gave');
    expect(all).toContain('CLR-PSC-2028-0000003-4');
    expect(all).toContain('Issued 10 Jan 2028; answered 12 Feb 2028, after the due date.');
    expect(all).toContain('Assets · Plot KSM/123 · James Ochieng Otieno');
    expect(all).toContain(
      'Explain the increase in the value of the plot since your last declaration.',
    );
    expect(all).toContain('The plot was revalued by a registered valuer in 2027.');
    expect(all).toContain('valuation-report.pdf');
    expect(all).toContain('The attached files are not part of this package.');
    // The 2025 declaration had none.
    expect(all).toContain(
      'No clarification within the granted scope was issued on this declaration.',
    );
  });

  it.each([
    [
      'clarifications the scope does not include',
      { clarifications: [ANSWERED_CLARIFICATION] },
      'payload.clarifications',
    ],
    [
      'a scope including clarifications without them',
      { scope: { ...packagePayload().scope, includeClarifications: true } },
      'payload.clarifications',
    ],
    [
      'a clarification of a declaration not disclosed',
      {
        scope: { ...packagePayload().scope, includeClarifications: true },
        clarifications: [
          { ...ANSWERED_CLARIFICATION, declarationReference: 'DCB-PSC-2023-0000009-4' },
        ],
      },
      'payload.clarifications.0.declarationReference',
    ],
  ])('refuses %s with 400', async (_, overrides, path) => {
    const response = await issue(packageBody({ payload: packagePayload(overrides) }));
    expect(response.statusCode, response.body).toBe(400);
    expect(response.json<Problem>().errors).toEqual([expect.objectContaining({ path })]);
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
    expect(response.json<Problem>()).toMatchObject({
      type: 'download-window-closed',
      code: 'download-window-closed',
    });
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

function nilLetterPayload(overrides: Partial<AccessNilLetterPayload> = {}): AccessNilLetterPayload {
  return {
    grantReference: ARQ,
    commission: { slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission' },
    declarantName: 'James Ochieng Otieno',
    legalBasis: 'act-s36-1',
    recipient: { name: 'Amina Achieng Otieno', organisation: null },
    grantedAt: '2026-10-01T06:30:00.000Z',
    scope: {
      years: [2026, 2025],
      includeSpouses: true,
      includeChildren: false,
      sections: ['income', 'assets'],
      includeClarifications: true,
    },
    ...overrides,
  };
}

function nilLetterBody(overrides: Record<string, unknown> = {}) {
  return {
    ...packageBody(),
    type: 'access-nil-letter',
    payload: nilLetterPayload(),
    ...overrides,
  };
}

describe('S10 issuing a nil letter for a grant with nothing to disclose', () => {
  let document: IssuedDocument;
  let texts: string[];

  beforeAll(async () => {
    document = await issued(nilLetterBody());
    texts = await pageTexts(await storedPdf(document.id));
  });

  it('answers 201 with a confidential document and the download window of a package', () => {
    expect(
      contractErrors(okResponse('/internal/v1/documents/issue', 'post', 201), document),
    ).toEqual([]);
    expect(document).toMatchObject({
      type: 'access-nil-letter',
      disclosureLevel: 'confidential',
      issuerTenant: 'psc',
      status: 'valid',
    });
    expect(Date.parse(document.downloadExpiresAt ?? '')).toBe(
      Date.parse(document.issuedAt) + 14 * DAY_MS,
    );
  });

  it('says no declaration is held within the granted scope, watermarked and marked on every page', () => {
    const all = texts.join(' ');
    expect(texts[0]).toContain('No declarations held');
    expect(all).toContain('No declarations held within the granted scope');
    expect(all).toContain(
      'It holds no declaration of income, assets and liabilities by James Ochieng Otieno within the scope granted',
    );
    expect(texts[0]).toContain('Issued to Amina Achieng Otieno');
    expect(texts[0]).toContain('Declarations of 2025, 2026');
    expect(texts[0]).toContain('Persons: the declarant, spouses');
    expect(texts[0]).toContain('Sections: Income, Assets');
    expect(texts[0]).toContain('Clarifications the declarant gave');
    expect(texts[0]).toContain('section 36(1) of the Act (Form K)');
    // A one-page letter: the signature does not spill onto a page of its own.
    expect(texts).toHaveLength(1);
    for (const text of texts) {
      expect(text).toContain(WATERMARK);
      expect(compact(text)).toContain('CONFIDENTIAL');
      expect(text).toContain(`Ref ${ARQ}`);
      expect(text).toContain(document.verificationId);
    }
  });

  it('shows validity only on the verify page', async () => {
    const [record] = await withTenant(api.db, { tenant: 'platform', subject: 'test' }, (tx) =>
      tx.select().from(verificationRecords).where(eq(verificationRecords.documentId, document.id)),
    );
    expect(record).toMatchObject({ disclosureLevel: 'confidential', publicPayload: null });
  });

  it('downloads for the recipient only, within the window', async () => {
    const response = await download(document.id, APPLICANT);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json<DocumentDownload>().downloadUrl).toMatch(/^http/);
    for (const other of [DECLARANT, ACCESS_OFFICER]) {
      expect((await download(document.id, other)).statusCode).toBe(404);
    }
    api.clock.advance(14 * DAY_MS);
    expect((await download(document.id, APPLICANT)).statusCode).toBe(410);
  });

  it('names a law-enforcement officer with their agency', async () => {
    const lea = await issued(
      nilLetterBody({
        subjectRef: `lea-request:${randomUUID()}`,
        subjectPersonId: LEA_OFFICER_PERSON,
        watermark: { recipientName: 'Peter Mwangi, DCI', reference: LEA, date: '2026-10-01' },
        payload: nilLetterPayload({
          grantReference: LEA,
          legalBasis: 'act-s36-2',
          recipient: {
            name: 'Peter Mwangi',
            organisation: 'Directorate of Criminal Investigations',
          },
          scope: { ...nilLetterPayload().scope, includeClarifications: false },
        }),
      }),
    );
    const [first] = await pageTexts(await storedPdf(lea.id));
    expect(first).toContain('Issued to Peter Mwangi, Directorate of Criminal Investigations');
    expect(first).toContain('section 36(2) of the Act (Regulation 23)');
    expect(first).not.toContain('Clarifications the declarant gave');
  });

  it('needs its watermark, window and recipient, and refuses any declaration content', async () => {
    const missing = await issue(
      nilLetterBody({ watermark: undefined, downloadWindowDays: undefined, subjectPersonId: null }),
    );
    expect(missing.statusCode).toBe(400);
    expect(
      missing
        .json<Problem>()
        .errors?.map((error) => error.path)
        .sort(),
    ).toEqual(['downloadWindowDays', 'subjectPersonId', 'watermark']);
    const content = await issue(
      nilLetterBody({
        payload: { ...nilLetterPayload(), disclosure: packagePayload().disclosure },
      }),
    );
    expect(content.statusCode).toBe(400);
    expect(content.json<Problem>().errors).toEqual([expect.objectContaining({ path: 'payload' })]);
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

describe('S13 a certified copy keeps each person with their statement', () => {
  it('never leaves a name and its dates alone at the foot of a page', async () => {
    // One more income line pushes Faith Otieno's name to the foot of page 3 when the heading
    // breaks from the statement under it.
    const payload = copyPayload();
    const document = structuredClone(payload.document);
    const [officer] = document.statements;
    if (!officer?.income[0]) throw new Error('the fixture officer declares income');
    officer.income.push(officer.income[0]);
    const issuedCopy = await issued({
      type: 'certified-copy',
      templateVersion: 1,
      subjectRef: `certified-copy:${randomUUID()}`,
      subjectPersonId: DECLARANT_PERSON,
      payload: { ...payload, document },
    });
    const texts = await pageTexts(await storedPdf(issuedCopy.id));
    for (const statement of document.statements) {
      const name = [
        statement.personName.firstName,
        statement.personName.otherNames,
        statement.personName.surname,
      ]
        .filter(Boolean)
        .join(' ');
      const page = texts.find((text) => text.includes(`${name} Statement date`));
      expect(page, name).toBeDefined();
      // The first section of the statement follows on the same page.
      expect(page).toMatch(
        new RegExp(`${name} Statement date [^.]+\\. Income from [^.]+\\. INCOME`),
      );
    }
  });
});

describe('S13 a certified copy ordered in person: the recording officer hands it over', () => {
  let document: IssuedDocument;

  beforeAll(async () => {
    document = await issued({
      type: 'certified-copy',
      templateVersion: 1,
      subjectRef: `certified-copy:${randomUUID()}`,
      subjectPersonId: DECLARANT_PERSON,
      additionalDownloaders: [ACCESS_OFFICER.sub],
      payload: copyPayload(),
    });
  });

  it('downloads for the officer named on it, audited as document.downloaded.v1 by them', async () => {
    const response = await download(document.id, ACCESS_OFFICER);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json<DocumentDownload>().sha256).toBe(document.sha256);
    const metadata = await api.get(`/v1/documents/${document.id}`, ACCESS_OFFICER);
    expect(metadata.statusCode).toBe(200);

    const downloads = (await eventsAbout(document.id)).filter(
      (event) => event.type === 'document.downloaded.v1',
    );
    expect(downloads.map((event) => event.data)).toEqual([
      expect.objectContaining({ documentType: 'certified-copy', downloadedBy: ACCESS_OFFICER.sub }),
    ]);
  });

  it('records the download and its audit event together, in one insert', async () => {
    await download(document.id, ACCESS_OFFICER);

    const rows = await api.db
      .select({ type: outbox.eventType, envelope: outbox.envelope, createdAt: outbox.createdAt })
      .from(outbox)
      .orderBy(desc(outbox.id))
      .limit(2);
    expect(rows.map((row) => row.type).sort()).toEqual(['audit.read.v1', 'document.downloaded.v1']);
    // Written by the one statement: the same transaction timestamp.
    expect(rows[0]?.createdAt).toEqual(rows[1]?.createdAt);
  });

  it('still downloads for the declarant', async () => {
    expect((await download(document.id, DECLARANT)).statusCode).toBe(200);
  });

  it("downloads for EACC's access officer named on an EACC copy who also holds an EACC oversight role", async () => {
    // EACC is its own officers' Commission (ADR-006); its access officer may also be an analyst.
    const eaccOfficer: Caller = {
      sub: 'eacc-officer-1',
      tenant: 'eacc',
      roles: ['eacc-analyst', 'access-officer'],
    };
    const response = await api.post(
      '/internal/v1/documents/issue',
      {
        type: 'certified-copy',
        templateVersion: 1,
        subjectRef: `certified-copy:${randomUUID()}`,
        subjectPersonId: DECLARANT_PERSON,
        additionalDownloaders: [eaccOfficer.sub],
        payload: {
          ...copyPayload(),
          commission: {
            slug: 'eacc',
            issuerCode: 'EACC',
            name: 'Ethics and Anti-Corruption Commission',
          },
          reference: format(DCB, { issuer: 'EACC', period: 2027, sequence: 1 }),
        },
      },
      ACCESS,
      { idempotencyKey: null, headers: { 'x-acting-tenant': 'eacc' } },
    );
    expect(response.statusCode, response.body).toBe(201);
    const copy = response.json<IssuedDocument>();

    expect((await download(copy.id, eaccOfficer)).statusCode).toBe(200);
    expect((await api.get(`/v1/documents/${copy.id}`, eaccOfficer)).statusCode).toBe(200);
  });

  it("answers 404 to other officers, the officer's subject under another Commission, and other people", async () => {
    const otherOfficer: Caller = { ...ACCESS_OFFICER, sub: 'officer-2' };
    const otherCommission: Caller = { ...ACCESS_OFFICER, tenant: 'tsc' };
    const supervisor: Caller = { sub: 'supervisor-1', tenant: 'psc', roles: ['supervisor'] };
    // The officer named on it, since moved to another role at the Commission: no longer theirs.
    const reassigned: Caller = { ...ACCESS_OFFICER, roles: ['reporting-officer'] };
    const before = (await eventsAbout(document.id)).length;
    for (const caller of [
      otherOfficer,
      otherCommission,
      supervisor,
      reassigned,
      APPLICANT,
      LEA_OFFICER,
    ]) {
      expect((await download(document.id, caller)).statusCode).toBe(404);
      expect((await api.get(`/v1/documents/${document.id}`, caller)).statusCode).toBe(404);
    }
    expect(await eventsAbout(document.id)).toHaveLength(before);
  });

  it('refuses repeated downloader subjects with 400', async () => {
    const response = await issue({
      type: 'certified-copy',
      templateVersion: 1,
      subjectRef: `certified-copy:${randomUUID()}`,
      subjectPersonId: DECLARANT_PERSON,
      additionalDownloaders: ['officer-1', 'officer-1'],
      payload: copyPayload(),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<Problem>().errors).toEqual([
      expect.objectContaining({ path: 'additionalDownloaders' }),
    ]);
  });
});

describe('ADR-010 a document valid until a time (#371)', () => {
  it('signs the end of its validity into the record and announces it', async () => {
    const validUntil = new Date(Date.now() + 14 * DAY_MS);
    const document = await issued(packageBody({ validUntil: validUntil.toISOString() }));

    const [record] = await withTenant(api.db, { tenant: 'psc', subject: 'test' }, (tx) =>
      tx.select().from(verificationRecords).where(eq(verificationRecords.documentId, document.id)),
    );
    expect(record?.expiresAt).toEqual(validUntil);
    const [announced] = await eventsAbout(document.id);
    expect(documentIssuedDataSchema.parse(announced?.data).expiresAt).toBe(
      validUntil.toISOString(),
    );
  });

  it('announces no end for a document without one', async () => {
    const document = await issued(packageBody());
    const [announced] = await eventsAbout(document.id);
    expect(documentIssuedDataSchema.parse(announced?.data).expiresAt).toBeNull();
  });

  it('refuses an end that is not after the issue with 400, and issues nothing', async () => {
    const body = packageBody({ validUntil: new Date(Date.now() - 1000).toISOString() });
    const response = await issue(body);
    expect(response.statusCode).toBe(400);
    expect(response.json<Problem>().errors).toEqual([
      expect.objectContaining({ path: 'validUntil' }),
    ]);
    const rows = await withTenant(api.db, { tenant: 'platform', subject: 'test' }, (tx) =>
      tx.select().from(issuedDocuments).where(eq(issuedDocuments.subjectRef, body.subjectRef)),
    );
    expect(rows).toEqual([]);
  });
});
