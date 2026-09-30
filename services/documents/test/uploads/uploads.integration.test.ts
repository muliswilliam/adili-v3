import { createHash, randomUUID } from 'node:crypto';

import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { withTenant } from '@adili/data-access';
import { asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { outbox, uploads } from '../../src/db/schema.js';
import { CSV, XLSX } from '../../src/uploads/purposes.js';
import type {
  Upload,
  UploadDownload,
  UploadReservation,
} from '../../src/uploads/representation.js';
import { UploadsService } from '../../src/uploads/uploads.service.js';
import {
  componentSchema,
  contractErrors,
  contractOperation,
  okResponse,
} from '../support/contract.js';
import { type Caller, type DocumentsApi, startDocumentsApi } from '../support/documents-api.js';
import { EICAR, fixture, PNG } from '../support/files.js';

/**
 * Spec 02 S2 and S3: presigned upload, completion with type sniffing and a real ClamAV scan,
 * and the internal download, against compose SeaweedFS, ClamAV and Postgres.
 */
const OFFICER: Caller = { sub: 'officer-1', tenant: 'psc', roles: ['reporting-officer'] };
const OTHER_OFFICER: Caller = { sub: 'officer-2', tenant: 'psc', roles: ['reporting-officer'] };
const TSC_OFFICER: Caller = { sub: 'officer-3', tenant: 'tsc', roles: ['reporting-officer'] };
const COMMISSION_ADMIN: Caller = { tenant: 'psc', roles: ['commission-admin'] };
const PLATFORM_ADMIN: Caller = {
  tenant: 'platform',
  roles: ['platform-admin', 'reporting-officer'],
};
/** The directory's service account (client credentials, decision 2 of spec 02). */
const DIRECTORY: Caller = {
  sub: 'service-account-directory',
  azp: 'directory',
  scope: 'documents:internal',
};

const MB = 1024 * 1024;

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

async function reserve(
  bytes: Uint8Array,
  contentType: string = CSV,
  caller: Caller = OFFICER,
): Promise<UploadReservation> {
  const response = await api.post(
    '/v1/uploads',
    {
      purpose: 'roster-import',
      contentType,
      declaredSize: bytes.length,
      fileName: 'Roster 2026.csv',
    },
    caller,
  );
  expect(response.statusCode).toBe(201);
  return response.json<UploadReservation>();
}

/** Reserves an upload and PUTs the bytes as a browser would. */
async function upload(bytes: Uint8Array, contentType: string = CSV, caller: Caller = OFFICER) {
  const reservation = await reserve(bytes, contentType, caller);
  const put = await fetch(reservation.uploadUrl, {
    method: 'PUT',
    body: bytes,
    headers: { 'content-type': contentType },
  });
  expect(put.status).toBe(200);
  return reservation;
}

const complete = (id: string, caller: Caller = OFFICER) =>
  api.post(`/v1/uploads/${id}/complete`, undefined, caller);

const download = (id: string, tenant: string | null = 'psc', caller: Caller = DIRECTORY) =>
  api.get(
    `/internal/v1/uploads/${id}/download`,
    caller,
    tenant === null ? {} : { 'x-acting-tenant': tenant },
  );

const row = async (id: string) => {
  const [found] = await withTenant(api.db, { tenant: 'platform', subject: 'test' }, (tx) =>
    tx.select().from(uploads).where(eq(uploads.id, id)),
  );
  if (!found) throw new Error(`no upload ${id}`);
  return found;
};

async function objectStatus(bucket: string, key: string): Promise<number> {
  try {
    await api.s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return 200;
  } catch (error) {
    return (error as { $metadata: { httpStatusCode: number } }).$metadata.httpStatusCode;
  }
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

describe('S2 create, PUT, complete', () => {
  it('reserves an opaque quarantine key with a 15-minute presigned PUT', async () => {
    const before = Date.now();
    const response = await api.post(
      '/v1/uploads',
      { purpose: 'roster-import', contentType: CSV, declaredSize: 100, fileName: 'PSC roster.csv' },
      OFFICER,
    );

    expect(response.statusCode).toBe(201);
    const body = response.json<UploadReservation>();
    expect(contractErrors(okResponse('/v1/uploads', 'post', 201), body)).toEqual([]);
    expect(body.maxSize).toBe(50 * MB);
    const expiresIn = Date.parse(body.expiresAt) - before;
    expect(expiresIn).toBeGreaterThan(14 * 60 * 1000);
    expect(expiresIn).toBeLessThanOrEqual(15 * 60 * 1000 + 1000);

    const url = new URL(body.uploadUrl);
    expect(url.pathname).toBe(`/quarantine/roster-import/${body.id}`);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('content-length;content-type;host');
    // No tenant or personal data in the key or the URL (ADR-002).
    expect(body.uploadUrl).not.toMatch(/psc|roster\.csv|PSC/);
  });

  it('completes a CSV to clean with its SHA-256 and size', async () => {
    const bytes = fixture('roster.csv');
    const reservation = await upload(bytes);

    const response = await complete(reservation.id);

    expect(response.statusCode).toBe(200);
    const body = response.json<Upload>();
    expect(contractErrors(okResponse('/v1/uploads/{id}/complete', 'post'), body)).toEqual([]);
    expect(body).toMatchObject({
      id: reservation.id,
      purpose: 'roster-import',
      state: 'clean',
      rejection: null,
      contentType: CSV,
      detectedType: CSV,
      declaredSize: bytes.length,
      size: bytes.length,
      sha256: sha256(bytes),
      fileName: 'Roster 2026.csv',
    });
    expect(body.completedAt).not.toBeNull();

    const read = await api.get(`/v1/uploads/${reservation.id}`, OFFICER);
    expect(read.statusCode).toBe(200);
    expect(contractErrors(okResponse('/v1/uploads/{id}', 'get'), read.json())).toEqual([]);
    expect(read.json()).toEqual(body);
  });

  it('moves the bytes to the clean bucket encrypted, without client metadata', async () => {
    const bytes = fixture('roster.csv');
    const reservation = await upload(bytes);
    await complete(reservation.id);
    const key = `roster-import/${reservation.id}`;

    const head = await api.s3.send(new HeadObjectCommand({ Bucket: 'clean', Key: key }));
    expect(head.ServerSideEncryption).toBe('AES256');
    expect(head.ContentType).toBe(CSV);
    expect(head.Metadata).toEqual({});
    const object = await api.s3.send(new GetObjectCommand({ Bucket: 'clean', Key: key }));
    expect(Buffer.from((await object.Body?.transformToByteArray()) ?? [])).toEqual(bytes);
    expect(await objectStatus('quarantine', key)).toBe(404);
  });

  it('completes an XLSX to clean', async () => {
    const bytes = fixture('roster.xlsx');
    const reservation = await upload(bytes, XLSX);

    const body = (await complete(reservation.id)).json<Upload>();

    expect(body).toMatchObject({ state: 'clean', detectedType: XLSX, sha256: sha256(bytes) });
  });

  it('lets storage refuse a PUT of another size or type than declared', async () => {
    const reservation = await reserve(fixture('roster.csv'));

    const bigger = await fetch(reservation.uploadUrl, {
      method: 'PUT',
      body: Buffer.concat([fixture('roster.csv'), Buffer.from('x')]),
      headers: { 'content-type': CSV },
    });
    const otherType = await fetch(reservation.uploadUrl, {
      method: 'PUT',
      body: fixture('roster.csv'),
      headers: { 'content-type': 'text/plain' },
    });

    expect(bigger.status).toBe(403);
    expect(otherType.status).toBe(403);
  });
});

describe('S3 refused files', () => {
  it('marks the EICAR test file infected and keeps no copy', async () => {
    const reservation = await upload(EICAR);

    const body = (await complete(reservation.id)).json<Upload>();

    expect(body).toMatchObject({
      state: 'infected',
      rejection: null,
      sha256: null,
      size: EICAR.length,
    });
    expect((await row(reservation.id)).threat).toMatch(/eicar/i);
    const key = `roster-import/${reservation.id}`;
    expect(await objectStatus('quarantine', key)).toBe(404);
    expect(await objectStatus('clean', key)).toBe(404);
  });

  it('rejects a PNG declared as CSV with type', async () => {
    const reservation = await upload(PNG);

    const response = await complete(reservation.id);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      state: 'rejected',
      rejection: 'type',
      detectedType: null,
    });
    expect(await objectStatus('quarantine', `roster-import/${reservation.id}`)).toBe(404);
  });

  it('rejects a CSV that is not UTF-8 with encoding, so the officer can save it as CSV UTF-8', async () => {
    const reservation = await upload(
      Buffer.from('personnel_file_number,full_name\nPSC/1,Ren\xe9 Otieno\n', 'latin1'),
    );

    expect((await complete(reservation.id)).json()).toMatchObject({
      state: 'rejected',
      rejection: 'encoding',
      detectedType: null,
    });
    expect(await objectStatus('quarantine', `roster-import/${reservation.id}`)).toBe(404);
  });

  it('rejects a CSV declared as XLSX with type', async () => {
    const reservation = await upload(fixture('roster.csv'), XLSX);

    expect((await complete(reservation.id)).json()).toMatchObject({
      state: 'rejected',
      rejection: 'type',
    });
  });

  it('rejects an object over the 50 MB limit with size', async () => {
    const reservation = await reserve(fixture('roster.csv'));
    // Only a client bypassing the presigned URL can store more than it declared.
    const oversize = Buffer.alloc(50 * MB + 1, 'a,b,c\n');
    await api.s3.send(
      new PutObjectCommand({
        Bucket: 'quarantine',
        Key: `roster-import/${reservation.id}`,
        Body: oversize,
        ContentType: CSV,
      }),
    );

    const body = (await complete(reservation.id)).json<Upload>();

    expect(body).toMatchObject({ state: 'rejected', rejection: 'size', size: 50 * MB + 1 });
    expect(await objectStatus('quarantine', `roster-import/${reservation.id}`)).toBe(404);
  });

  it('rejects a completion without an object with missing', async () => {
    const reservation = await reserve(fixture('roster.csv'));

    const body = (await complete(reservation.id)).json<Upload>();

    expect(body).toMatchObject({ state: 'rejected', rejection: 'missing', size: null });
  });

  it('answers 409 to a second completion', async () => {
    const reservation = await upload(fixture('roster.csv'));
    await complete(reservation.id);

    const again = await complete(reservation.id);

    expect(again.statusCode).toBe(409);
    expect(again.json<Problem>().type).toBe('upload-completed');
  });
});

describe('Idempotency-Key (ADR-013 §7.5)', () => {
  const request = {
    purpose: 'roster-import',
    contentType: CSV,
    declaredSize: 10,
    fileName: 'Roster 2026.csv',
  };

  it('replays a create retried with its key instead of reserving a second upload', async () => {
    const idempotencyKey = randomUUID();

    const first = await api.post('/v1/uploads', request, OFFICER, { idempotencyKey });
    const retry = await api.post('/v1/uploads', request, OFFICER, { idempotencyKey });

    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(201);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.json<UploadReservation>().id).toBe(first.json<UploadReservation>().id);
  });

  it('replays a completion retried with its key: the final state, not a 409', async () => {
    const reservation = await upload(fixture('roster.csv'));
    const idempotencyKey = randomUUID();
    const path = `/v1/uploads/${reservation.id}/complete`;

    const first = await api.post(path, undefined, OFFICER, { idempotencyKey });
    const retry = await api.post(path, undefined, OFFICER, { idempotencyKey });

    expect(first.json<Upload>()).toMatchObject({ state: 'clean' });
    expect(retry.statusCode).toBe(200);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.json<Upload>()).toEqual(first.json<Upload>());
  });

  it('requires the key on create and complete', async () => {
    const reservation = await reserve(fixture('roster.csv'));

    const create = await api.post('/v1/uploads', request, OFFICER, { idempotencyKey: null });
    const completion = await api.post(
      `/v1/uploads/${reservation.id}/complete`,
      undefined,
      OFFICER,
      {
        idempotencyKey: null,
      },
    );

    for (const response of [create, completion]) {
      expect(response.statusCode).toBe(400);
      expect(response.json<Problem>().type).toBe('idempotency-key-missing');
    }
  });
});

describe('create validation and access', () => {
  const body = { purpose: 'roster-import', contentType: CSV, declaredSize: 10 };

  it.each([
    ['an unsupported type', { ...body, contentType: 'application/pdf' }, 'contentType'],
    ['a size over the limit', { ...body, declaredSize: 50 * MB + 1 }, 'declaredSize'],
    ['an unknown purpose', { ...body, purpose: 'selfies' }, 'purpose'],
    ['a zero size', { ...body, declaredSize: 0 }, 'declaredSize'],
  ])('refuses %s with 400', async (_, request, path) => {
    const response = await api.post('/v1/uploads', request, OFFICER);

    expect(response.statusCode).toBe(400);
    expect(response.json<Problem>().errors?.map((error) => error.path)).toContain(path);
  });

  it.each([
    ['a commission admin', COMMISSION_ADMIN],
    ['a platform-wide caller', PLATFORM_ADMIN],
    ['a caller without a tenant', { roles: ['reporting-officer'] } satisfies Caller],
  ])('refuses %s with 403', async (_, caller) => {
    expect((await api.post('/v1/uploads', body, caller)).statusCode).toBe(403);
  });

  it("shows an upload to its tenant's reporting officers only", async () => {
    const reservation = await reserve(fixture('roster.csv'));
    const path = `/v1/uploads/${reservation.id}`;

    expect((await api.get(path, OTHER_OFFICER)).statusCode).toBe(200);
    for (const caller of [TSC_OFFICER, COMMISSION_ADMIN, PLATFORM_ADMIN]) {
      expect((await api.get(path, caller)).statusCode).toBe(404);
      expect((await complete(reservation.id, caller)).statusCode).toBe(404);
    }
    expect((await row(reservation.id)).state).toBe('awaiting-upload');
  });

  it('answers 400 to an id that is not a UUID', async () => {
    expect((await api.get('/v1/uploads/not-a-uuid', OFFICER)).statusCode).toBe(400);
  });
});

describe('internal download', () => {
  let clean: UploadReservation;
  const bytes = fixture('roster.csv');

  beforeAll(async () => {
    clean = await upload(bytes);
    await complete(clean.id);
  });

  it('is an audited read of the document (ADR-008)', async () => {
    expect(contractOperation('/internal/v1/uploads/{id}/download', 'get')).toMatchObject({
      'x-audited-read': { action: 'upload.download.issued', resource: 'upload' },
    });

    expect((await download(clean.id)).statusCode).toBe(200);

    const audited = await api.db
      .select()
      .from(outbox)
      .where(eq(outbox.eventType, 'audit.read.v1'))
      // Latest last: a select without an order returns rows in any order.
      .orderBy(asc(outbox.createdAt), asc(outbox.id));
    expect(audited.at(-1)?.envelope).toMatchObject({
      source: 'adili/documents',
      // The tenant the service acted for, whose document it read.
      tenant: 'psc',
      data: {
        action: 'upload.download.issued',
        resource: { type: 'upload', params: { id: clean.id } },
        outcome: 'success',
      },
    });
  });

  it('returns a 5-minute presigned GET of the clean bytes to a service acting for the tenant', async () => {
    const before = Date.now();
    const response = await download(clean.id);

    expect(response.statusCode).toBe(200);
    const body = response.json<UploadDownload>();
    expect(contractErrors(okResponse('/internal/v1/uploads/{id}/download', 'get'), body)).toEqual(
      [],
    );
    expect(body).toMatchObject({
      id: clean.id,
      purpose: 'roster-import',
      state: 'clean',
      sha256: sha256(bytes),
      size: bytes.length,
      fileName: 'Roster 2026.csv',
      detectedType: CSV,
    });
    const expiresIn = Date.parse(body.expiresAt) - before;
    expect(expiresIn).toBeGreaterThan(4 * 60 * 1000);
    expect(expiresIn).toBeLessThanOrEqual(5 * 60 * 1000 + 1000);
    expect(new URL(body.downloadUrl).searchParams.get('X-Amz-Expires')).toBe('300');

    const fetched = await fetch(body.downloadUrl);
    expect(fetched.status).toBe(200);
    expect(Buffer.from(await fetched.arrayBuffer())).toEqual(bytes);
  });

  it("answers 404 for another tenant's upload", async () => {
    expect((await download(clean.id, 'tsc')).statusCode).toBe(404);
  });

  it('answers 409 for an upload that is not clean', async () => {
    const pending = await reserve(bytes);

    const response = await download(pending.id);

    expect(response.statusCode).toBe(409);
    expect(response.json<Problem>().type).toBe('upload-not-clean');
  });

  it('refuses tokens without the documents:internal scope, even with the header', async () => {
    expect((await download(clean.id, 'psc', OFFICER)).statusCode).toBe(403);
    expect((await download(clean.id, 'psc', { ...DIRECTORY, scope: 'messages' })).statusCode).toBe(
      403,
    );
  });

  it.each([
    ['a missing header', null],
    ['the platform context', 'platform'],
    ['a malformed tenant', 'PSC; drop'],
  ])('answers 400 to %s', async (_, tenant) => {
    const response = await download(clean.id, tenant);

    expect(response.statusCode).toBe(400);
    expect(contractErrors(componentSchema('ProblemDetails'), response.json())).toEqual([]);
  });
});

describe('internal link marker (spec 05)', () => {
  let clean: UploadReservation;

  beforeAll(async () => {
    clean = await upload(fixture('roster.csv'));
    await complete(clean.id);
  });

  const link = (id: string, tenant = 'psc', caller: Caller = DIRECTORY) =>
    api.post(`/internal/v1/uploads/${id}/linked`, undefined, caller, {
      headers: { 'x-acting-tenant': tenant },
    });

  it('records when the owning service linked a clean upload, keeping the first time on a repeat', async () => {
    expect((await row(clean.id)).linkedAt).toBeNull();

    const first = await link(clean.id);

    expect(first.statusCode).toBe(204);
    const linkedAt = (await row(clean.id)).linkedAt;
    expect(linkedAt).toBeInstanceOf(Date);

    expect((await link(clean.id)).statusCode).toBe(204);
    expect((await row(clean.id)).linkedAt).toEqual(linkedAt);
  });

  it("answers 404 for another tenant's upload and an unknown one", async () => {
    expect((await link(clean.id, 'tsc')).statusCode).toBe(404);
    expect((await link(randomUUID())).statusCode).toBe(404);
  });

  it('answers 409 upload-not-clean for an upload that is not clean, and records nothing', async () => {
    const pending = await reserve(fixture('roster.csv'));

    const response = await link(pending.id);

    expect(response.statusCode).toBe(409);
    expect(response.json<Problem>().type).toBe('upload-not-clean');
    expect((await row(pending.id)).linkedAt).toBeNull();
  });

  it('refuses tokens without the documents:internal scope', async () => {
    expect((await link(clean.id, 'psc', OFFICER)).statusCode).toBe(403);
  });

  it('is in the implemented contract, not a draft', () => {
    expect(contractOperation('/internal/v1/uploads/{id}/linked', 'post')).not.toHaveProperty(
      'x-draft',
    );
  });
});

describe('expiry sweep', () => {
  const expire = (id: string) =>
    withTenant(api.db, { tenant: 'platform', subject: 'test' }, (tx) =>
      tx
        .update(uploads)
        .set({ expiresAt: sql`now() - interval '1 second'` })
        .where(eq(uploads.id, id)),
    );

  it('expires stale uploads and deletes the objects they left in quarantine', async () => {
    const stale = await upload(fixture('roster.csv'));
    const fresh = await reserve(fixture('roster.csv'));
    await expire(stale.id);

    const count = await api.app.get(UploadsService).expireStale();

    expect(count).toBeGreaterThanOrEqual(1);
    expect((await api.get(`/v1/uploads/${stale.id}`, OFFICER)).json()).toMatchObject({
      state: 'expired',
    });
    expect((await row(fresh.id)).state).toBe('awaiting-upload');
    expect(await objectStatus('quarantine', `roster-import/${stale.id}`)).toBe(404);

    const late = await complete(stale.id);
    expect(late.statusCode).toBe(409);
    expect(late.json<Problem>().type).toBe('upload-expired');
    expect(await api.app.get(UploadsService).expireStale()).toBe(0);
  });

  it('leaves an upload alone while a completion runs', async () => {
    const running = await upload(fixture('roster.csv'));
    await expire(running.id);
    await withTenant(api.db, { tenant: 'platform', subject: 'test' }, (tx) =>
      tx
        .update(uploads)
        .set({ completionStartedAt: sql`now()` })
        .where(eq(uploads.id, running.id)),
    );

    await api.app.get(UploadsService).expireStale();

    expect((await row(running.id)).state).toBe('awaiting-upload');
  });
});
