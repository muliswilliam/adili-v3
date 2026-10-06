import { describe, expect, it, vi } from 'vitest';

import { putFile, wholePercents } from './put-file';

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

const blob = new Blob(['bytes']);

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

describe('wholePercents', () => {
  it('reports each whole percent once, rounded down', () => {
    const onPercent = vi.fn();
    const onProgress = wholePercents(onPercent);
    onProgress(1, 3);
    onProgress(1, 3);
    onProgress(2, 3);
    onProgress(299, 300);
    onProgress(3, 3);
    expect(onPercent.mock.calls).toEqual([[33], [66], [99], [100]]);
  });

  it('reports 0 while the total is unknown', () => {
    const onPercent = vi.fn();
    wholePercents(onPercent)(0, 0);
    expect(onPercent).toHaveBeenCalledWith(0);
  });
});
