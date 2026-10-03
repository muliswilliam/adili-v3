import createClient from 'openapi-fetch';
import { describe, expect, it } from 'vitest';

import { loadQueuePage } from './review-queue.server';
import type { paths } from './review/api.gen';

describe('loadQueuePage', () => {
  it('M10: sends the search text and filters in a POST body, never in the URL', async () => {
    const seen: { method: string; url: string; body: unknown }[] = [];
    const client = createClient<paths>({
      baseUrl: 'http://review.test',
      fetch: async (request) => {
        seen.push({ method: request.method, url: request.url, body: await request.json() });
        return new Response(JSON.stringify({ items: [], nextCursor: null }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });

    const result = await loadQueuePage(
      client,
      'psc',
      { search: 'Wanjiku Kamau', band: 'high', late: true },
      { cursor: 'next', limit: 50 },
    );

    expect(result).toEqual({ ok: true, data: { items: [], nextCursor: null } });
    expect(seen).toEqual([
      {
        method: 'POST',
        url: 'http://review.test/v1/commissions/psc/review/queue/search',
        body: { search: 'Wanjiku Kamau', band: 'high', late: true, cursor: 'next', limit: 50 },
      },
    ]);
  });
});
