import { describe, expect, it, vi } from 'vitest';

import type { Upload } from '../../server/documents/client';
import { outcomeOf, putFile, type UploadDeps, uploadRosterFile } from './upload';

/** A stand-in XMLHttpRequest the test drives by hand. */
class FakeXhr {
  status = 0;
  method = '';
  url = '';
  headers: Record<string, string> = {};
  body: unknown = null;
  aborted = false;
  upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send(body: unknown) {
    this.body = body;
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
  progress(loaded: number, total: number) {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total } as ProgressEvent);
  }
  respond(status: number) {
    this.status = status;
    this.onload?.();
  }
}

function fakeXhr() {
  const xhr = new FakeXhr();
  return { xhr, createXhr: () => xhr as unknown as XMLHttpRequest };
}

const blob = new Blob(['personnel_file_number,full_name,national_id\n']);

describe('putFile', () => {
  it('PUTs the bytes with the signed content type and reports progress', async () => {
    const { xhr, createXhr } = fakeXhr();
    const onProgress = vi.fn();
    const result = putFile('https://s3.test/quarantine/key?sig', blob, 'text/csv', {
      createXhr,
      onProgress,
    });

    expect(xhr.method).toBe('PUT');
    expect(xhr.url).toBe('https://s3.test/quarantine/key?sig');
    expect(xhr.headers['Content-Type']).toBe('text/csv');
    expect(xhr.body).toBe(blob);
    xhr.progress(50, 100);
    expect(onProgress).toHaveBeenCalledWith(50, 100);
    xhr.respond(200);
    await expect(result).resolves.toBe('ok');
  });

  it('fails on a refused PUT, such as an expired signature', async () => {
    const { xhr, createXhr } = fakeXhr();
    const result = putFile('https://s3.test/x', blob, 'text/csv', { createXhr });
    xhr.respond(403);
    await expect(result).resolves.toBe('failed');
  });

  it('fails on a network error or timeout', async () => {
    const first = fakeXhr();
    const errored = putFile('https://s3.test/x', blob, 'text/csv', { createXhr: first.createXhr });
    first.xhr.onerror?.();
    await expect(errored).resolves.toBe('failed');

    const second = fakeXhr();
    const timedOut = putFile('https://s3.test/x', blob, 'text/csv', {
      createXhr: second.createXhr,
    });
    second.xhr.ontimeout?.();
    await expect(timedOut).resolves.toBe('failed');
  });

  it('aborts the request when the signal aborts', async () => {
    const { xhr, createXhr } = fakeXhr();
    const controller = new AbortController();
    const result = putFile('https://s3.test/x', blob, 'text/csv', {
      createXhr,
      signal: controller.signal,
    });
    controller.abort();
    expect(xhr.aborted).toBe(true);
    await expect(result).resolves.toBe('aborted');
  });

  it('sends nothing when already aborted', async () => {
    const createXhr = vi.fn();
    const controller = new AbortController();
    controller.abort();
    await expect(
      putFile('https://s3.test/x', blob, 'text/csv', { createXhr, signal: controller.signal }),
    ).resolves.toBe('aborted');
    expect(createXhr).not.toHaveBeenCalled();
  });
});

const uploadId = '0199a0b4-0000-7000-8000-000000000001';

function upload(overrides: Partial<Upload>): Upload {
  return {
    id: uploadId,
    purpose: 'roster-import',
    state: 'clean',
    rejection: null,
    contentType: 'text/csv',
    detectedType: 'text/csv',
    declaredSize: 44,
    size: 44,
    sha256: 'ab'.repeat(32),
    fileName: 'roster.csv',
    createdAt: '2026-09-28T08:00:00Z',
    completedAt: '2026-09-28T08:00:03Z',
    ...overrides,
  };
}

const rosterFile = new File([blob], 'roster.csv');

function deps(overrides: Partial<UploadDeps> = {}): UploadDeps {
  return {
    createUpload: vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        data: {
          id: uploadId,
          uploadUrl: 'https://s3.test/quarantine/key?sig',
          expiresAt: '2026-09-28T08:15:00Z',
          maxSize: 52_428_800,
        },
      }),
    ),
    putFile: vi.fn<UploadDeps['putFile']>((_url, _body, _type, options) => {
      options?.onProgress?.(22, 44);
      options?.onProgress?.(44, 44);
      return Promise.resolve('ok' as const);
    }),
    completeUpload: vi.fn(() => Promise.resolve({ ok: true as const, data: upload({}) })),
    newKey: (() => {
      let keys = 0;
      return () => `key-${String((keys += 1))}`;
    })(),
    ...overrides,
  };
}

describe('uploadRosterFile', () => {
  it('reserves, PUTs and completes a file, reporting each stage', async () => {
    const d = deps();
    const events: string[] = [];
    const outcome = await uploadRosterFile(rosterFile, d, {
      onUploading: () => events.push('uploading'),
      onProgress: (percent) => events.push(`${String(percent)}%`),
      onScanning: () => events.push('scanning'),
    });

    // Each request has an Idempotency-Key of its own.
    expect(d.createUpload).toHaveBeenCalledWith(
      { contentType: 'text/csv', declaredSize: rosterFile.size, fileName: 'roster.csv' },
      'key-1',
    );
    expect(d.putFile).toHaveBeenCalledWith(
      'https://s3.test/quarantine/key?sig',
      rosterFile,
      'text/csv',
      expect.anything(),
    );
    expect(d.completeUpload).toHaveBeenCalledWith(uploadId, 'key-2');
    expect(events).toEqual(['uploading', '50%', '100%', 'scanning']);
    expect(outcome).toEqual({
      kind: 'clean',
      upload: { id: uploadId, fileName: 'roster.csv', size: 44 },
    });
  });

  it('sends an XLSX file with the spreadsheet content type', async () => {
    const d = deps();
    await uploadRosterFile(new File([blob], 'Roster.XLSX'), d);
    expect(d.createUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      expect.any(String),
    );
  });

  it('makes no request for a file that is not CSV or XLSX', async () => {
    const d = deps();
    await expect(uploadRosterFile(new File([blob], 'photo.png'), d)).resolves.toEqual({
      kind: 'rejected',
      reason: 'type',
    });
    expect(d.createUpload).not.toHaveBeenCalled();
  });

  it('makes no request for an empty file, and refuses it for good (#713)', async () => {
    const d = deps();
    await expect(uploadRosterFile(new File([], 'roster.csv'), d)).resolves.toEqual({
      kind: 'rejected',
      reason: 'empty',
    });
    expect(d.createUpload).not.toHaveBeenCalled();
  });

  it('fails when the reservation is refused or unreachable', async () => {
    const refused = deps({
      createUpload: () =>
        Promise.resolve({
          ok: false,
          error: {
            kind: 'problem',
            problem: { type: 'about:blank', title: 'Forbidden', status: 403 },
          },
        }),
    });
    await expect(uploadRosterFile(rosterFile, refused)).resolves.toEqual({ kind: 'failed' });
    expect(refused.putFile).not.toHaveBeenCalled();

    const thrown = deps({ createUpload: () => Promise.reject(new Error('network')) });
    await expect(uploadRosterFile(rosterFile, thrown)).resolves.toEqual({ kind: 'failed' });
  });

  it('asks to sign in again when the session has ended', async () => {
    const d = deps({
      completeUpload: () => Promise.resolve({ ok: false, error: { kind: 'unauthenticated' } }),
    });
    await expect(uploadRosterFile(rosterFile, d)).resolves.toEqual({ kind: 'unauthenticated' });
  });

  it('fails without completing when the PUT fails', async () => {
    const d = deps({ putFile: () => Promise.resolve('failed' as const) });
    await expect(uploadRosterFile(rosterFile, d)).resolves.toEqual({ kind: 'failed' });
    expect(d.completeUpload).not.toHaveBeenCalled();
  });

  it('stops when aborted during the PUT', async () => {
    const controller = new AbortController();
    const d = deps({
      putFile: () => {
        controller.abort();
        return Promise.resolve('aborted' as const);
      },
    });
    await expect(uploadRosterFile(rosterFile, d, { signal: controller.signal })).resolves.toEqual({
      kind: 'aborted',
    });
    expect(d.completeUpload).not.toHaveBeenCalled();
  });

  it('ignores a completion that returns after an abort', async () => {
    const controller = new AbortController();
    const d = deps({
      completeUpload: () => {
        controller.abort();
        return Promise.resolve({ ok: true as const, data: upload({}) });
      },
    });
    await expect(uploadRosterFile(rosterFile, d, { signal: controller.signal })).resolves.toEqual({
      kind: 'aborted',
    });
  });

  it('fails when the completion times out or the service is down', async () => {
    const d = deps({
      completeUpload: () =>
        Promise.resolve({ ok: false, error: { kind: 'unavailable', detail: null } }),
    });
    await expect(uploadRosterFile(rosterFile, d)).resolves.toEqual({ kind: 'failed' });
  });
});

describe('outcomeOf', () => {
  it.each([
    [upload({ state: 'infected', rejection: null }), { kind: 'infected' }],
    [upload({ state: 'rejected', rejection: 'type' }), { kind: 'rejected', reason: 'type' }],
    [upload({ state: 'rejected', rejection: 'size' }), { kind: 'rejected', reason: 'size' }],
    [
      upload({ state: 'rejected', rejection: 'encoding' }),
      { kind: 'rejected', reason: 'encoding' },
    ],
    [upload({ state: 'rejected', rejection: 'missing' }), { kind: 'failed' }],
    [upload({ state: 'rejected', rejection: 'timeout' }), { kind: 'failed' }],
    [upload({ state: 'expired' }), { kind: 'failed' }],
    [upload({ state: 'awaiting-upload' }), { kind: 'failed' }],
  ])('maps %o', (completed, expected) => {
    expect(outcomeOf(completed, rosterFile)).toEqual(expected);
  });

  it('falls back to the chosen file for a missing name or size', () => {
    expect(outcomeOf(upload({ fileName: null, size: null }), rosterFile)).toEqual({
      kind: 'clean',
      upload: { id: uploadId, fileName: 'roster.csv', size: rosterFile.size },
    });
  });
});
