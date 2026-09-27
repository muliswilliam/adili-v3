import { describe, expect, it } from 'vitest';

import { createDirectoryClient } from './directory/client';
import {
  type RosterImportReportDeps,
  rosterImportReportResponse,
} from './roster-import-report.server';

const IMPORT_ID = '0199a0b4-0000-7000-8000-0000000000aa';

function depsAnswering(
  respond: (request: Request) => Response,
  {
    accessToken = 'token-123',
    tenant = 'psc',
  }: { accessToken?: string | null; tenant?: string | null } = {},
) {
  const requests: Request[] = [];
  const deps: RosterImportReportDeps = {
    accessToken: () => Promise.resolve(accessToken),
    tenant: () => Promise.resolve(tenant),
    directory: (token) =>
      createDirectoryClient({
        baseUrl: 'http://directory.test',
        accessToken: token,
        fetch: (input) => {
          const request = input instanceof Request ? input : new Request(input);
          requests.push(request);
          return Promise.resolve(respond(request));
        },
      }),
  };
  return { deps, requests };
}

const request = () => new Request(`http://console.test/roster/imports/${IMPORT_ID}/report.csv`);

describe('rosterImportReportResponse', () => {
  it("passes the rejected rows CSV of the viewer's Commission through", async () => {
    const csv = '﻿personnel_file_number,full_name\r\nPSC/1,\r\n';
    const { deps, requests } = depsAnswering(
      () =>
        new Response(csv, {
          headers: {
            'content-type': 'text/csv; charset=utf-8',
            'content-disposition': 'attachment; filename="psc-roster-rejected-rows.csv"',
          },
        }),
    );

    const response = await rosterImportReportResponse(request(), IMPORT_ID, deps);

    expect(requests[0]?.url).toBe(
      `http://directory.test/v1/commissions/psc/roster/imports/${IMPORT_ID}/report.csv`,
    );
    expect(requests[0]?.headers.get('authorization')).toBe('Bearer token-123');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="psc-roster-rejected-rows.csv"',
    );
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(new TextDecoder('utf-8', { ignoreBOM: true }).decode(await response.arrayBuffer())).toBe(
      csv,
    );
  });

  it('passes a refusal through, e.g. purged rows', async () => {
    const problem = { type: 'import-rows-purged', title: 'Gone', status: 410 };
    const { deps } = depsAnswering(
      () =>
        new Response(JSON.stringify(problem), {
          status: 410,
          headers: { 'content-type': 'application/problem+json' },
        }),
    );

    const response = await rosterImportReportResponse(request(), IMPORT_ID, deps);

    expect(response.status).toBe(410);
    expect(await response.json()).toEqual(problem);
  });

  it('asks a signed-out user to sign in', async () => {
    const { deps, requests } = depsAnswering(() => new Response(''), { accessToken: null });

    const response = await rosterImportReportResponse(request(), IMPORT_ID, deps);

    expect(response.status).toBe(401);
    expect(requests).toHaveLength(0);
  });

  it('finds nothing without a Commission or with a malformed id', async () => {
    const { deps, requests } = depsAnswering(() => new Response(''), { tenant: null });

    expect((await rosterImportReportResponse(request(), IMPORT_ID, deps)).status).toBe(404);
    expect((await rosterImportReportResponse(request(), 'not-a-uuid', deps)).status).toBe(404);
    expect(requests).toHaveLength(0);
  });

  it('says so when the directory does not answer', async () => {
    const { deps } = depsAnswering(() => {
      throw new TypeError('fetch failed');
    });

    expect((await rosterImportReportResponse(request(), IMPORT_ID, deps)).status).toBe(502);
  });
});
