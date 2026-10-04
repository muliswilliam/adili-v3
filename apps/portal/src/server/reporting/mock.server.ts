/**
 * In-memory stand-in for the reporting service's public open-data API (reporting.yaml
 * `/open-data/v1/*`, spec 09b S8), used when OPEN_DATA_MOCK is set, to work on the Open data
 * page without the service. Serves the releases of `mock-fixtures.ts` as the service does: the
 * list (latest year first), a release, a table as JSON or CSV by Accept (`text/csv` rated above
 * JSON gives CSV), a table's `.csv` with `Content-Disposition`; strong ETags of the body's
 * SHA-256 with 304 on `If-None-Match`, `Cache-Control: public, max-age=3600`, CORS `*`; 404 for a
 * release that does not exist and 400 for a malformed path.
 *
 * Tests can switch the API's state (`setOpenDataMockState`): `empty` (no release published
 * yet), `rate-limited` (429 with Retry-After) or `down` (503).
 */
import { createHash } from 'node:crypto';

import { json, problem } from '../mock-http';
import { type MockRelease, mockReleases, tableCsv, tableJson } from './mock-fixtures';
import { OPEN_DATA_TABLES, type OpenDataTableName } from './types';

export type OpenDataMockState = 'ok' | 'empty' | 'rate-limited' | 'down';

let state: OpenDataMockState = 'ok';
let releases: MockRelease[] | undefined;

export function setOpenDataMockState(next: OpenDataMockState) {
  state = next;
}

const sha256 = (body: string) => createHash('sha256').update(body, 'utf8').digest('hex');

const PUBLIC_HEADERS = {
  'access-control-allow-origin': '*',
  'cache-control': 'public, max-age=3600',
};

const RELEASE = /^\/open-data\/v1\/releases\/([^/]+)\/([^/]+)\/([^/]+)(?:\/tables\/([^/]+))?$/;

export function mockOpenDataFetch(request: Request): Promise<Response> {
  return Promise.resolve(answer(request));
}

function answer(request: Request): Response {
  if (request.method !== 'GET') return problem(405, 'Method not allowed');
  if (state === 'rate-limited') {
    return json(
      429,
      {
        type: 'about:blank',
        title: 'Too many requests',
        status: 429,
        code: 'rate-limit-exceeded',
        retryAfterSeconds: 60,
      },
      { 'retry-after': '60', 'access-control-allow-origin': '*' },
    );
  }
  if (state === 'down') return problem(503, 'Service unavailable');

  releases ??= mockReleases(sha256);
  const published = state === 'empty' ? [] : releases;
  const { pathname } = new URL(request.url);

  if (pathname === '/open-data/v1/releases') {
    return file(
      request,
      JSON.stringify(published.map(({ release }) => release)),
      'application/json',
    );
  }

  const match = RELEASE.exec(pathname);
  if (!match) return problem(404, 'Not found');
  const [, fy, kind, version, tableParam] = match;
  if (
    !/^\d{4}$/.test(fy ?? '') ||
    !/^(annual|snapshot)$/.test(kind ?? '') ||
    !/^[1-9]\d*$/.test(version ?? '')
  ) {
    return problem(400, 'Malformed path');
  }
  const found = published.find(
    ({ release }) =>
      String(release.fy) === fy && release.kind === kind && String(release.version) === version,
  );
  if (tableParam === undefined) {
    return found
      ? file(request, JSON.stringify(found.release), 'application/json')
      : problem(404, 'No such release');
  }

  const csvSuffix = tableParam.endsWith('.csv');
  const name = (csvSuffix ? tableParam.slice(0, -4) : tableParam) as OpenDataTableName;
  if (!OPEN_DATA_TABLES.includes(name)) return problem(400, 'Malformed path');
  if (!found) return problem(404, 'No such release');
  const table = found.tables[name];
  if (csvSuffix || prefersCsv(request.headers.get('accept'))) {
    const disposition: Record<string, string> = csvSuffix
      ? {
          'content-disposition': `attachment; filename="adili-open-data-${fy}-${kind}-v${version}-${name}.csv"`,
        }
      : {};
    return file(request, tableCsv(table), 'text/csv; charset=utf-8', disposition);
  }
  return file(request, tableJson(table), 'application/json; charset=utf-8');
}

function file(
  request: Request,
  body: string,
  contentType: string,
  extra: Record<string, string> = {},
): Response {
  const etag = `"${sha256(body)}"`;
  const headers = { ...PUBLIC_HEADERS, etag, vary: 'Accept', ...extra };
  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(body, { status: 200, headers: { ...headers, 'content-type': contentType } });
}

/** Whether Accept rates `text/csv` above `application/json`. */
function prefersCsv(accept: string | null): boolean {
  if (!accept) return false;
  const quality = (type: string) => {
    const range = accept
      .split(',')
      .map((part) => part.trim().split(';'))
      .find(([media]) => media?.trim() === type);
    if (!range) return 0;
    const q = range.slice(1).find((parameter) => parameter.trim().startsWith('q='));
    return q ? Number(q.trim().slice(2)) : 1;
  };
  return quality('text/csv') > quality('application/json');
}
