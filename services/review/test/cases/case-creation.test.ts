import { describe, expect, it, vi } from 'vitest';

import { addMonths } from '../../src/cases/case-creation.js';
import { HttpDirectoryClient } from '../../src/directory/http-directory-client.js';

describe('the clarification window', () => {
  it('ends the given number of calendar months after receipt', () => {
    expect(addMonths(new Date('2027-12-15T09:30:00Z'), 6).toISOString()).toBe(
      '2028-06-15T09:30:00.000Z',
    );
  });

  it('ends on the last day of a shorter month', () => {
    expect(addMonths(new Date('2027-08-31T10:00:00Z'), 6).toISOString()).toBe(
      '2028-02-29T10:00:00.000Z',
    );
  });
});

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
    expect((fetch.mock.calls[0]?.[0] as URL).href).toBe(
      'http://directory.test/internal/v1/commissions/psc/policy',
    );

    now = 1_001;
    await directory.getClarificationPolicy('psc');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
