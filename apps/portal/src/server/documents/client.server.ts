import createClient from 'openapi-fetch';

import { env } from '../env.server';
import type { paths } from './schema.gen';

const TIMEOUT_MS = 10_000;

/** The in-memory documents service (./mock.server.ts), loaded on first use; never shipped. */
async function mockFetch(request: Request): Promise<Response> {
  const { mockDocumentsFetch } = await import('./mock.server');
  return mockDocumentsFetch(request);
}

/**
 * Typed client for the documents service's uploads, generated from
 * `packages/schemas/internal/documents.yaml`, called as the signed-in declarant. Shares the
 * DECLARATIONS_MOCK flag with the declarations client so linking sees the mock's uploads.
 */
export function documentsClient(accessToken: string) {
  const config = env();
  // Local development and tests only. `import.meta.env.DEV` is `false` in production builds,
  // so the bundler drops this branch and the mock's chunk with it; keep the check inline here
  // for that to work. The NODE_ENV check keeps the mock off even if a dev build were started
  // with production settings.
  const send =
    import.meta.env.DEV && process.env.NODE_ENV !== 'production' && config.DECLARATIONS_MOCK
      ? mockFetch
      : fetch;
  return createClient<paths>({
    baseUrl: config.DOCUMENTS_API_URL,
    headers: { accept: 'application/json', authorization: `Bearer ${accessToken}` },
    fetch: (request) => send(new Request(request, { signal: AbortSignal.timeout(TIMEOUT_MS) })),
  });
}

export type DocumentsClient = ReturnType<typeof documentsClient>;
