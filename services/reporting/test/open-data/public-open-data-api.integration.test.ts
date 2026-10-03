import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { sha256 } from '../../src/open-data/files.js';
import type { PublicOpenDataReleaseView } from '../../src/open-data/public-representation.js';
import type { OpenDataReleaseView } from '../../src/open-data/representation.js';
import { OPEN_DATA_TABLES } from '../../src/open-data/tables.js';
import { contractErrors } from '../support/contract.js';
import { type Caller, type ReportingApi, startReportingApi } from '../support/reporting-api.js';
import { RELEASE_COMMISSIONS, RELEASE_FY } from './release-fixtures.js';
import { givenReleaseYear } from './release-year.js';

/**
 * S7 and S8 through the public open-data API, with no Authorization header, against Postgres,
 * Valkey (the rate limiter) and the faked open-data bucket. FY 2027 as release-fixtures.ts has
 * it: EACC builds a snapshot, publishes it and withdraws it through its own endpoints.
 *
 * - S8: the list, a release and its tables as JSON and CSV (golden; header row, suppressed cells
 *   empty, `_suppressed`), without auth, never a preview, never a person; ETag, Last-Modified,
 *   `Cache-Control: public, max-age=3600` and 304s; 429 past the per client IP budget; CORS `*`
 *   on every answer and the preflight.
 * - S7: a withdrawn release carries its status, when and why (the banner), its files are still
 *   served, and the published version 2 corrects it.
 */
describe('Public open-data API (S7, S8)', () => {
  let api: ReportingApi;

  const ANALYST: Caller = {
    sub: 'eacc-analyst-1',
    tenant: 'eacc',
    roles: ['eacc-analyst'],
    name: 'Amina Hassan',
  };
  const SUPERVISOR: Caller = {
    sub: 'eacc-supervisor-1',
    tenant: 'eacc',
    roles: ['eacc-supervisor'],
    name: 'Joseph Mwangi',
  };

  const EACC_RELEASES = '/v1/eacc/open-data/releases';
  const PUBLIC = '/open-data/v1/releases';
  const V1 = `${PUBLIC}/${String(RELEASE_FY)}/snapshot/1`;
  const BUILT_AT = '2028-03-20T07:00:00.000Z';
  const PUBLISHED_AT = '2028-03-25T08:00:00.000Z';
  const WITHDRAWN_AT = '2028-04-02T10:00:00.000Z';
  const REASON = 'The TSC figures were filed against the wrong financial year.';
  const CACHE_CONTROL = 'public, max-age=3600';
  const GOLDEN = new URL('golden/', import.meta.url);

  /** reporting.yaml's success body of a public operation. */
  const contract = (path: string, type = 'application~1json') =>
    `/paths/${path.replaceAll('/', '~1')}/get/responses/200/content/${type}/schema`;
  const LIST = contract('/open-data/v1/releases');
  const RELEASE = contract('/open-data/v1/releases/{fy}/{kind}/{version}');
  const TABLE = contract('/open-data/v1/releases/{fy}/{kind}/{version}/tables/{table}');

  beforeAll(async () => {
    api = await startReportingApi();
    return () => api.close();
  });

  beforeEach(async () => {
    await api.reset();
    for (const slug of RELEASE_COMMISSIONS) api.directory.givenCommission(slug);
    api.clock.set(BUILT_AT);
    await givenReleaseYear(api);
    const ncr = await api.send(
      'POST',
      `/v1/eacc/national-reports/${String(RELEASE_FY)}/build`,
      ANALYST,
    );
    expect(ncr.statusCode, ncr.body).toBe(200);
  });

  async function previewBuilt(): Promise<OpenDataReleaseView> {
    const response = await api.send(
      'POST',
      EACC_RELEASES,
      ANALYST,
      { fy: RELEASE_FY },
      { 'idempotency-key': randomUUID() },
    );
    expect(response.statusCode, response.body).toBe(202);
    return response.json<OpenDataReleaseView>();
  }

  async function published(at = PUBLISHED_AT): Promise<OpenDataReleaseView> {
    const preview = await previewBuilt();
    api.clock.set(at);
    const response = await api.send('POST', `${EACC_RELEASES}/${preview.id}/publish`, SUPERVISOR);
    expect(response.statusCode, response.body).toBe(200);
    return response.json<OpenDataReleaseView>();
  }

  async function withdrawn(releaseId: string): Promise<void> {
    api.clock.set(WITHDRAWN_AT);
    const response = await api.send('POST', `${EACC_RELEASES}/${releaseId}/withdraw`, SUPERVISOR, {
      reason: REASON,
    });
    expect(response.statusCode, response.body).toBe(200);
  }

  const stored = (releaseId: string, file: string): Buffer => {
    const object = api.files.objects.get(`releases/${releaseId}/${file}`);
    if (!object) throw new Error(`No ${file} stored for ${releaseId}`);
    return object.body;
  };

  it('S8: lists a published release, without a token, as the public sees it: no preview, no person, the manifest verify link', async () => {
    const preview = await previewBuilt();
    // A preview is EACC's alone.
    expect((await api.anonymous(PUBLIC)).json()).toEqual([]);
    expect((await api.anonymous(V1)).statusCode).toBe(404);
    expect((await api.anonymous(`${V1}/tables/national-totals`)).statusCode).toBe(404);

    api.clock.set(PUBLISHED_AT);
    const publishing = await api.send('POST', `${EACC_RELEASES}/${preview.id}/publish`, SUPERVISOR);
    expect(publishing.statusCode, publishing.body).toBe(200);
    const eacc = publishing.json<OpenDataReleaseView>();

    const list = await api.anonymous(PUBLIC);
    expect(list.statusCode, list.body).toBe(200);
    expect(list.headers['content-type']).toBe('application/json; charset=utf-8');
    const releases = list.json<PublicOpenDataReleaseView[]>();
    expect(contractErrors(LIST, releases)).toEqual([]);
    const expected: PublicOpenDataReleaseView = {
      id: preview.id,
      fy: RELEASE_FY,
      kind: 'snapshot',
      version: 1,
      status: 'published',
      builtAt: BUILT_AT,
      publishedAt: PUBLISHED_AT,
      withdrawnAt: null,
      withdrawnReason: null,
      correctedVersion: null,
      manifestVerificationId: eacc.manifestVerificationId ?? '',
      verifyUrl: `http://localhost:3030/v/${eacc.manifestVerificationId ?? ''}`,
      tables: eacc.tables,
    };
    expect(releases).toEqual([expected]);
    expect(eacc.manifestVerificationId).toMatch(/^ADL-/);

    const release = await api.anonymous(V1);
    expect(release.statusCode, release.body).toBe(200);
    expect(contractErrors(RELEASE, release.json())).toEqual([]);
    expect(release.json()).toEqual(expected);

    // Nobody's name or subject, nor the manifest's document id.
    for (const body of [list.body, release.body]) {
      for (const text of [
        'Joseph Mwangi',
        'Amina Hassan',
        SUPERVISOR.sub ?? '',
        ANALYST.sub ?? '',
        eacc.manifestDocumentId ?? '',
        'publishedBy',
        'withdrawnBy',
        'manifestDocumentId',
      ]) {
        expect(body).not.toContain(text);
      }
    }
    expect((await api.anonymous(`${PUBLIC}/${String(RELEASE_FY)}/annual/1`)).statusCode).toBe(404);
    expect((await api.anonymous(`${PUBLIC}/${String(RELEASE_FY)}/snapshot/2`)).statusCode).toBe(
      404,
    );
  });

  it('S8: serves each table as stored, JSON by default and CSV by Accept or the .csv suffix (golden)', async () => {
    const release = await published();
    expect(release.tables.map((entry) => entry.table)).toEqual([...OPEN_DATA_TABLES]);

    for (const entry of release.tables) {
      const json = await api.anonymous(`${V1}/tables/${entry.table}`);
      expect(json.statusCode, json.body).toBe(200);
      expect(json.headers['content-type']).toBe('application/json; charset=utf-8');
      expect(json.headers.vary).toBe('Accept');
      expect(json.rawPayload).toEqual(stored(release.id, `${entry.table}.json`));
      expect(sha256(json.rawPayload)).toBe(entry.sha256Json);
      expect(contractErrors(TABLE, json.json())).toEqual([]);

      const csv = await api.anonymous(`${V1}/tables/${entry.table}`, {
        headers: { accept: 'text/csv' },
      });
      expect(csv.statusCode, csv.body).toBe(200);
      expect(csv.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(sha256(csv.rawPayload)).toBe(entry.sha256Csv);

      const golden = new URL(`public-${entry.table}.csv`, GOLDEN);
      if (process.env.UPDATE_GOLDEN) writeFileSync(golden, csv.rawPayload);
      expect(csv.body).toBe(readFileSync(golden, 'utf8'));

      const download = await api.anonymous(`${V1}/tables/${entry.table}.csv`, {
        headers: { accept: 'application/json' },
      });
      expect(download.statusCode, download.body).toBe(200);
      expect(download.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(download.headers['content-disposition']).toBe(
        `attachment; filename="adili-open-data-2027-snapshot-v1-${entry.table}.csv"`,
      );
      expect(download.rawPayload).toEqual(csv.rawPayload);
    }

    // The CSV shape: a header row, the marker column as `_suppressed`, a hidden figure empty.
    const [header, ...rows] = (await api.anonymous(`${V1}/tables/filing-by-commission.csv`)).body
      .trimEnd()
      .split('\r\n');
    expect(header?.split(',').at(-1)).toBe('_suppressed');
    const wrc = rows.find((row) => row.startsWith('wrc,'));
    expect(wrc).toMatch(/,true$/);
    expect(wrc).toMatch(/,,/);

    // Negotiation: CSV only when rated above JSON; neither is 406.
    const negotiated = async (accept: string) => {
      const response = await api.anonymous(`${V1}/tables/by-cycle`, { headers: { accept } });
      return response.statusCode === 200 ? response.headers['content-type'] : response.statusCode;
    };
    expect(await negotiated('text/csv;q=0.9, application/json')).toBe(
      'application/json; charset=utf-8',
    );
    expect(await negotiated('application/json;q=0.5, text/*')).toBe('text/csv; charset=utf-8');
    expect(await negotiated('*/*')).toBe('application/json; charset=utf-8');
    expect(await negotiated('image/png')).toBe(406);

    expect((await api.anonymous(`${V1}/tables/officers`)).statusCode).toBe(400);
    expect((await api.anonymous(`${PUBLIC}/2027/monthly/1`)).statusCode).toBe(400);
    expect((await api.anonymous(`${PUBLIC}/2027/snapshot/0`)).statusCode).toBe(400);
  });

  it('S8: tags, dates and caches every answer for an hour; a current copy gets 304', async () => {
    const release = await published();
    const table = release.tables.find((each) => each.table === 'national-totals');
    if (!table) throw new Error('no national-totals');

    const urls = [PUBLIC, V1, `${V1}/tables/national-totals`, `${V1}/tables/national-totals.csv`];
    for (const url of urls) {
      const first = await api.anonymous(url);
      expect(first.statusCode, first.body).toBe(200);
      const etag = String(first.headers.etag);
      expect(etag).toBe(`"${sha256(first.rawPayload)}"`);
      expect(first.headers['cache-control']).toBe(CACHE_CONTROL);
      expect(first.headers['last-modified']).toBe(
        new Date(url.includes('/tables/') ? BUILT_AT : PUBLISHED_AT).toUTCString(),
      );

      const conditionals: Record<string, string>[] = [
        { 'if-none-match': etag },
        { 'if-none-match': `"other", W/${etag}` },
        { 'if-modified-since': String(first.headers['last-modified']) },
      ];
      for (const headers of conditionals) {
        const again = await api.anonymous(url, { headers });
        expect(again.statusCode, url).toBe(304);
        expect(again.body).toBe('');
        expect(again.headers.etag).toBe(etag);
        expect(again.headers['cache-control']).toBe(CACHE_CONTROL);
        expect(again.headers['access-control-allow-origin']).toBe('*');
      }
      expect(
        (await api.anonymous(url, { headers: { 'if-none-match': '"stale"' } })).statusCode,
      ).toBe(200);
      expect(
        (
          await api.anonymous(url, {
            headers: { 'if-modified-since': new Date(Date.parse(BUILT_AT) - 1000).toUTCString() },
          })
        ).statusCode,
      ).toBe(200);
    }
    expect((await api.anonymous(`${V1}/tables/national-totals`)).headers.etag).toBe(
      `"${table.sha256Json}"`,
    );
    expect((await api.anonymous(`${V1}/tables/national-totals.csv`)).headers.etag).toBe(
      `"${table.sha256Csv}"`,
    );

    // Withdrawing changes the release (a new tag), not its files.
    const before = await api.anonymous(V1);
    await withdrawn(release.id);
    const after = await api.anonymous(V1, {
      headers: { 'if-none-match': String(before.headers.etag) },
    });
    expect(after.statusCode).toBe(200);
    expect(after.headers.etag).not.toBe(before.headers.etag);
    expect(after.headers['last-modified']).toBe(new Date(WITHDRAWN_AT).toUTCString());
    expect(
      (
        await api.anonymous(`${V1}/tables/national-totals`, {
          headers: { 'if-none-match': `"${table.sha256Json}"` },
        })
      ).statusCode,
    ).toBe(304);
  });

  it('S8: lets any origin read every answer, errors included, and answers the preflight', async () => {
    await published();
    for (const [url, status] of [
      [PUBLIC, 200],
      [V1, 200],
      [`${V1}/tables/by-cycle.csv`, 200],
      [`${PUBLIC}/2030/annual/1`, 404],
      [`${V1}/tables/officers`, 400],
    ] as const) {
      const response = await api.anonymous(url, {
        headers: { origin: 'https://researcher.example' },
      });
      expect(response.statusCode, url).toBe(status);
      expect(response.headers['access-control-allow-origin']).toBe('*');
      expect(response.headers['access-control-expose-headers']).toContain('ETag');
      expect(response.headers['cross-origin-resource-policy']).toBe('cross-origin');
    }

    for (const url of [PUBLIC, V1, `${V1}/tables/by-cycle`]) {
      const preflight = await api.anonymous(url, {
        method: 'OPTIONS',
        headers: {
          origin: 'https://researcher.example',
          'access-control-request-method': 'GET',
          'access-control-request-headers': 'if-none-match',
        },
      });
      expect(preflight.statusCode, url).toBe(204);
      expect(preflight.headers['access-control-allow-origin']).toBe('*');
      expect(preflight.headers['access-control-allow-methods']).toBe('GET, HEAD, OPTIONS');
      expect(preflight.headers['access-control-allow-headers']).toBe(
        'Accept, If-None-Match, If-Modified-Since',
      );
    }
  });

  it('S8: refuses the 61st request from one address in a minute with 429, readable cross-origin; other addresses and the next minute are served', async () => {
    await published();
    const ip = '203.0.113.77';
    const urls = [PUBLIC, V1, `${V1}/tables/by-cycle`];
    for (let i = 0; i < 60; i += 1) {
      const response = await api.anonymous(urls[i % urls.length] ?? PUBLIC, { ip });
      expect(response.statusCode).toBe(200);
      expect(response.headers['ratelimit-remaining']).toBe(String(59 - i));
    }

    const refused = await api.anonymous(V1, { ip });
    expect(refused.statusCode).toBe(429);
    expect(refused.json()).toMatchObject({ code: 'rate-limit-exceeded' });
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
    expect(refused.headers['ratelimit-limit']).toBe('60');
    expect(refused.headers['access-control-allow-origin']).toBe('*');

    expect((await api.anonymous(V1)).statusCode).toBe(200);
    api.rateLimitClock.advance(61_000);
    expect((await api.anonymous(V1, { ip })).statusCode).toBe(200);
  });

  it('S7: a withdrawn release carries its status, when and why; its files are still served; version 2 corrects it', async () => {
    const first = await published();
    await withdrawn(first.id);

    const banner = await api.anonymous(V1);
    expect(banner.statusCode, banner.body).toBe(200);
    expect(contractErrors(RELEASE, banner.json())).toEqual([]);
    expect(banner.json()).toMatchObject({
      id: first.id,
      status: 'withdrawn',
      publishedAt: PUBLISHED_AT,
      withdrawnAt: WITHDRAWN_AT,
      withdrawnReason: REASON,
      correctedVersion: null,
      tables: first.tables,
    });
    expect(banner.body).not.toContain('Joseph Mwangi');

    for (const entry of first.tables) {
      for (const suffix of ['', '.csv']) {
        const file = await api.anonymous(`${V1}/tables/${entry.table}${suffix}`);
        expect(file.statusCode, file.body).toBe(200);
        expect(sha256(file.rawPayload)).toBe(suffix ? entry.sha256Csv : entry.sha256Json);
      }
    }

    const second = await published('2028-04-05T08:00:00.000Z');
    expect(second.version).toBe(2);
    const list = (await api.anonymous(PUBLIC)).json<PublicOpenDataReleaseView[]>();
    expect(contractErrors(LIST, list)).toEqual([]);
    expect(
      list.map(({ version, status, correctedVersion }) => ({ version, status, correctedVersion })),
    ).toEqual([
      { version: 2, status: 'published', correctedVersion: null },
      { version: 1, status: 'withdrawn', correctedVersion: 2 },
    ]);
    expect((await api.anonymous(V1)).json()).toMatchObject({ correctedVersion: 2 });
  });

  it('S8: 503 while object storage cannot be reached', async () => {
    await published();
    api.files.failReads(1);
    const response = await api.anonymous(`${V1}/tables/by-cycle`);
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ type: 'storage-unavailable' });
  });
});
