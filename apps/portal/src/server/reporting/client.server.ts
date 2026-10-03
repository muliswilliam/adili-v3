import { mockableClient } from '@adili/api-kit/client';

import { env } from '../env.server';
import { publicCache } from './public-cache';
import type { paths } from './schema';

// One cache for the server's lifetime, shared by every visitor (see `publicCache`).
const cachedFetch = publicCache((request, init) => fetch(request, init));
let cachedMock: ReturnType<typeof publicCache> | undefined;

/**
 * Typed client for the reporting service's public open-data API (spec 09b), called without a
 * token: the API is public. Responses go through the portal's HTTP cache. With OPEN_DATA_MOCK
 * set in development it talks to the in-memory mock instead (`mock.server.ts`).
 */
export function openDataClient() {
  const config = env();
  return mockableClient<paths>({
    baseUrl: config.REPORTING_API_URL,
    timeoutMs: 10_000,
    fetch: (input, init) =>
      cachedFetch(input instanceof Request ? input : new Request(input, init), init ?? {}),
    // Inline, so production builds drop the mock (see mockableClient).
    mock:
      import.meta.env.DEV && config.OPEN_DATA_MOCK
        ? (cachedMock ??= publicCache(async (request) =>
            (await import('./mock.server')).mockOpenDataFetch(request),
          ))
        : null,
  });
}

export type OpenDataClient = ReturnType<typeof openDataClient>;

/** Where the public reaches the open-data API, for the About this data page. */
export function openDataPublicBase(): string {
  const config = env();
  return `${(config.OPEN_DATA_API_PUBLIC_URL ?? config.REPORTING_API_URL).replace(/\/$/, '')}/open-data/v1`;
}
