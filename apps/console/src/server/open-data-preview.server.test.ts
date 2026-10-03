import { COMMISSION_ADMIN, EACC_ANALYST, REPORTING_OFFICER } from '@adili/roles';
import createClient from 'openapi-fetch';
import { beforeEach, describe, expect, it } from 'vitest';

import { json } from './mock-http';
import { loadCommissionOpenDataPreview } from './open-data-preview.server';
import type { paths } from './reporting/api.gen';
import type { ReportingClient } from './reporting/client.server';
import { mockOpenDataClient, resetOpenDataMock } from './reporting/open-data-mock.server';

const pscAdmin = () => mockOpenDataClient({ roles: [COMMISSION_ADMIN], tenant: 'psc' });

async function preview(client: ReportingClient, slug = 'psc') {
  const result = await loadCommissionOpenDataPreview(client, slug);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.data;
}

describe("a Commission's open-data preview (spec 09b S6)", () => {
  beforeEach(() => {
    resetOpenDataMock('published');
  });

  it('gives the latest published release and only the Commission its own rows', async () => {
    const data = await preview(pscAdmin());
    expect(data.release).toMatchObject({ fy: 2025, kind: 'annual', version: 1 });
    expect(data.release.status).toBe('published');
    expect(data.filing.map((row) => [row.commission, row.cycle])).toEqual([
      ['psc', 'initial'],
      ['psc', 'biennial'],
      ['psc', 'final'],
      ['psc', 'all'],
    ]);
    expect(data.filing[3]).toMatchObject({ expected: 50312, filed: 48879, nonFilers: 1433 });
    expect(data.compliance).toMatchObject({ commission: 'psc', determinationsCompliant: 16054 });
    expect(data.accessRequests).toMatchObject({ commission: 'psc', received: null });
  });

  it('gives a preview built since the last publication, its suppressed rows marked', async () => {
    resetOpenDataMock('preview');
    const data = await preview(pscAdmin());
    expect(data.release).toMatchObject({ fy: 2026, kind: 'snapshot', status: 'preview' });
    expect(data.release.publishedAt).toBeNull();
    expect(data.compliance).toMatchObject({ suppressed: true, determinationsCompliant: null });
  });

  it('answers 404 while no release has been built', async () => {
    resetOpenDataMock('none');
    const result = await loadCommissionOpenDataPreview(pscAdmin(), 'psc');
    expect(result).toMatchObject({ ok: false, error: { kind: 'problem', problem: { status: 404 } } });
  });

  it("answers 403 to the Commission's other staff and 404 to anyone not of it", async () => {
    const officer = mockOpenDataClient({ roles: [REPORTING_OFFICER], tenant: 'psc' });
    expect(await loadCommissionOpenDataPreview(officer, 'psc')).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 403 } },
    });
    const otherAdmin = mockOpenDataClient({ roles: [COMMISSION_ADMIN], tenant: 'tsc' });
    const analyst = mockOpenDataClient({ roles: [EACC_ANALYST], tenant: 'eacc' });
    for (const client of [otherAdmin, analyst]) {
      expect(await loadCommissionOpenDataPreview(client, 'psc')).toMatchObject({
        ok: false,
        error: { kind: 'problem', problem: { status: 404 } },
      });
    }
  });

  it('reads as unavailable when object storage is down', async () => {
    resetOpenDataMock('unavailable');
    expect(await loadCommissionOpenDataPreview(pscAdmin(), 'psc')).toMatchObject({
      ok: false,
      error: { kind: 'unavailable' },
    });
  });

  it('reads as unavailable when a row is not in the shape the release tables have', async () => {
    const drifted = createClient<paths>({
      baseUrl: 'http://reporting.test',
      fetch: () =>
        Promise.resolve(
          json(200, {
            release: {
              id: '0190f3a2-0000-7000-8000-000000000001',
              fy: 2025,
              kind: 'annual',
              version: 1,
              status: 'published',
              builtAt: '2026-09-18T07:00:00.000Z',
              publishedAt: '2026-09-18T07:00:00.000Z',
              withdrawnAt: null,
              withdrawnReason: null,
              manifestVerificationId: null,
              tables: [],
            },
            tables: {
              'filing-by-commission': [{ commission: 'psc', cycle: 'all', expected: '12' }],
              'compliance-by-commission': [],
              'access-requests': [],
            },
          }),
        ),
    });
    expect(await loadCommissionOpenDataPreview(drifted, 'psc')).toMatchObject({
      ok: false,
      error: { kind: 'unavailable' },
    });
  });
});
