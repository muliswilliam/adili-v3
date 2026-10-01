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

  it("reads the Commission's ladder windows from its policy, each defaulting to spec 08's", async () => {
    const policies = [
      { clarification: { issueWindowMonths: 6, replyWindowDays: 30 } },
      {
        clarification: { issueWindowMonths: 6, replyWindowDays: 30 },
        ladder: { noticeWindowDays: 21, stoppageWindowDays: 45 },
      },
    ];
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(Response.json(policies.shift())),
    );
    const directory = new HttpDirectoryClient({
      directoryUrl: 'http://directory.test',
      tokens: { token: () => Promise.resolve('token'), invalidate: vi.fn() },
      fetch,
      cacheTtlMs: 0,
      now: () => 0,
    });

    expect(await directory.getLadderPolicy('psc')).toEqual({
      noticeWindowDays: 14,
      warningWindowDays: 14,
      stoppageWindowDays: 30,
    });
    expect(await directory.getLadderPolicy('psc')).toEqual({
      noticeWindowDays: 21,
      warningWindowDays: 14,
      stoppageWindowDays: 45,
    });
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
  it("reads a roster record's payroll facts each time, uncached; the employer code when the record has one", async () => {
    const record = {
      id: '0199b000-0000-7000-8000-0000000000f1',
      personnelFileNumber: 'PSC/2019/0077',
      fullName: 'Grace Wanjiru',
      nationalId: '27451863',
      reportingEntity: { id: '0199b000-0000-7000-8000-0000000000f2', name: 'State Department' },
      tenant: 'psc',
    };
    const answers = [record, { ...record, employerCode: 'MOH', reportingEntity: null }];
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(Response.json(answers.shift())),
    );
    const directory = new HttpDirectoryClient({
      directoryUrl: 'http://directory.test',
      tokens: { token: () => Promise.resolve('token'), invalidate: vi.fn() },
      fetch,
      now: () => 0,
    });

    expect(await directory.getRosterRecord('psc', record.id)).toEqual({
      personalNumber: 'PSC/2019/0077',
      nationalId: '27451863',
      employerCode: null,
      reportingEntityId: '0199b000-0000-7000-8000-0000000000f2',
    });
    expect(await directory.getRosterRecord('psc', record.id)).toEqual({
      personalNumber: 'PSC/2019/0077',
      nationalId: '27451863',
      employerCode: 'MOH',
      reportingEntityId: null,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect((fetch.mock.calls[0]?.[0] as Request).url).toBe(
      `http://directory.test/internal/v1/commissions/psc/roster/records/${record.id}`,
    );
  });

  it('answers null for a roster record the Commission does not have', async () => {
    const directory = new HttpDirectoryClient({
      directoryUrl: 'http://directory.test',
      tokens: { token: () => Promise.resolve('token'), invalidate: vi.fn() },
      fetch: () => Promise.resolve(new Response(null, { status: 404 })),
    });

    expect(
      await directory.getRosterRecord('psc', '0199b000-0000-7000-8000-0000000000f3'),
    ).toBeNull();
  });
});
