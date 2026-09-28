import createClient from 'openapi-fetch';

import { env } from '../env.server';
import type { paths } from './schema.gen';

const TIMEOUT_MS = 5_000;

/**
 * The in-memory declarations service (./mock.server.ts), loaded on first use. It trusts bearer
 * tokens without checking their signatures, so it must never ship: see `declarationsClient`.
 */
async function mockFetch(request: Request): Promise<Response> {
  const { mockDeclarationsFetch } = await import('./mock.server');
  return mockDeclarationsFetch(request);
}

/**
 * Typed client for the declarations service, generated from
 * `packages/schemas/internal/declarations.yaml`, called as the signed-in user.
 */
export function declarationsClient(accessToken: string) {
  const config = env();
  // Local development and tests only: DECLARATIONS_MOCK=true serves obligations from the mock
  // until the declarations service implements its read API (#90). `import.meta.env.DEV` is
  // `false` in production builds, so the bundler drops this branch and the mock's chunk with
  // it; keep the check inline here for that to work.
  const send =
    import.meta.env.DEV && process.env.NODE_ENV !== 'production' && config.DECLARATIONS_MOCK
      ? mockFetch
      : fetch;
  return createClient<paths>({
    baseUrl: config.DECLARATIONS_API_URL,
    headers: { accept: 'application/json', authorization: `Bearer ${accessToken}` },
    fetch: (request) => send(new Request(request, { signal: AbortSignal.timeout(TIMEOUT_MS) })),
  });
}

export type DeclarationsClient = ReturnType<typeof declarationsClient>;
