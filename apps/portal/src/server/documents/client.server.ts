import createClient from 'openapi-fetch';

import { env } from '../env.server';
import { mockDocumentsFetch } from './mock.server';
import type { paths } from './schema.gen';

const TIMEOUT_MS = 10_000;

/**
 * Typed client for the documents service's uploads, generated from
 * `packages/schemas/internal/documents.yaml`, called as the signed-in declarant. Shares the
 * DECLARATIONS_MOCK flag with the declarations client so linking sees the mock's uploads.
 */
export function documentsClient(accessToken: string) {
  const config = env();
  const send = config.DECLARATIONS_MOCK ? mockDocumentsFetch : fetch;
  return createClient<paths>({
    baseUrl: config.DOCUMENTS_API_URL,
    headers: { accept: 'application/json', authorization: `Bearer ${accessToken}` },
    fetch: (request) => send(new Request(request, { signal: AbortSignal.timeout(TIMEOUT_MS) })),
  });
}

export type DocumentsClient = ReturnType<typeof documentsClient>;
