import createClient from 'openapi-fetch';
import { describe, expect, it } from 'vitest';

import { MOCK_COMMISSIONS, mockDirectoryFetch } from './mock.server';
import type { paths } from './schema.gen';

// Exercises the generated client against the mock, as the server functions do.
const client = createClient<paths>({
  baseUrl: 'http://directory.test',
  fetch: mockDirectoryFetch,
});

describe('mock directory', () => {
  it('lists Commissions by name and filters them', async () => {
    const all = await client.GET('/v1/commissions');
    expect(all.data?.items.map((item) => item.slug)).toEqual(
      MOCK_COMMISSIONS.map((item) => item.slug),
    );

    const filtered = await client.GET('/v1/commissions', {
      params: { query: { search: 'service', reportingOfficer: 'none' } },
    });
    expect(filtered.data?.items.map((item) => item.slug)).toEqual(['jsc']);
  });

  it('pages with distinct cursors', async () => {
    const first = await client.GET('/v1/commissions', { params: { query: { limit: 4 } } });
    const cursor = first.data?.nextCursor ?? undefined;
    expect(cursor).toBeDefined();

    const second = await client.GET('/v1/commissions', { params: { query: { limit: 4, cursor } } });
    expect(second.data?.nextCursor).toBeNull();
    const slugs = [...(first.data?.items ?? []), ...(second.data?.items ?? [])].map((c) => c.slug);
    expect(new Set(slugs).size).toBe(MOCK_COMMISSIONS.length);
  });

  it('gets one Commission and 404s on unknown slugs', async () => {
    const found = await client.GET('/v1/commissions/{slug}', { params: { path: { slug: 'psc' } } });
    expect(found.data?.issuerCode).toBe('PSC');

    const missing = await client.GET('/v1/commissions/{slug}', {
      params: { path: { slug: 'nope' } },
    });
    expect(missing.response.status).toBe(404);
    expect(missing.error?.title).toBe('Not Found');
  });

  it('lists all 19 officer categories', async () => {
    const { data } = await client.GET('/v1/reference/officer-categories');
    expect(data).toHaveLength(19);
  });
});
