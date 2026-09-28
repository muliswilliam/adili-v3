import createClient, { type Client } from 'openapi-fetch';

import type { paths } from './api.gen';

/**
 * Typed client for the documents API (packages/schemas/internal/documents.yaml → api.gen.ts via
 * `pnpm generate:api`), for clarification letter downloads. Server only; `fetch` is the review
 * mock's documents stand-in with REVIEW_MOCK set (see `../clarifications.ts`).
 */
export type DocumentsClient = Client<paths>;

const TIMEOUT_MS = 10_000;

export function createDocumentsClient(options: {
  baseUrl: string;
  accessToken: string;
  fetch?: (request: Request) => Promise<Response>;
}): DocumentsClient {
  const send = options.fetch ?? fetch;
  return createClient<paths>({
    baseUrl: options.baseUrl,
    headers: { authorization: `Bearer ${options.accessToken}`, accept: 'application/json' },
    fetch: (request) => send(new Request(request, { signal: AbortSignal.timeout(TIMEOUT_MS) })),
  });
}
