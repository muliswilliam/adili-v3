/**
 * In-memory stand-in for the documents service's upload endpoints (documents.yaml), used when
 * DECLARATIONS_MOCK is set until the service implements them.
 *
 * - `POST /v1/uploads` reserves an upload. `uploadUrl` is the same-origin path
 *   `/api/mock-uploads/{id}`; a portal route that accepts the browser's PUT in mock mode belongs
 *   with the attachments work (#125).
 * - `POST /v1/uploads/{id}/complete` decides the scan: a file name containing "virus" is
 *   infected, anything else is clean.
 * - `GET /v1/uploads/{id}` returns the upload.
 *
 * Limits for `declaration-attachment`: PDF, JPEG, PNG or HEIC, up to 20 MB.
 */
import { createHash, randomUUID } from 'node:crypto';

import { isRecord, json, problem, readJson } from '../declarations/mock/http';
import type { Upload, UploadPurpose } from './types';

export const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
const ATTACHMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/heic'];
const PURPOSES: UploadPurpose[] = [
  'roster-import',
  'declaration-attachment',
  'clarification-attachment',
  'action-response',
  'access-representation',
];

const uploads = new Map<string, Upload>();

/** Clears every upload (tests). */
export function resetDocumentsMock() {
  uploads.clear();
}

/** An upload as the documents service holds it; the declarations mock checks it is clean. */
export function mockUpload(id: string): Upload | undefined {
  return uploads.get(id);
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

  return problem(404, 'Not found');
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
  if (purpose === 'declaration-attachment') {
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
    maxSize: purpose === 'declaration-attachment' ? ATTACHMENT_MAX_BYTES : 50 * 1024 * 1024,
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
    size: upload.declaredSize,
    sha256: infected ? null : createHash('sha256').update(id).digest('hex'),
    completedAt: new Date().toISOString(),
  };
  uploads.set(id, done);
  return json(200, done);
}
