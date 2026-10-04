import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import {
  DocumentsUnavailable,
  UploadNotClean,
  UploadNotFound,
} from '../../src/documents/documents-client.js';
import { HttpDocumentsClient } from '../../src/documents/http-documents-client.js';

/**
 * The documents client against answers that conform to the documents contract (checked here):
 * an upload is read through the internal metadata read (not the audited download), handed out
 * through the audited download for a reading, a link is recorded and taken back through the linked and unlinked markers, all acting for the Commission;
 * refusals map to the errors attachments act on.
 */
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats.default(ajv);
const contract = createRequire(import.meta.url).resolve('@adili/schemas/internal/documents.yaml');
ajv.addSchema(parse(readFileSync(contract, 'utf8')) as object, 'documents.yaml');

function conforming(schema: string, body: unknown): unknown {
  const validate = ajv.getSchema(`documents.yaml#/components/schemas/${schema}`);
  if (!validate) throw new Error(`no ${schema}`);
  expect(validate(body), JSON.stringify(validate.errors)).toBe(true);
  return body;
}

const UPLOAD_ID = '01a0e950-c833-75dd-bee2-465ead0dc3f4';
const SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function clientAnswering(respond: (request: Request) => Response) {
  const requests: { method: string; path: string; actingTenant: string | null }[] = [];
  const client = new HttpDocumentsClient({
    documentsUrl: 'http://documents.test/',
    tokens: { token: () => Promise.resolve('token'), invalidate: () => undefined },
    fetch: (input: string | URL | Request) => {
      const request = input as Request;
      requests.push({
        method: request.method,
        path: new URL(request.url).pathname,
        actingTenant: request.headers.get('x-acting-tenant'),
      });
      return Promise.resolve(respond(request));
    },
  });
  return { client, requests };
}

describe('HttpDocumentsClient', () => {
  const internalUpload = (overrides: Record<string, unknown> = {}) =>
    conforming('InternalUpload', {
      id: UPLOAD_ID,
      purpose: 'declaration-attachment',
      state: 'clean',
      rejection: null,
      contentType: 'application/pdf',
      detectedType: 'application/pdf',
      declaredSize: 1204,
      size: 1204,
      sha256: SHA256,
      fileName: 'deed.pdf',
      createdAt: '2027-11-02T08:55:00.000Z',
      completedAt: '2027-11-02T08:56:00.000Z',
      uploadedBy: 'f3c1d0aa-5f5e-4a52-9d55-0b7f1f7c2e10',
      linkedAt: null,
      ...overrides,
    });

  it("reads the Commission's clean upload through the internal metadata read", async () => {
    const { client, requests } = clientAnswering(() => json(internalUpload()));

    const upload = await client.getCleanUpload('psc', UPLOAD_ID);

    expect(upload).toEqual({
      id: UPLOAD_ID,
      purpose: 'declaration-attachment',
      uploadedBy: 'f3c1d0aa-5f5e-4a52-9d55-0b7f1f7c2e10',
      fileName: 'deed.pdf',
      sha256: SHA256,
      size: 1204,
    });
    expect(requests).toEqual([
      { method: 'GET', path: `/internal/v1/uploads/${UPLOAD_ID}`, actingTenant: 'psc' },
    ]);
  });

  it('hands out a download link for the declarant, through the audited download', async () => {
    const answer = conforming('UploadDownload', {
      id: UPLOAD_ID,
      purpose: 'declaration-attachment',
      state: 'clean',
      downloadUrl: 'http://seaweedfs.test/uploads/abc?X-Amz-Signature=1',
      expiresAt: '2027-11-02T09:05:00.000Z',
      sha256: SHA256,
      size: 1204,
      fileName: 'logbook.jpg',
      detectedType: 'image/jpeg',
    });
    let actingSubject: string | null = null;
    const { client, requests } = clientAnswering((request) => {
      actingSubject = request.headers.get('x-acting-subject');
      return json(answer);
    });

    const download = await client.getDownload('psc', UPLOAD_ID, 'declarant-sub');

    expect(download).toEqual({
      downloadUrl: 'http://seaweedfs.test/uploads/abc?X-Amz-Signature=1',
      sha256: SHA256,
      contentType: 'image/jpeg',
    });
    expect(requests).toEqual([
      { method: 'GET', path: `/internal/v1/uploads/${UPLOAD_ID}/download`, actingTenant: 'psc' },
    ]);
    expect(actingSubject).toBe('declarant-sub');
  });

  it('refuses an upload that is not clean', async () => {
    const infected = internalUpload({ state: 'infected', sha256: null, size: null });
    const { client } = clientAnswering(() => json(infected));

    await expect(client.getCleanUpload('psc', UPLOAD_ID)).rejects.toBeInstanceOf(UploadNotClean);
  });

  it('takes a link back through the unlinked marker', async () => {
    const { client, requests } = clientAnswering(() => new Response(null, { status: 204 }));

    await client.markUnlinked('psc', UPLOAD_ID);

    expect(requests).toEqual([
      { method: 'POST', path: `/internal/v1/uploads/${UPLOAD_ID}/unlinked`, actingTenant: 'psc' },
    ]);
  });

  it('records a link through the linked marker', async () => {
    const { client, requests } = clientAnswering(() => new Response(null, { status: 204 }));

    await client.markLinked('psc', UPLOAD_ID);

    expect(requests).toEqual([
      { method: 'POST', path: `/internal/v1/uploads/${UPLOAD_ID}/linked`, actingTenant: 'psc' },
    ]);
  });

  it('maps 404 to UploadNotFound, 409 to UploadNotClean and anything else to unavailable', async () => {
    const problem = (status: number) =>
      new Response(JSON.stringify({ type: 'x', title: 'x', status }), {
        status,
        headers: { 'content-type': 'application/problem+json' },
      });

    await expect(
      clientAnswering(() => problem(404)).client.getCleanUpload('psc', UPLOAD_ID),
    ).rejects.toBeInstanceOf(UploadNotFound);
    await expect(
      clientAnswering(() => problem(409)).client.getCleanUpload('psc', UPLOAD_ID),
    ).rejects.toBeInstanceOf(UploadNotClean);
    await expect(
      clientAnswering(() => problem(409)).client.getDownload('psc', UPLOAD_ID, 'sub'),
    ).rejects.toBeInstanceOf(UploadNotClean);
    await expect(
      clientAnswering(() => problem(409)).client.markLinked('psc', UPLOAD_ID),
    ).rejects.toBeInstanceOf(UploadNotClean);
    await expect(
      clientAnswering(() => problem(500)).client.markLinked('psc', UPLOAD_ID),
    ).rejects.toBeInstanceOf(DocumentsUnavailable);
    await expect(
      clientAnswering(() => problem(404)).client.markUnlinked('psc', UPLOAD_ID),
    ).rejects.toBeInstanceOf(UploadNotFound);
  });
});
