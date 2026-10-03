import { mockableClient } from '@adili/api-kit/client';
import { afterEach, describe, expect, it } from 'vitest';

import { loadOpenDataFile, loadOpenDataPage } from './open-data.server';
import { mockOpenDataFetch, setOpenDataMockState } from './reporting/mock.server';
import type { paths } from './reporting/schema';

function client() {
  return mockableClient<paths>({
    baseUrl: 'http://reporting.test',
    timeoutMs: 5_000,
    mock: mockOpenDataFetch,
  });
}

afterEach(() => {
  setOpenDataMockState('ok');
});

describe('the Open data page load (spec 09b S8, S11)', () => {
  it('opens on the latest year’s current annual release, with its six tables', async () => {
    const page = await loadOpenDataPage(client(), {});

    expect(page.status).toBe('ok');
    if (page.status !== 'ok') return;
    expect(page.release).toMatchObject({
      fy: 2025,
      kind: 'annual',
      version: 1,
      status: 'published',
    });
    expect(Object.keys(page.tables).sort()).toEqual([
      'access-requests',
      'by-cycle',
      'by-entity-type',
      'compliance-by-commission',
      'filing-by-commission',
      'national-totals',
    ]);
    expect(
      page.tables['national-totals'].rows.find((row) => row.measure === 'commissions')?.value,
    ).toBe(52);
  });

  it('lists every year and kind once, and the versions of the release shown', async () => {
    const page = await loadOpenDataPage(client(), { fy: 2024, kind: 'annual' });

    if (page.status !== 'ok') throw new Error(page.status);
    expect(page.choices).toEqual([
      { fy: 2025, kind: 'annual' },
      { fy: 2025, kind: 'snapshot' },
      { fy: 2024, kind: 'annual' },
    ]);
    // The current version of a year, not the withdrawn one.
    expect(page.release.version).toBe(2);
    expect(page.versions.map(({ version, status }) => [version, status])).toEqual([
      [2, 'published'],
      [1, 'withdrawn'],
    ]);
  });

  it('opens a withdrawn version asked for, with its reason and the version correcting it (S7)', async () => {
    const page = await loadOpenDataPage(client(), { fy: 2024, kind: 'annual', version: 1 });

    if (page.status !== 'ok') throw new Error(page.status);
    expect(page.release).toMatchObject({
      status: 'withdrawn',
      correctedVersion: 2,
      withdrawnReason: expect.stringContaining('counted twice') as string,
    });
  });

  it('draws the national trend from each year’s current annual release up to the year shown', async () => {
    const latest = await loadOpenDataPage(client(), {});
    const first = await loadOpenDataPage(client(), { fy: 2024, kind: 'annual' });

    if (latest.status !== 'ok' || first.status !== 'ok') throw new Error('not ok');
    expect(latest.trend.map((point) => point.fy)).toEqual([2024, 2025]);
    // FY 2024/25 from version 2: the withdrawn version 1 counted 1,204 declarations twice.
    const v2 = first.tables['national-totals'].rows.find((row) => row.measure === 'filed')?.value;
    expect(latest.trend[0]?.totals.find((row) => row.measure === 'filed')?.value).toBe(v2);
    expect(first.trend.map((point) => point.fy)).toEqual([2024]);
  });

  it('says so when a release asked for does not exist', async () => {
    expect((await loadOpenDataPage(client(), { fy: 2030, kind: 'annual' })).status).toBe(
      'not-found',
    );
    expect(
      (await loadOpenDataPage(client(), { fy: 2025, kind: 'annual', version: 9 })).status,
    ).toBe('not-found');
  });

  it('is empty before the first release is published', async () => {
    setOpenDataMockState('empty');

    expect(await loadOpenDataPage(client(), {})).toEqual({ status: 'empty' });
  });

  it('reads a 429 as rate-limited, with when to try again', async () => {
    setOpenDataMockState('rate-limited');

    expect(await loadOpenDataPage(client(), {})).toEqual({
      status: 'rate-limited',
      retryAfterSeconds: 60,
    });
  });

  it('reads the service being down as unavailable', async () => {
    setOpenDataMockState('down');

    expect(await loadOpenDataPage(client(), {})).toEqual({ status: 'unavailable' });
  });
});

describe('open-data downloads (S8)', () => {
  it('serves a table’s CSV as the API does: header row, _suppressed column, empty suppressed cells', async () => {
    const file = await loadOpenDataFile(client(), {
      fy: 2025,
      kind: 'annual',
      version: 1,
      file: 'filing-by-commission.csv',
    });

    if (file.status !== 'ok') throw new Error(file.status);
    expect(file.contentType).toMatch(/^text\/csv/);
    expect(file.fileName).toBe('adili-open-data-2025-annual-v1-filing-by-commission.csv');
    const lines = file.body.split('\r\n');
    expect(lines[0]).toBe(
      'commission,commissionName,reportStatus,cycle,expected,filed,nonFilers,filingRate,_suppressed',
    );
    // Lamu's final cycle has 6 officers.
    expect(lines).toContain(
      'cpsb005,Lamu County Public Service Board,submitted-on-time,final,,,,,true',
    );
  });

  it('serves the release as JSON, the file the hashes and the verification code belong to', async () => {
    const file = await loadOpenDataFile(client(), {
      fy: 2024,
      kind: 'annual',
      version: 1,
      file: 'release.json',
    });

    if (file.status !== 'ok') throw new Error(file.status);
    expect(file.fileName).toBe('adili-open-data-2024-annual-v1-release.json');
    expect(JSON.parse(file.body)).toMatchObject({
      status: 'withdrawn',
      tables: expect.any(Array) as unknown[],
    });
  });

  it('is not found for a file that is neither a table nor the release', async () => {
    expect(
      (await loadOpenDataFile(client(), { fy: 2025, kind: 'annual', version: 1, file: 'x.csv' }))
        .status,
    ).toBe('not-found');
  });
});
