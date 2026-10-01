import { describe, expect, it, vi } from 'vitest';

import { DirectoryUnavailable } from '../../src/directory/directory-client.js';
import { HttpDirectoryClient } from '../../src/directory/http-directory-client.js';

describe('HttpDirectoryClient', () => {
  it("reads a Commission's clarification periods once, then from its cache until it expires", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(
        Response.json({ clarification: { issueWindowMonths: 6, replyWindowDays: 30 } }),
      ),
    );
    let now = 0;
    const directory = new HttpDirectoryClient({
      directoryUrl: 'http://directory.test',
      tokens: { token: () => Promise.resolve('token'), invalidate: vi.fn() },
      fetch,
      cacheTtlMs: 1_000,
      now: () => now,
    });

    expect(await directory.getClarificationPolicy('psc')).toEqual({
      issueWindowMonths: 6,
      replyWindowDays: 30,
    });
    await directory.getClarificationPolicy('psc');
    expect(fetch).toHaveBeenCalledOnce();
    expect((fetch.mock.calls[0]?.[0] as Request).url).toBe(
      'http://directory.test/internal/v1/commissions/psc/policy',
    );

    now = 1_001;
    await directory.getClarificationPolicy('psc');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('reads a Commission once, then from its cache until it expires', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(
        Response.json({ slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission' }),
      ),
    );
    let now = 0;
    const directory = new HttpDirectoryClient({
      directoryUrl: 'http://directory.test',
      tokens: { token: () => Promise.resolve('token'), invalidate: vi.fn() },
      fetch,
      cacheTtlMs: 1_000,
      now: () => now,
    });

    expect(await directory.getCommission('psc')).toEqual({
      slug: 'psc',
      issuerCode: 'PSC',
      name: 'Public Service Commission',
    });
    await directory.getCommission('psc');
    expect(fetch).toHaveBeenCalledOnce();
    expect((fetch.mock.calls[0]?.[0] as Request).url).toBe(
      'http://directory.test/internal/v1/commissions/psc',
    );

    now = 1_001;
    await directory.getCommission('psc');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('treats a Commission the directory does not know as the directory being unavailable', async () => {
    const directory = new HttpDirectoryClient({
      directoryUrl: 'http://directory.test',
      tokens: { token: () => Promise.resolve('token'), invalidate: vi.fn() },
      fetch: () => Promise.resolve(new Response(null, { status: 404 })),
      cacheTtlMs: 1_000,
      now: () => 0,
    });

    await expect(directory.getCommission('nowhere')).rejects.toThrow(DirectoryUnavailable);
  });
});
