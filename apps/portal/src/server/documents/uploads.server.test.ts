import createClient from 'openapi-fetch';
import { beforeEach, describe, expect, it } from 'vitest';

import { mockDocumentsFetch, receiveMockUpload, resetDocumentsMock } from './mock.server';
import type { paths } from './schema.gen';
import { checkUpload, completeUpload, reserveAttachmentUpload } from './uploads.server';

function client(send: (request: Request) => Promise<Response> = mockDocumentsFetch) {
  return createClient<paths>({ baseUrl: 'http://documents.test', fetch: send });
}

const pdf = { contentType: 'application/pdf', size: 2048, fileName: 'deed.pdf' };

async function reserved(file = pdf) {
  const result = await reserveAttachmentUpload(client(), file);
  if (result.status !== 'reserved') throw new Error(result.status);
  return result.reservation;
}

beforeEach(() => {
  resetDocumentsMock();
});

describe('reserveAttachmentUpload', () => {
  it('reserves a declaration attachment and returns where to PUT it', async () => {
    const reservation = await reserved();
    expect(reservation.uploadUrl).toBe(`/api/mock-uploads/${reservation.id}`);
    expect(reservation.maxSize).toBe(20 * 1024 * 1024);
  });

  it('reports a type or size the service refuses', async () => {
    expect(
      await reserveAttachmentUpload(client(), { ...pdf, contentType: 'application/msword' }),
    ).toEqual({ status: 'rejected', reason: 'type' });
    expect(await reserveAttachmentUpload(client(), { ...pdf, size: 21 * 1024 * 1024 })).toEqual({
      status: 'rejected',
      reason: 'size',
    });
  });

  it('is unavailable when the service is down', async () => {
    const down = client(() => Promise.reject(new Error('offline')));
    expect(await reserveAttachmentUpload(down, pdf)).toEqual({ status: 'unavailable' });
  });

  it('reserves a clarification attachment under the same limits', async () => {
    const result = await reserveAttachmentUpload(client(), pdf, 'clarification-attachment');
    if (result.status !== 'reserved') throw new Error(result.status);
    const upload = await client().GET('/v1/uploads/{id}', {
      params: { path: { id: result.reservation.id } },
    });
    expect(upload.data?.purpose).toBe('clarification-attachment');
    expect(
      await reserveAttachmentUpload(
        client(),
        { ...pdf, size: 21 * 1024 * 1024 },
        'clarification-attachment',
      ),
    ).toEqual({ status: 'rejected', reason: 'size' });
  });
});

describe('completeUpload', () => {
  it('is clean with its digest and size once scanned', async () => {
    const { id } = await reserved();
    receiveMockUpload(id, 1900);
    expect(await completeUpload(client(), id)).toEqual({
      status: 'clean',
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/) as unknown,
      size: 1900,
    });
  });

  it('is infected when the scan finds a virus', async () => {
    const { id } = await reserved({ ...pdf, fileName: 'virus-deed.pdf' });
    receiveMockUpload(id, 2048);
    expect(await completeUpload(client(), id)).toEqual({ status: 'infected' });
  });

  it('reports the final state when it was already completed', async () => {
    const { id } = await reserved();
    receiveMockUpload(id, 2048);
    await completeUpload(client(), id);
    expect(await completeUpload(client(), id)).toMatchObject({ status: 'clean' });
  });

  it('is not found for an unknown upload', async () => {
    expect(await completeUpload(client(), crypto.randomUUID())).toEqual({ status: 'not-found' });
  });
});

describe('checkUpload', () => {
  it('is scanning until the upload reaches a final state', async () => {
    const { id } = await reserved();
    expect(await checkUpload(client(), id)).toEqual({ status: 'scanning' });
  });

  it.each([
    ['rejected', 'type', { status: 'rejected', reason: 'type' }],
    ['rejected', 'size', { status: 'rejected', reason: 'size' }],
    ['rejected', 'missing', { status: 'rejected', reason: 'missing' }],
    ['expired', null, { status: 'expired' }],
    ['deleted', null, { status: 'expired' }],
  ] as const)('maps %s (%s)', async (state, rejection, expected) => {
    const { id } = await reserved();
    const send = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            id,
            purpose: 'declaration-attachment',
            state,
            rejection,
            contentType: 'application/pdf',
            declaredSize: 2048,
            fileName: 'deed.pdf',
            createdAt: new Date().toISOString(),
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    expect(await checkUpload(client(send), id)).toEqual(expected);
  });
});

describe('receiveMockUpload (the mock presigned PUT)', () => {
  it('drops a file named with "fail", as a lost connection would', async () => {
    const { id } = await reserved({ ...pdf, fileName: 'fail-deed.pdf' });
    expect(receiveMockUpload(id, 2048).status).toBe(500);
  });

  it('refuses a PUT for an unknown or completed upload', async () => {
    expect(receiveMockUpload(crypto.randomUUID(), 1).status).toBe(404);
    const { id } = await reserved();
    expect(receiveMockUpload(id, 2048).status).toBe(200);
    await completeUpload(client(), id);
    expect(receiveMockUpload(id, 2048).status).toBe(404);
  });
});
