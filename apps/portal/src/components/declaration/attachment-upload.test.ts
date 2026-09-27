import { describe, expect, it, vi } from 'vitest';

import type { UploadCheck } from '../../server/documents/uploads.server';
import { SCAN_POLL_LIMIT, uploadAttachment, type UploadSteps } from './attachment-upload';
import type { UploadsEvent } from './attachments';

const UPLOAD_ID = '6f1d0c9e-0000-4000-8000-000000000001';
const file = new File(['%PDF-1.7'], 'deed.pdf', { type: 'application/pdf' });

function steps(overrides: Partial<UploadSteps> = {}): UploadSteps {
  return {
    reserve: vi.fn(() =>
      Promise.resolve({
        status: 'reserved' as const,
        reservation: {
          id: UPLOAD_ID,
          uploadUrl: `/api/mock-uploads/${UPLOAD_ID}`,
          expiresAt: '2027-01-01T00:00:00Z',
          maxSize: 20 * 1024 * 1024,
        },
      }),
    ),
    put: vi.fn((_url: string, _file: File, _type: string, onProgress: (p: number) => void) => {
      onProgress(50);
      onProgress(100);
      return Promise.resolve();
    }),
    complete: vi.fn(() =>
      Promise.resolve<UploadCheck>({ status: 'clean', sha256: 'a'.repeat(64), size: 8 }),
    ),
    check: vi.fn(() => Promise.resolve<UploadCheck>({ status: 'scanning' })),
    link: vi.fn(() =>
      Promise.resolve({ status: 'linked' as const, attachmentId: 'attachment-1', size: 8 }),
    ),
    wait: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

async function run(given: UploadSteps) {
  const events: UploadsEvent[] = [];
  await uploadAttachment('row-1', file, given, (event) => events.push(event));
  return events;
}

describe('uploadAttachment', () => {
  it('reserves, PUTs with progress, scans and links a clean file', async () => {
    const given = steps();
    expect(await run(given)).toEqual([
      { type: 'progress', id: 'row-1', percent: 50 },
      { type: 'progress', id: 'row-1', percent: 100 },
      { type: 'scanning', id: 'row-1' },
      {
        type: 'linked',
        id: 'row-1',
        uploadId: UPLOAD_ID,
        attachmentId: 'attachment-1',
        size: 8,
      },
    ]);
    expect(given.reserve).toHaveBeenCalledWith({
      contentType: 'application/pdf',
      size: file.size,
      fileName: 'deed.pdf',
    });
    expect(given.put).toHaveBeenCalledWith(
      `/api/mock-uploads/${UPLOAD_ID}`,
      file,
      'application/pdf',
      expect.any(Function),
    );
    expect(given.link).toHaveBeenCalledWith(UPLOAD_ID);
  });

  it('ends infected when the scan finds a virus, without linking', async () => {
    const given = steps({ complete: () => Promise.resolve({ status: 'infected' }) });
    expect((await run(given)).at(-1)).toEqual({
      type: 'finished',
      id: 'row-1',
      outcome: 'infected',
    });
    expect(given.link).not.toHaveBeenCalled();
  });

  it.each([
    ['type', 'rejected-type'],
    ['size', 'rejected-size'],
  ] as const)('ends rejected when the service refuses the %s', async (reason, outcome) => {
    const given = steps({ reserve: () => Promise.resolve({ status: 'rejected', reason }) });
    expect(await run(given)).toEqual([{ type: 'finished', id: 'row-1', outcome }]);
    expect(given.put).not.toHaveBeenCalled();
  });

  it('ends rejected when the scan finds the wrong type', async () => {
    const given = steps({
      complete: () => Promise.resolve({ status: 'rejected', reason: 'type' }),
    });
    expect((await run(given)).at(-1)).toMatchObject({ outcome: 'rejected-type' });
  });

  it.each([
    ['reserving is unavailable', { reserve: () => Promise.resolve({ status: 'unavailable' }) }],
    ['the session expired', { reserve: () => Promise.resolve({ status: 'unauthenticated' }) }],
    ['the PUT drops', { put: () => Promise.reject(new Error('network')) }],
    ['the upload expired', { complete: () => Promise.resolve({ status: 'expired' }) }],
    [
      'the bytes never arrived',
      { complete: () => Promise.resolve({ status: 'rejected', reason: 'missing' }) },
    ],
    ['linking is refused', { link: () => Promise.resolve({ status: 'failed' }) }],
  ] as [string, Partial<UploadSteps>][])('fails when %s', async (_case, overrides) => {
    expect((await run(steps(overrides))).at(-1)).toEqual({
      type: 'finished',
      id: 'row-1',
      outcome: 'failed',
    });
  });

  it('polls while the scan has not finished', async () => {
    const check = vi
      .fn<UploadSteps['check']>()
      .mockResolvedValueOnce({ status: 'scanning' })
      .mockResolvedValue({ status: 'clean', sha256: 'a'.repeat(64), size: 8 });
    const given = steps({ complete: () => Promise.resolve({ status: 'scanning' }), check });
    expect((await run(given)).at(-1)).toMatchObject({ type: 'linked' });
    expect(check).toHaveBeenCalledTimes(2);
    expect(given.wait).toHaveBeenCalledTimes(2);
  });

  it('gives up when the scan never finishes', async () => {
    const given = steps({ complete: () => Promise.resolve({ status: 'scanning' }) });
    expect((await run(given)).at(-1)).toMatchObject({ outcome: 'failed' });
    expect(given.check).toHaveBeenCalledTimes(SCAN_POLL_LIMIT);
  });

  it('declares HEIC photos the browser gives no type', async () => {
    const given = steps();
    const photo = new File(['x'], 'IMG_0001.HEIC', { type: '' });
    await uploadAttachment('row-1', photo, given, () => undefined);
    expect(given.reserve).toHaveBeenCalledWith(
      expect.objectContaining({ contentType: 'image/heic' }),
    );
  });
});
