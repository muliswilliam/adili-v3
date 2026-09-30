/**
 * In-memory stand-in for the documents service's upload endpoints (documents.yaml), used when
 * DECLARATIONS_MOCK is set, to work on the portal without the documents service.
 *
 * - `POST /v1/uploads` reserves an upload. `uploadUrl` is the same-origin path
 *   `/api/mock-uploads/{id}`, served in mock mode by `routes/api/mock-uploads.$id.ts`, which
 *   hands the bytes to `receiveMockUpload`. A file name containing "fail" drops there, like a
 *   lost connection.
 * - `POST /v1/uploads/{id}/complete` decides the scan: a file name containing "virus" is
 *   infected, anything else is clean.
 * - `GET /v1/uploads/{id}` returns the upload.
 * - `GET /v1/documents/{id}/download` links to an acknowledgement slip the declarations mock
 *   issued, served in mock mode by `routes/api/mock-slips.$documentId.ts`.
 *
 * Limits for `declaration-attachment` and `clarification-attachment`: PDF, JPEG, PNG or HEIC, up
 * to 20 MB.
 */
import { createHash, randomUUID } from 'node:crypto';

import { mockSlipFile } from '../declarations/mock/acknowledgement';
import { isRecord, json, problem, readJson } from '../mock-http';
import type { Upload, UploadPurpose } from './types';
import { ATTACHMENT_PURPOSES } from './uploads.server';

export const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
const ATTACHMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/heic'];
const PURPOSES: UploadPurpose[] = ['roster-import', ...ATTACHMENT_PURPOSES];

const uploads = new Map<string, Upload>();

/** Clears every upload (tests). */
export function resetDocumentsMock() {
  uploads.clear();
}

/** An upload as the documents service holds it; the declarations mock checks it is clean. */
export function mockUpload(id: string): Upload | undefined {
  return uploads.get(id);
}

/**
 * The browser's PUT to an upload's presigned URL. Records the size received; a file name
 * containing "fail" gets a 500, as if the connection dropped (prototype rules).
 */
export function receiveMockUpload(id: string, size: number): Response {
  const upload = uploads.get(id);
  if (upload?.state !== 'awaiting-upload') return new Response(null, { status: 404 });
  if ((upload.fileName ?? '').toLowerCase().includes('fail')) {
    return new Response(null, { status: 500 });
  }
  uploads.set(id, { ...upload, size });
  return new Response(null, { status: 200 });
}

export function mockDocumentsFetch(request: Request): Promise<Response> {
  return route(request);
}

async function route(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);
  const method = request.method;

  if (method === 'POST' && pathname === '/v1/uploads') return createUpload(request);

  const complete = /^\/v1\/uploads\/([^/]+)\/complete$/.exec(pathname);
  if (method === 'POST' && complete?.[1]) return completeUpload(complete[1]);

  const one = /^\/v1\/uploads\/([^/]+)$/.exec(pathname);
  if (method === 'GET' && one?.[1]) {
    const upload = uploads.get(one[1]);
    return upload ? json(200, upload) : problem(404, 'Not found');
  }

  const download = /^\/v1\/documents\/([^/]+)\/download$/.exec(pathname);
  if (method === 'GET' && download?.[1]) return slipDownload(download[1]);

  return problem(404, 'Not found');
}

/** `GET /v1/documents/{id}/download`: a link valid for five minutes, as the service presigns. */
function slipDownload(documentId: string) {
  const file = mockSlipFile(documentId);
  if (!file) return problem(404, 'Not found');
  return json(200, {
    downloadUrl: `/api/mock-slips/${documentId}`,
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    sha256: createHash('sha256').update(file.pdf).digest('hex'),
  });
}

async function createUpload(request: Request) {
  const body = await readJson(request);
  if (
    !isRecord(body) ||
    typeof body.purpose !== 'string' ||
    !PURPOSES.includes(body.purpose as UploadPurpose) ||
    typeof body.contentType !== 'string' ||
    typeof body.declaredSize !== 'number' ||
    body.declaredSize < 1
  ) {
    return problem(400, 'Invalid upload request');
  }
  const purpose = body.purpose as UploadPurpose;
  const attachment = (ATTACHMENT_PURPOSES as readonly UploadPurpose[]).includes(purpose);
  if (attachment) {
    if (!ATTACHMENT_TYPES.includes(body.contentType)) {
      return problem(400, 'This file type cannot be attached', 'type');
    }
    if (body.declaredSize > ATTACHMENT_MAX_BYTES) {
      return problem(400, 'This file is too large', 'size');
    }
  }
  const id = randomUUID();
  const now = new Date();
  uploads.set(id, {
    id,
    purpose,
    state: 'awaiting-upload',
    rejection: null,
    contentType: body.contentType,
    detectedType: null,
    declaredSize: body.declaredSize,
    size: null,
    sha256: null,
    fileName: typeof body.fileName === 'string' ? body.fileName : null,
    createdAt: now.toISOString(),
    completedAt: null,
  });
  return json(201, {
    id,
    uploadUrl: `/api/mock-uploads/${id}`,
    expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(),
    maxSize: attachment ? ATTACHMENT_MAX_BYTES : 50 * 1024 * 1024,
  });
}

function completeUpload(id: string) {
  const upload = uploads.get(id);
  if (!upload) return problem(404, 'Not found');
  if (upload.state !== 'awaiting-upload') return problem(409, 'Upload already completed');
  const infected = (upload.fileName ?? '').toLowerCase().includes('virus');
  const done: Upload = {
    ...upload,
    state: infected ? 'infected' : 'clean',
    detectedType: upload.contentType,
    size: upload.size ?? upload.declaredSize,
    sha256: infected ? null : createHash('sha256').update(id).digest('hex'),
    completedAt: new Date().toISOString(),
  };
  uploads.set(id, done);
  return json(200, done);
}
