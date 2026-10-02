import { createHash, createPublicKey, randomUUID, verify } from 'node:crypto';

import { GetObjectCommand } from '@aws-sdk/client-s3';
import { withTenant } from '@adili/data-access';
import { VERIFICATION_ID_PATTERN } from '@adili/events/contracts';
import {
  documentIssuedDataSchema,
  documentSupersededDataSchema,
} from '@adili/events/contracts/schemas';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { issuedDocuments, outbox, verificationRecords } from '../../src/db/schema.js';
import {
  canonicalRecord,
  RecordSigner,
  type SignedRecord,
} from '../../src/issuance/record-signer.js';
import type { AcknowledgementSlipPayload } from '../../src/issuance/templates/acknowledgement-slip.v1.js';
import type { DocumentDownload, IssuedDocument } from '../../src/issuance/representation.js';
import { componentSchema, contractErrors, okResponse } from '../support/contract.js';
import {
  type Caller,
  type DocumentsApi,
  listKeys,
  requireEnv,
  startDocumentsApi,
  testOpenBao,
} from '../support/documents-api.js';
import {
  certificateOf,
  footerQrCodes,
  nameAttribute,
  pageTexts,
  pdfSignatures,
  signedBytes,
  verifyCms,
} from '../support/pdf.js';

/**
 * Spec 06 S9 (issuance), S10 and S13: issuing an acknowledgement slip through compose Gotenberg,
 * OpenBao (demo CA, Transit) and SeaweedFS, superseding it, and the owner's download. The
 * cryptographic claims are checked for real: the PAdES signature against the demo root, the
 * record signature with the Ed25519 public key, the QR code decoded from the rendered page.
 */

/** The declarations service's account (client credentials), issuing for a Commission. */
const DECLARATIONS: Caller = {
  sub: 'service-account-declarations',
  azp: 'declarations',
  scope: 'documents:internal',
};
/** The review service's account, downloading a letter for a reviewer of the Commission. */
const REVIEW: Caller = {
  sub: 'service-account-review',
  azp: 'review',
  scope: 'documents:internal',
};
const DECLARANT_PERSON = randomUUID();
const DECLARANT: Caller = { sub: 'declarant-1', personId: DECLARANT_PERSON, roles: ['declarant'] };
const OTHER_DECLARANT: Caller = {
  sub: 'declarant-2',
  personId: randomUUID(),
  roles: ['declarant'],
};
const OFFICER: Caller = { sub: 'officer-1', tenant: 'psc', roles: ['reporting-officer'] };

const VERIFY_ORIGIN = 'http://localhost:3030';
const CN = '2.5.4.3';
const OID = {
  contentType: '1.2.840.113549.1.9.3',
  messageDigest: '1.2.840.113549.1.9.4',
  signingTime: '1.2.840.113549.1.9.5',
  signingCertificateV2: '1.2.840.113549.1.9.16.2.47',
};

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

function slipPayload(
  overrides: Partial<AcknowledgementSlipPayload> = {},
): AcknowledgementSlipPayload {
  return {
    declarantName: 'Jane Wanjiru Kamau',
    commissionName: 'Public Service Commission',
    issuerCode: 'PSC',
    declarationType: 'biennial',
    statementDate: '2027-11-01',
    dueDate: '2027-12-31',
    reference: 'DCB-PSC-2027-0000001-1',
    version: 1,
    submittedAt: '2027-11-15T07:42:00.000Z',
    late: false,
    statementCount: 3,
    itemCount: 14,
    ...overrides,
  };
}

function issueBody(overrides: { payload?: AcknowledgementSlipPayload; subjectRef?: string } = {}) {
  return {
    type: 'acknowledgement-slip',
    templateVersion: 1,
    subjectRef: overrides.subjectRef ?? `declaration-version:${randomUUID()}`,
    subjectPersonId: DECLARANT_PERSON,
    payload: overrides.payload ?? slipPayload(),
  };
}

const issue = (body: unknown, tenant = 'psc', caller: Caller = DECLARATIONS) =>
  api.post('/internal/v1/documents/issue', body, caller, {
    idempotencyKey: null,
    headers: { 'x-acting-tenant': tenant },
  });

const supersede = (
  id: string,
  supersededBy: string,
  tenant = 'psc',
  idempotencyKey: string | null = null,
) =>
  api.post(`/internal/v1/documents/${id}/supersede`, { supersededBy }, DECLARATIONS, {
    idempotencyKey,
    headers: { 'x-acting-tenant': tenant },
  });

async function issued(body: unknown = issueBody()): Promise<IssuedDocument> {
  const response = await issue(body);
  expect(response.statusCode, response.body).toBe(201);
  return response.json<IssuedDocument>();
}

async function documentRow(id: string) {
  const [row] = await withTenant(api.db, { tenant: 'platform', subject: 'test' }, (tx) =>
    tx
      .select({ document: issuedDocuments, record: verificationRecords })
      .from(issuedDocuments)
      .innerJoin(verificationRecords, eq(verificationRecords.documentId, issuedDocuments.id))
      .where(eq(issuedDocuments.id, id)),
  );
  if (!row) throw new Error(`no document ${id}`);
  return row;
}

async function eventsAbout(documentId: string) {
  const rows = await withTenant(api.db, { tenant: 'platform', subject: 'test' }, (tx) =>
    tx.select().from(outbox).orderBy(asc(outbox.id)),
  );
  return rows.filter((row) => row.envelope.subject === documentId);
}

async function storedPdf(key: string): Promise<Uint8Array> {
  const object = await api.s3.send(
    new GetObjectCommand({ Bucket: requireEnv('S3_BUCKET_ISSUED'), Key: key }),
  );
  if (!object.Body) throw new Error(`no object ${key}`);
  return object.Body.transformToByteArray();
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** The demo CA material in OpenBao: the root and signing certificate the script put in KV. */
async function demoCa(): Promise<{ root: string; certificate: string; transitKey: string }> {
  const secret = await testOpenBao().readKv('secret', 'documents/signing/demo');
  return {
    root: secret.root ?? '',
    certificate: secret.certificate ?? '',
    transitKey: secret.transit_key ?? '',
  };
}

/** The Ed25519 public key of `documents-record-signing` at `version`, as a key object. */
async function recordPublicKey(version: number) {
  const keys = await testOpenBao().publicKeys('documents-record-signing');
  const raw = Buffer.from(keys[String(version)] ?? '', 'base64');
  // SubjectPublicKeyInfo of an Ed25519 key: fixed prefix, then the 32 raw bytes.
  const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]);
  return createPublicKey({ key: spki, format: 'der', type: 'spki' });
}

function signedRecordOf(
  row: Awaited<ReturnType<typeof documentRow>>,
  supersededBy: string | null,
): SignedRecord {
  const { record } = row;
  return {
    verificationId: record.id,
    documentId: record.documentId,
    documentType: record.documentType,
    templateVersion: record.templateVersion,
    disclosureLevel: record.disclosureLevel,
    issuerTenant: record.tenant,
    issuedAt: record.issuedAt.toISOString(),
    sha256: record.contentSha256,
    publicPayload: record.publicPayload,
    status: record.status,
    statusReasonCategory: record.statusReasonCategory,
    supersededBy,
    statusChangedAt: record.statusChangedAt?.toISOString() ?? null,
    expiresAt: record.expiresAt?.toISOString() ?? null,
  };
}

describe('S9 issuing an acknowledgement slip', () => {
  let document: IssuedDocument;
  let pdf: Uint8Array;

  beforeAll(async () => {
    document = await issued();
    pdf = await storedPdf((await documentRow(document.id)).document.objectKey);
  });

  it('answers 201 with the registered document, restricted, valid', () => {
    expect(
      contractErrors(okResponse('/internal/v1/documents/issue', 'post', 201), document),
    ).toEqual([]);
    expect(document).toMatchObject({
      type: 'acknowledgement-slip',
      templateVersion: 1,
      disclosureLevel: 'restricted',
      issuerTenant: 'psc',
      status: 'valid',
      supersededBy: null,
      verifyUrl: `${VERIFY_ORIGIN}/v/${document.verificationId}`,
    });
    expect(document.verificationId).toMatch(VERIFICATION_ID_PATTERN);
  });

  it('registers the reference number and version the slip is about, for supersession', async () => {
    const { document: row } = await documentRow(document.id);
    expect(row.reference).toBe('DCB-PSC-2027-0000001-1');
    expect(row.subjectVersion).toBe(1);
  });

  it('stores the PDF whose SHA-256 is the one registered', async () => {
    const { document: row, record } = await documentRow(document.id);
    expect(row.objectKey).toBe(`issued/${document.id}.pdf`);
    expect(sha256(pdf)).toBe(document.sha256);
    expect(row.sha256).toBe(document.sha256);
    expect(record.contentSha256).toBe(document.sha256);
    expect(row.size).toBe(pdf.length);
  });

  it('prints the reference, version, verification code and issuer in the footer of every page', async () => {
    const texts = await pageTexts(pdf);
    expect(texts.length).toBeGreaterThan(0);
    for (const text of texts) {
      expect(text).toContain('DCB-PSC-2027-0000001-1');
      expect(text).toContain('Version 1');
      expect(text).toContain(document.verificationId);
      expect(text).toContain('Issued by Public Service Commission through Adili Online');
      expect(text).toMatch(/Page 1 of 1/);
    }
    // The slip itself: declarant, Commission, type, statement date, submission, contents.
    expect(texts[0]).toContain('Acknowledgement slip');
    expect(texts[0]).toContain('Jane Wanjiru Kamau');
    expect(texts[0]).toContain('Biennial declaration');
    expect(texts[0]).toContain('1 Nov 2027');
    expect(texts[0]).toContain('15 Nov 2027, 10:42 EAT');
    expect(texts[0]).toContain('3 statements, 14 items');
  });

  it('puts a QR code whose payload is the verify URL in the footer of every page', async () => {
    const codes = await footerQrCodes(pdf);
    expect(codes).toEqual(codes.map(() => `${VERIFY_ORIGIN}/v/${document.verificationId}`));
  });

  it('carries a PAdES B-B signature that validates against the demo root', async () => {
    const signatures = await pdfSignatures(pdf);
    expect(signatures).toHaveLength(1);
    const [signature] = signatures;
    if (!signature) throw new Error('no signature');
    expect(signature.subFilter).toBe('ETSI.CAdES.detached');
    // The signature covers the whole file but its own Contents.
    const [start, first, second, rest] = signature.byteRange;
    expect(start).toBe(0);
    expect(second + rest).toBe(pdf.length);
    expect(pdf[first]).toBe('<'.charCodeAt(0));
    expect(pdf[second - 1]).toBe('>'.charCodeAt(0));

    const { root } = await demoCa();
    const check = await verifyCms(signature.cms, signedBytes(pdf, signature.byteRange), [root]);
    expect(check).toMatchObject({ signatureVerified: true, chainVerified: true, failure: null });
    expect(nameAttribute(check.signer.subject, CN)).toBe('Adili Online (demo)');
    expect(nameAttribute(check.signer.issuer, CN)).toBe('Adili Online Demo Root CA');
    // B-B: content type, digest and the signing certificate; the time is the PDF's /M, not CMS.
    expect(check.signedAttributes).toEqual([
      OID.contentType,
      OID.messageDigest,
      OID.signingCertificateV2,
    ]);
    expect(signature.signingTime?.toISOString().slice(0, 19)).toBe(document.issuedAt.slice(0, 19));
  });

  it('refuses the signature of a document changed after signing', async () => {
    const [signature] = await pdfSignatures(pdf);
    if (!signature) throw new Error('no signature');
    const tampered = Buffer.from(pdf);
    const at = tampered.indexOf('DCB-PSC-2027-0000001-1');
    // Any byte inside the signed ranges: flip one in the first range.
    const flip = at > 0 && at < signature.byteRange[1] ? at : 200;
    tampered[flip] = (tampered[flip] ?? 0) ^ 0x01;
    const { root } = await demoCa();
    const check = await verifyCms(signature.cms, signedBytes(tampered, signature.byteRange), [
      root,
    ]);
    expect(check.signatureVerified).toBe(false);
    expect(check.failure).toMatch(/digest/i);
  });

  it('signs the verification record with Ed25519, which the public key verifies', async () => {
    const row = await documentRow(document.id);
    const publicKey = await recordPublicKey(row.record.recordSigningKeyVersion);
    const signature = Buffer.from(row.record.recordSignature, 'base64');
    expect(verify(null, canonicalRecord(signedRecordOf(row, null)), publicKey, signature)).toBe(
      true,
    );
    // Any edit of the record in the database breaks it.
    const edited = { ...signedRecordOf(row, null), sha256: '0'.repeat(64) };
    expect(verify(null, canonicalRecord(edited), publicKey, signature)).toBe(false);
  });

  it('emits document.issued.v1 with identifiers and the restricted public payload only', async () => {
    const events = await eventsAbout(document.id);
    expect(events.map((event) => event.eventType)).toEqual(['document.issued.v1']);
    const [event] = events;
    // What every consumer validates it with.
    expect(documentIssuedDataSchema.safeParse(event?.envelope.data).error).toBeUndefined();
    expect(event?.envelope).toMatchObject({
      type: 'document.issued.v1',
      source: 'adili/documents',
      subject: document.id,
      tenant: 'psc',
    });
    expect(event?.envelope.data).toEqual({
      documentId: document.id,
      verificationId: document.verificationId,
      verifyUrl: document.verifyUrl,
      documentType: 'acknowledgement-slip',
      templateVersion: 1,
      disclosureLevel: 'restricted',
      issuerTenant: 'psc',
      subjectRef: document.subjectRef,
      publicPayload: {
        type: 'acknowledgement-slip',
        issuerName: 'Public Service Commission',
        issuerCode: 'PSC',
        issuedAt: document.issuedAt,
        reference: 'DCB-PSC-2027-0000001-1',
        version: 1,
      },
      sha256: document.sha256,
      issuedAt: document.issuedAt,
      status: 'valid',
    });
    // Nothing about who the slip is for, or what they declared.
    const serialised = JSON.stringify(event?.envelope);
    expect(serialised).not.toContain('Jane');
    expect(serialised).not.toContain(DECLARANT_PERSON);
    expect(serialised).not.toContain('statement');
  });

  it('returns the document already issued for the subject, with 200 and no new event', async () => {
    const response = await issue({ ...issueBody(), subjectRef: document.subjectRef });
    expect(response.statusCode).toBe(200);
    expect(response.json<IssuedDocument>()).toEqual(document);
    expect(await eventsAbout(document.id)).toHaveLength(1);
  });
});

describe('S9 a slip of an amended version, filed late', () => {
  it('prints the late filing and the version it replaces', async () => {
    const document = await issued(
      issueBody({
        payload: slipPayload({ version: 2, late: true, statementCount: 1, itemCount: 1 }),
      }),
    );
    const texts = await pageTexts(await storedPdf(`issued/${document.id}.pdf`));
    expect(texts[0]).toContain('Version 2');
    expect(texts[0]).toContain('LATE 31 Dec 2027. Submitted after the due date');
    expect(texts[0]).toContain('Version 1 (superseded)');
    expect(texts[0]).toContain('1 statement, 1 item');
  });
});

describe('issuing: validation and callers', () => {
  it.each([
    ['a wrong check character', { reference: 'DCB-PSC-2027-0000001-K' }],
    ['a reference of another declaration type', { declarationType: 'initial' as const }],
  ])('refuses a reference number with %s', async (_, overrides) => {
    const response = await issue(issueBody({ payload: slipPayload(overrides) }));
    expect(response.statusCode).toBe(400);
    expect(response.json<Problem>().errors).toEqual([
      expect.objectContaining({ path: 'payload.reference' }),
    ]);
  });

  it('refuses a payload the template does not accept with 400 and registers nothing', async () => {
    const body = issueBody({ payload: { ...slipPayload(), reference: 'not-a-reference' } });
    const response = await issue(body);
    expect(response.statusCode).toBe(400);
    expect(response.json<Problem>().errors).toEqual([
      expect.objectContaining({ path: 'payload.reference' }),
    ]);
    const rows = await withTenant(api.db, { tenant: 'platform', subject: 'test' }, (tx) =>
      tx.select().from(issuedDocuments).where(eq(issuedDocuments.subjectRef, body.subjectRef)),
    );
    expect(rows).toEqual([]);
  });

  it('refuses a template version that does not exist with 400', async () => {
    const response = await issue({ ...issueBody(), templateVersion: 99 });
    expect(response.statusCode).toBe(400);
    expect(response.json<Problem>().errors).toEqual([
      expect.objectContaining({ path: 'templateVersion' }),
    ]);
  });

  it('refuses callers without the documents:internal scope with 403', async () => {
    expect((await issue(issueBody(), 'psc', OFFICER)).statusCode).toBe(403);
  });
});

describe('S10 superseding', () => {
  it('marks the previous slip superseded, re-signs its record and emits document.superseded.v1', async () => {
    const version1 = await issued();
    const version2 = await issued(issueBody({ payload: slipPayload({ version: 2 }) }));

    const response = await supersede(version1.id, version2.id);
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<IssuedDocument>();
    expect(contractErrors(componentSchema('IssuedDocument'), body)).toEqual([]);
    expect(body).toMatchObject({
      id: version1.id,
      status: 'superseded',
      supersededBy: version2.id,
    });

    const row = await documentRow(version1.id);
    expect(row.record).toMatchObject({ status: 'superseded', supersededBy: version2.id });
    const publicKey = await recordPublicKey(row.record.recordSigningKeyVersion);
    expect(
      verify(
        null,
        canonicalRecord(signedRecordOf(row, version2.verificationId)),
        publicKey,
        Buffer.from(row.record.recordSignature, 'base64'),
      ),
    ).toBe(true);

    const events = await eventsAbout(version1.id);
    expect(events.map((event) => event.eventType)).toEqual([
      'document.issued.v1',
      'document.superseded.v1',
    ]);
    expect(documentSupersededDataSchema.safeParse(events[1]?.envelope.data).error).toBeUndefined();
    expect(events[1]?.envelope.data).toMatchObject({
      documentId: version1.id,
      verificationId: version1.verificationId,
      status: 'superseded',
      supersededBy: version2.id,
      supersededByVerificationId: version2.verificationId,
      statusChangedAt: row.record.statusChangedAt?.toISOString(),
    });
    // The newer slip stays valid.
    expect((await documentRow(version2.id)).record.status).toBe('valid');
  });

  it('refuses to supersede twice with 409, and changes nothing', async () => {
    const version1 = await issued();
    const version2 = await issued();
    const version3 = await issued();
    expect((await supersede(version1.id, version2.id)).statusCode).toBe(200);

    const again = await supersede(version1.id, version3.id);
    expect(again.statusCode).toBe(409);
    expect(again.json<Problem>().type).toBe('document-not-valid');
    expect((await documentRow(version1.id)).record.supersededBy).toBe(version2.id);
    expect(await eventsAbout(version1.id)).toHaveLength(2);
  });

  it('replays a retried supersede with the same Idempotency-Key instead of refusing it', async () => {
    const version1 = await issued();
    const version2 = await issued();
    const key = randomUUID();
    const first = await supersede(version1.id, version2.id, 'psc', key);
    expect(first.statusCode).toBe(200);

    const retry = await supersede(version1.id, version2.id, 'psc', key);

    expect(retry.statusCode).toBe(200);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.json()).toEqual(first.json());
    expect(await eventsAbout(version1.id)).toHaveLength(2);
  });

  it('signs with no lock held, so a supersede that lands meanwhile wins and the other is refused', async () => {
    const version1 = await issued();
    const version2 = await issued();
    const version3 = await issued();
    const records = api.app.get(RecordSigner);
    const sign = records.sign.bind(records);
    let meanwhile: Promise<Awaited<ReturnType<typeof supersede>>> | undefined;
    const spy = vi.spyOn(records, 'sign').mockImplementation(async (record) => {
      // The first signature waits for another supersede of the same document to finish.
      if (!meanwhile) {
        meanwhile = supersede(version1.id, version3.id);
        await meanwhile;
      }
      return sign(record);
    });

    let response: Awaited<ReturnType<typeof supersede>>;
    try {
      response = await supersede(version1.id, version2.id);
    } finally {
      spy.mockRestore();
    }

    expect((await meanwhile)?.statusCode).toBe(200);
    expect(response.statusCode).toBe(409);
    expect(response.json<Problem>().type).toBe('document-not-valid');
    expect((await documentRow(version1.id)).record.supersededBy).toBe(version3.id);
    expect(await eventsAbout(version1.id)).toHaveLength(2);
  });

  it("keeps one tenant's Idempotency-Key apart from another's on the same service token", async () => {
    const version1 = await issued();
    const version2 = await issued();
    const key = randomUUID();
    expect((await supersede(version1.id, version2.id, 'psc', key)).statusCode).toBe(200);

    // The same key and body, acting for another Commission: its own request, not psc's answer.
    const other = await supersede(version1.id, version2.id, 'tsc', key);

    expect(other.statusCode).toBe(404);
    expect(other.headers['idempotent-replayed']).toBeUndefined();
  });

  it('refuses a newer document that is not a valid one with 409', async () => {
    const version1 = await issued();
    const unknown = await supersede(version1.id, randomUUID());
    expect(unknown.statusCode).toBe(409);
    expect(unknown.json<Problem>().type).toBe('superseding-document-invalid');
    const itself = await supersede(version1.id, version1.id);
    expect(itself.statusCode).toBe(409);
    expect((await documentRow(version1.id)).record.status).toBe('valid');
  });

  it("answers 404 for another tenant's document", async () => {
    const version1 = await issued();
    const version2 = await issued();
    expect((await supersede(version1.id, version2.id, 'tsc')).statusCode).toBe(404);
  });
});

describe('S13 downloading', () => {
  it('hands the declarant a presigned URL serving the exact signed bytes, audited', async () => {
    const document = await issued();
    const response = await api.get(`/v1/documents/${document.id}/download`, DECLARANT);
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<DocumentDownload>();
    expect(contractErrors(okResponse('/v1/documents/{documentId}/download', 'get'), body)).toEqual(
      [],
    );
    expect(body.sha256).toBe(document.sha256);
    const expiresIn = Date.parse(body.expiresAt) - Date.now();
    expect(expiresIn).toBeGreaterThan(4 * 60 * 1000);
    expect(expiresIn).toBeLessThanOrEqual(5 * 60 * 1000);
    expect(new URL(body.downloadUrl).searchParams.get('X-Amz-Expires')).toBe('300');

    const fetched = await fetch(body.downloadUrl);
    expect(fetched.status).toBe(200);
    expect(fetched.headers.get('content-type')).toBe('application/pdf');
    expect(sha256(new Uint8Array(await fetched.arrayBuffer()))).toBe(document.sha256);

    const audits = (
      await withTenant(api.db, { tenant: 'platform', subject: 'test' }, (tx) =>
        tx.select().from(outbox).where(eq(outbox.eventType, 'audit.read.v1')),
      )
    ).filter(
      (row) => row.envelope.data.resource && JSON.stringify(row.envelope).includes(document.id),
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]?.envelope).toMatchObject({
      tenant: 'psc',
      data: {
        action: 'document.downloaded',
        resource: {
          type: 'issued-document',
          params: { documentId: document.id },
          tenant: 'psc',
          subjectPersonId: DECLARANT_PERSON,
        },
        actor: { subject: 'declarant-1' },
      },
    });
  });

  it('answers 404 to another declarant and to staff, with nothing audited', async () => {
    const document = await issued();
    for (const caller of [OTHER_DECLARANT, OFFICER]) {
      expect((await api.get(`/v1/documents/${document.id}/download`, caller)).statusCode).toBe(404);
      expect((await api.get(`/v1/documents/${document.id}`, caller)).statusCode).toBe(404);
    }
    const audits = await withTenant(api.db, { tenant: 'platform', subject: 'test' }, (tx) =>
      tx.select().from(outbox).where(eq(outbox.eventType, 'audit.read.v1')),
    );
    expect(audits.filter((row) => JSON.stringify(row.envelope).includes(document.id))).toEqual([]);
  });

  it("hands the issuing tenant's service a presigned URL for its staff, audited with the person and the staff member", async () => {
    const document = await issued();
    const response = await api.get(`/internal/v1/documents/${document.id}/download`, REVIEW, {
      'x-acting-tenant': 'psc',
      'x-acting-subject': 'reviewer-a',
    });
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<DocumentDownload>();
    expect(
      contractErrors(okResponse('/internal/v1/documents/{documentId}/download', 'get'), body),
    ).toEqual([]);
    expect(body.sha256).toBe(document.sha256);
    const fetched = await fetch(body.downloadUrl);
    expect(fetched.status).toBe(200);
    expect(sha256(new Uint8Array(await fetched.arrayBuffer()))).toBe(document.sha256);

    const audits = (
      await withTenant(api.db, { tenant: 'platform', subject: 'test' }, (tx) =>
        tx.select().from(outbox).where(eq(outbox.eventType, 'audit.read.v1')),
      )
    ).filter((row) => JSON.stringify(row.envelope).includes(document.id));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.envelope).toMatchObject({
      tenant: 'psc',
      data: {
        action: 'document.downloaded',
        resource: {
          type: 'issued-document',
          params: { documentId: document.id },
          tenant: 'psc',
          subjectPersonId: DECLARANT_PERSON,
        },
        // M13: the reviewer the service read for (ADR-013 §8.6).
        actor: { subject: REVIEW.sub, onBehalfOf: 'reviewer-a' },
      },
    });
  });

  it('answers 404 to a service acting for another tenant, and 403 to staff tokens', async () => {
    const document = await issued();
    const path = `/internal/v1/documents/${document.id}/download`;
    expect((await api.get(path, REVIEW, { 'x-acting-tenant': 'tsc' })).statusCode).toBe(404);
    const unknown = `/internal/v1/documents/${randomUUID()}/download`;
    expect((await api.get(unknown, REVIEW, { 'x-acting-tenant': 'psc' })).statusCode).toBe(404);
    expect((await api.get(path, OFFICER, { 'x-acting-tenant': 'psc' })).statusCode).toBe(403);
  });

  it("shows the declarant the document's metadata", async () => {
    const document = await issued();
    const response = await api.get(`/v1/documents/${document.id}`, DECLARANT);
    expect(response.statusCode).toBe(200);
    expect(
      contractErrors(okResponse('/v1/documents/{documentId}', 'get'), response.json()),
    ).toEqual([]);
    expect(response.json<IssuedDocument>()).toEqual(document);
  });
});

describe('the demo CA from infra:up', () => {
  it('holds a document signing certificate issued by the demo root for the Transit key', async () => {
    const { root, certificate, transitKey } = await demoCa();
    const signer = certificateOf(certificate);
    const rootCertificate = certificateOf(root);
    expect(nameAttribute(rootCertificate.subject, CN)).toBe('Adili Online Demo Root CA');
    expect(await signer.verify(rootCertificate)).toBe(true);
    // The certificate is for the key in Transit: its public key is the Transit key's.
    const keys = await testOpenBao().publicKeys(transitKey);
    const transitPublicKey = createPublicKey(Object.values(keys).at(-1) ?? '');
    const certificatePublicKey = createPublicKey({
      key: Buffer.from(signer.subjectPublicKeyInfo.toSchema().toBER()),
      format: 'der',
      type: 'spki',
    });
    expect(certificatePublicKey.export({ format: 'jwk' })).toEqual(
      transitPublicKey.export({ format: 'jwk' }),
    );
  });
});

describe('a dependency down', () => {
  async function nothingRegistered(api: DocumentsApi, subjectRef: string) {
    const rows = await withTenant(api.db, { tenant: 'platform', subject: 'test' }, (tx) =>
      tx.select().from(issuedDocuments).where(eq(issuedDocuments.subjectRef, subjectRef)),
    );
    expect(rows).toEqual([]);
    const events = await withTenant(api.db, { tenant: 'platform', subject: 'test' }, (tx) =>
      tx.select().from(outbox).where(eq(outbox.eventType, 'document.issued.v1')),
    );
    expect(events).toEqual([]);
  }

  it('answers 502 renderer-unavailable when Gotenberg is down, and registers nothing', async () => {
    const down = await startDocumentsApi({ gotenbergUrl: 'http://127.0.0.1:9' });
    try {
      const body = issueBody();
      const response = await down.post('/internal/v1/documents/issue', body, DECLARATIONS, {
        idempotencyKey: null,
        headers: { 'x-acting-tenant': 'psc' },
      });
      expect(response.statusCode).toBe(502);
      expect(response.json<Problem>().type).toBe('renderer-unavailable');
      await nothingRegistered(down, body.subjectRef);
    } finally {
      await down.close();
    }
  });

  it('answers 502 signer-unavailable when OpenBao is down, and registers nothing', async () => {
    const down = await startDocumentsApi({ openbaoUrl: 'http://127.0.0.1:9' });
    try {
      const body = issueBody();
      const stored = await listKeys(down.s3, requireEnv('S3_BUCKET_ISSUED'), 'issued/');
      const response = await down.post('/internal/v1/documents/issue', body, DECLARATIONS, {
        idempotencyKey: null,
        headers: { 'x-acting-tenant': 'psc' },
      });
      expect(response.statusCode).toBe(502);
      expect(response.json<Problem>().type).toBe('signer-unavailable');
      await nothingRegistered(down, body.subjectRef);
      expect(await listKeys(down.s3, requireEnv('S3_BUCKET_ISSUED'), 'issued/')).toEqual(stored);
    } finally {
      await down.close();
    }
  });
});
