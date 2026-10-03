import { randomUUID } from 'node:crypto';

import { GetObjectCommand } from '@aws-sdk/client-s3';
import { withTenant } from '@adili/data-access';
import { documentIssuedDataSchema } from '@adili/events/contracts/schemas';
import { format, NCR } from '@adili/numbering/references';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { issuedDocuments, outbox, verificationRecords } from '../../src/db/schema.js';
import type { IssuedDocument } from '../../src/issuance/representation.js';
import {
  type Caller,
  type DocumentsApi,
  requireEnv,
  startDocumentsApi,
} from '../support/documents-api.js';
import { footerQrCodes, pageTexts } from '../support/pdf.js';

/**
 * Spec 09b S5 to S7, the documents side: the reporting service issues a published open-data
 * release's manifest (`open-data-manifest`, Public) for EACC's tenant, with the payload as its
 * `OpenDataReleasePublisher` builds it; documents renders it through compose Gotenberg, signs it
 * with OpenBao and stores it in SeaweedFS. Public: no protective marking, and the verify page may
 * show the whole manifest, which holds no figure and no personal data beyond who published it
 * (in the PDF only). EACC's analysts and supervisors download it; a Commission does not.
 */

const REPORTING: Caller = {
  sub: 'service-account-reporting',
  azp: 'reporting',
  scope: 'documents:internal',
};
const VERIFY_ORIGIN = 'http://localhost:3030';
const NCR_REFERENCE = format(NCR, { issuer: 'EACC', period: 2028, sequence: 1 });

const TABLES = [
  'filing-by-commission',
  'compliance-by-commission',
  'by-entity-type',
  'by-cycle',
  'access-requests',
  'national-totals',
] as const;
const hash = (seed: number) => seed.toString(16).padStart(2, '0').repeat(32);

/** What reporting's `OpenDataReleasePublisher.issueManifest` sends, for an annual release. */
function manifestRequest(releaseId: string, overrides: Record<string, unknown> = {}) {
  return {
    type: 'open-data-manifest',
    templateVersion: 1,
    subjectRef: `open-data-release:${releaseId}`,
    subjectPersonId: null,
    payload: {
      releaseId,
      financialYear: '2027/2028',
      kind: 'annual',
      version: 2,
      builtAt: '2028-09-25T13:40:00.000Z',
      ncrReference: NCR_REFERENCE,
      publishedBy: null,
      suppressionThreshold: 10,
      tables: TABLES.map((table, index) => ({
        table,
        rows: [20, 20, 0, 3, 5, 1][index],
        cellsSuppressed: [7, 4, 0, 0, 2, 0][index],
        sha256Json: hash(2 * index + 1),
        sha256Csv: hash(2 * index + 2),
      })),
      releaseSha256: hash(255),
      ...overrides,
    },
  };
}

interface Problem {
  errors?: { path: string; message: string }[];
}

let api: DocumentsApi;

beforeAll(async () => {
  api = await startDocumentsApi();
});

afterAll(async () => {
  await api.close();
});

const issue = (body: object) =>
  api.post('/internal/v1/documents/issue', body, REPORTING, {
    idempotencyKey: randomUUID(),
    headers: { 'x-acting-tenant': 'eacc' },
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

async function issued(body: object): Promise<{ document: IssuedDocument; texts: string[] }> {
  const response = await issue(body);
  expect(response.statusCode, response.body).toBe(201);
  const document = response.json<IssuedDocument>();
  return { document, texts: await pageTexts(await storedPdf(document.id)) };
}

describe('S5 to S7 the open-data release manifest', () => {
  const releaseId = randomUUID();
  let document: IssuedDocument;
  let texts: string[];
  let all: string;

  beforeAll(async () => {
    ({ document, texts } = await issued(manifestRequest(releaseId)));
    all = texts.join(' ');
  });

  it("answers 201 with a Public, valid manifest issued by EACC's tenant, about the release, versioned", async () => {
    expect(document).toMatchObject({
      type: 'open-data-manifest',
      templateVersion: 1,
      disclosureLevel: 'public',
      issuerTenant: 'eacc',
      subjectRef: `open-data-release:${releaseId}`,
      status: 'valid',
    });
    const [row] = await withTenant(api.db, { tenant: 'platform', subject: 'test' }, (tx) =>
      tx.select().from(issuedDocuments).where(eq(issuedDocuments.subjectRef, document.subjectRef)),
    );
    expect(row).toMatchObject({ reference: null, subjectVersion: 2, subjectPersonId: null });
  });

  it('prints the release, the year, kind and version, and how it was published', () => {
    expect(all).toContain('Open-data release manifest');
    expect(all).toContain('FY 2027/2028 · annual release · version 2');
    expect(all).toContain(releaseId);
    expect(all).toContain('FY 2027/2028 (1 Jul 2027 to 30 Jun 2028)');
    expect(all).toContain('Annual release, version 2');
    expect(all).toContain('Figures as at 25 Sep 2028, 16:40 EAT');
    expect(all).toContain(
      `Published automatically when the national consolidated report ${NCR_REFERENCE} was approved.`,
    );
  });

  it("prints each table's rows, hidden cells and the SHA-256 of its JSON and CSV files, and the release JSON's", () => {
    const compact = all.replace(/\s+/g, '');
    expect(all).toContain('Declarations by Commission filing-by-commission 20 7');
    expect(all).toContain('By reporting entity type by-entity-type 0 0');
    expect(all).toContain('National totals national-totals 1 0');
    for (let seed = 1; seed <= 12; seed += 1) expect(compact).toContain(hash(seed));
    expect(compact).toContain(hash(255));
    expect(all).toContain('Cells based on fewer than 10 officers are hidden');
  });

  it('prints the code, EACC and the version on every page with the QR code, and no protective mark', async () => {
    texts.forEach((text, index) => {
      expect(text).toContain(document.verificationId);
      expect(text).toContain(
        'Issued by Ethics and Anti-Corruption Commission through Adili Online',
      );
      expect(text).toContain(`Page ${String(index + 1)} of ${String(texts.length)}`);
      expect(text).not.toMatch(/R E S T R I C T E D|C O N F I D E N T I A L/);
    });
    const codes = await footerQrCodes(await storedPdf(document.id));
    expect(codes).toEqual(texts.map(() => `${VERIFY_ORIGIN}/v/${document.verificationId}`));
  });

  it('publishes the whole manifest as its public payload', async () => {
    const manifest: Record<string, unknown> = { ...manifestRequest(releaseId).payload };
    // Who published is printed on the PDF only.
    delete manifest.publishedBy;
    const publicPayload = {
      ...manifest,
      type: 'open-data-manifest',
      issuerName: 'Ethics and Anti-Corruption Commission',
      issuerCode: 'EACC',
      issuedAt: document.issuedAt,
      reference: null,
    };
    const [record] = await withTenant(api.db, { tenant: 'platform', subject: 'test' }, (tx) =>
      tx.select().from(verificationRecords).where(eq(verificationRecords.documentId, document.id)),
    );
    expect(record?.publicPayload).toEqual(publicPayload);
    const events = await withTenant(api.db, { tenant: 'platform', subject: 'test' }, (tx) =>
      tx.select().from(outbox).orderBy(asc(outbox.id)),
    );
    const event = events.find((row) => row.envelope.subject === document.id)?.envelope;
    expect(event?.type).toBe('document.issued.v1');
    expect(documentIssuedDataSchema.safeParse(event?.data).error).toBeUndefined();
    expect(event?.data).toMatchObject({ disclosureLevel: 'public', publicPayload });
  });

  it('names the EACC supervisor who published a snapshot, on the PDF only', async () => {
    const { document: snapshot, texts: pages } = await issued(
      manifestRequest(randomUUID(), {
        kind: 'snapshot',
        version: 1,
        ncrReference: null,
        publishedBy: 'Joseph Mwangi',
      }),
    );
    const text = pages.join(' ');
    expect(text).toContain('FY 2027/2028 · mid-year snapshot · version 1');
    expect(text).toContain('Published by Joseph Mwangi, EACC supervisor.');
    expect(JSON.stringify(snapshot)).not.toContain('Joseph Mwangi');
    const [record] = await withTenant(api.db, { tenant: 'platform', subject: 'test' }, (tx) =>
      tx.select().from(verificationRecords).where(eq(verificationRecords.documentId, snapshot.id)),
    );
    expect(JSON.stringify(record?.publicPayload)).not.toContain('Joseph Mwangi');
  });

  it('EACC analysts and supervisors download it; a Commission does not', async () => {
    const download = (caller: Caller) => api.get(`/v1/documents/${document.id}/download`, caller);
    for (const roles of [['eacc-analyst'], ['eacc-supervisor']]) {
      const response = await download({ sub: `eacc-${roles[0] ?? ''}`, tenant: 'eacc', roles });
      expect(response.statusCode, response.body).toBe(200);
    }
    for (const caller of [
      { sub: 'admin-psc', tenant: 'psc', roles: ['commission-admin'] },
      { sub: 'odd-1', tenant: 'psc', roles: ['eacc-analyst'] },
    ]) {
      expect((await download(caller)).statusCode, caller.sub).toBe(404);
    }
  });

  it.each([
    [
      'a table missing',
      { tables: manifestRequest(releaseId).payload.tables.slice(1) },
      'payload.tables',
    ],
    [
      'the tables out of order',
      { tables: [...manifestRequest(releaseId).payload.tables].reverse() },
      'payload.tables',
    ],
    ['an annual release without its NCR', { ncrReference: null }, 'payload.ncrReference'],
    [
      "a Commission's NCR reference",
      { ncrReference: format(NCR, { issuer: 'PSC', period: 2028, sequence: 1 }) },
      'payload.ncrReference',
    ],
    ['a malformed hash', { releaseSha256: 'abc' }, 'payload.releaseSha256'],
    ['version 0', { version: 0 }, 'payload.version'],
    ['a figure it does not print', { totals: { declared: 1 } }, 'payload'],
  ])('refuses %s with 400', async (_name, overrides, path) => {
    const response = await issue(manifestRequest(randomUUID(), overrides));
    expect(response.statusCode, response.body).toBe(400);
    expect(response.json<Problem>().errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ path })]),
    );
  });
});
