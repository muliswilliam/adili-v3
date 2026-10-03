import { describe, expect, it, vi } from 'vitest';

import { publicCache } from './public-cache';

const URL_A = 'http://reporting.test/open-data/v1/releases';

function upstream() {
  let body = '["v1"]';
  let etag = '"a"';
  const send = vi.fn((request: Request) => {
    if (request.headers.get('if-none-match') === etag) {
      return Promise.resolve(new Response(null, { status: 304, headers: { etag } }));
    }
    return Promise.resolve(
      new Response(body, {
        status: 200,
        headers: { etag, 'cache-control': 'public, max-age=3600', 'content-type': 'text/plain' },
      }),
    );
  });
  return {
    send,
    change(next: string, tag: string) {
      body = next;
      etag = tag;
    },
  };
}

describe('public open-data cache', () => {
  it('answers a repeat GET from memory while the copy is fresh (max-age)', async () => {
    let now = 0;
    const api = upstream();
    const cached = publicCache(api.send, { now: () => now });

    const first = await cached(new Request(URL_A), {});
    now = 3_599_000;
    const second = await cached(new Request(URL_A), {});

    expect(await first.text()).toBe('["v1"]');
    expect(await second.text()).toBe('["v1"]');
    expect(second.headers.get('etag')).toBe('"a"');
    expect(api.send).toHaveBeenCalledTimes(1);
  });

  it('revalidates a stale copy with If-None-Match and keeps it on 304', async () => {
    let now = 0;
    const api = upstream();
    const cached = publicCache(api.send, { now: () => now });

    await cached(new Request(URL_A), {});
    now = 3_601_000;
    const revalidated = await cached(new Request(URL_A), {});
    const fresh = await cached(new Request(URL_A), {});

    expect(revalidated.status).toBe(200);
    expect(await revalidated.text()).toBe('["v1"]');
    expect(await fresh.text()).toBe('["v1"]');
    expect(api.send).toHaveBeenCalledTimes(2);
    expect(api.send.mock.calls[1]?.[0].headers.get('if-none-match')).toBe('"a"');
  });

  it('takes the new body when the stale copy has changed', async () => {
    let now = 0;
    const api = upstream();
    const cached = publicCache(api.send, { now: () => now });

    await cached(new Request(URL_A), {});
    api.change('["v1","v2"]', '"b"');
    now = 3_601_000;

    expect(await (await cached(new Request(URL_A), {})).text()).toBe('["v1","v2"]');
  });

  it('keeps formats apart: the same URL asked for JSON and for CSV', async () => {
    const send = vi.fn((request: Request) =>
      Promise.resolve(
        new Response(request.headers.get('accept') ?? '', {
          headers: { etag: '"x"', 'cache-control': 'public, max-age=3600' },
        }),
      ),
    );
    const cached = publicCache(send, { now: () => 0 });

    const json = new Request(URL_A, { headers: { accept: 'application/json' } });
    const csv = new Request(URL_A, { headers: { accept: 'text/csv' } });

    expect(await (await cached(json, {})).text()).toBe('application/json');
    expect(await (await cached(csv, {})).text()).toBe('text/csv');
  });

  it('never keeps an error or a 429, so the next request asks again', async () => {
    const send = vi.fn(() =>
      Promise.resolve(new Response('{}', { status: 429, headers: { 'retry-after': '30' } })),
    );
    const cached = publicCache(send, { now: () => 0 });

    expect((await cached(new Request(URL_A), {})).status).toBe(429);
    expect((await cached(new Request(URL_A), {})).status).toBe(429);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('serves the stale copy when revalidating meets a 429 or the service down', async () => {
    let now = 0;
    let answer = 200;
    const send = vi.fn(() =>
      Promise.resolve(
        answer === 200
          ? new Response('["v1"]', {
              headers: { etag: '"a"', 'cache-control': 'public, max-age=3600' },
            })
          : new Response('{}', { status: answer }),
      ),
    );
    const cached = publicCache(send, { now: () => now });

    await cached(new Request(URL_A), {});
    now = 3_601_000;
    answer = 429;
    const limited = await cached(new Request(URL_A), {});
    answer = 503;
    const down = await cached(new Request(URL_A), {});

    expect([limited.status, await limited.text()]).toEqual([200, '["v1"]']);
    expect([down.status, await down.text()]).toEqual([200, '["v1"]']);
    // Still stale, so each request asks again rather than trusting the old copy for an hour.
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('asks once for concurrent misses of the same copy, and shares the answer', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const send = vi.fn(async () => {
      await gate;
      return new Response('["v1"]', {
        headers: { etag: '"a"', 'cache-control': 'public, max-age=3600' },
      });
    });
    const cached = publicCache(send, { now: () => 0 });

    const visitors = Array.from({ length: 8 }, () => cached(new Request(URL_A), {}));
    release();
    const answers = await Promise.all(visitors);

    expect(send).toHaveBeenCalledTimes(1);
    expect(await Promise.all(answers.map((answer) => answer.text()))).toEqual(
      Array.from({ length: 8 }, () => '["v1"]'),
    );
  });

  it('revalidates a stale copy once for concurrent requests', async () => {
    let now = 0;
    const api = upstream();
    const cached = publicCache(api.send, { now: () => now });

    await cached(new Request(URL_A), {});
    now = 3_601_000;
    const answers = await Promise.all(
      Array.from({ length: 5 }, () => cached(new Request(URL_A), {})),
    );

    expect(api.send).toHaveBeenCalledTimes(2);
    expect(answers.map((answer) => answer.status)).toEqual([200, 200, 200, 200, 200]);
  });

  it('shares a failed miss with every waiter, then asks again', async () => {
    const send = vi.fn(() => Promise.reject(new Error('down')));
    const cached = publicCache(send, { now: () => 0 });

    const answers = await Promise.allSettled([
      cached(new Request(URL_A), {}),
      cached(new Request(URL_A), {}),
    ]);
    await cached(new Request(URL_A), {}).catch(() => undefined);

    expect(answers.map((answer) => answer.status)).toEqual(['rejected', 'rejected']);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('keeps a copy no longer than the cap for its URL, e.g. the list of releases', async () => {
    let now = 0;
    const api = upstream();
    const cached = publicCache(api.send, {
      now: () => now,
      maxAgeCapMs: (url) => (url.endsWith('/releases') ? 60_000 : undefined),
    });

    await cached(new Request(URL_A), {});
    now = 61_000;
    await cached(new Request(URL_A), {});

    expect(api.send).toHaveBeenCalledTimes(2);
  });

  it('forgets the oldest copies beyond its size', async () => {
    const api = upstream();
    const cached = publicCache(api.send, { now: () => 0, maxEntries: 2 });

    await cached(new Request(`${URL_A}?n=1`), {});
    await cached(new Request(`${URL_A}?n=2`), {});
    await cached(new Request(`${URL_A}?n=3`), {});
    await cached(new Request(`${URL_A}?n=1`), {});

    expect(api.send).toHaveBeenCalledTimes(4);
  });
});
