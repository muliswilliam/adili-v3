import createClient, { type Client } from 'openapi-fetch';

import { callDirectory, type DirectoryResult } from '../directory/client';
import type { MockFetch } from '../mockable-client.server';
import type { components, paths } from './api.gen';

/**
 * Typed client for the documents API, generated from the committed contract
 * (packages/schemas/internal/documents.yaml → api.gen.ts via `pnpm generate:api`).
 * Runs on the server only: the browser never holds a token. The file bytes themselves never
 * pass through the console: the browser PUTs them straight to the presigned URL.
 */
export type DocumentsClient = Client<paths>;

type Schemas = components['schemas'];
export type Upload = Schemas['Upload'];
export type UploadReservation = Schemas['UploadReservation'];
export type UploadRejection = Schemas['UploadRejection'];
export type CreateUpload = Schemas['CreateUpload'];

/**
 * How long the console waits for the documents service. Completing an upload scans the file
 * synchronously within the service's 60-second budget, so it gets that plus headroom; a
 * timed-out completion is reported as an upload that did not complete.
 */
export const DOCUMENTS_TIMEOUTS_MS = { read: 5_000, write: 10_000, complete: 75_000 } as const;

/** The timeout of one documents call, from its method and path. */
export function documentsTimeoutMs(method: string, path: string): number {
  if (method === 'GET' || method === 'HEAD') return DOCUMENTS_TIMEOUTS_MS.read;
  if (path.endsWith('/complete')) return DOCUMENTS_TIMEOUTS_MS.complete;
  return DOCUMENTS_TIMEOUTS_MS.write;
}

export function createDocumentsClient(options: {
  baseUrl: string;
  accessToken: string;
  fetch?: typeof fetch;
  /**
   * An in-memory mock to answer instead of the service, or null. Build it inline at the call
   * site behind `import.meta.env.DEV` so production builds drop it (see `mockableClient`); it
   * is also ignored under NODE_ENV=production.
   */
  mock?: MockFetch | null;
}): DocumentsClient {
  const fetchImpl: MockFetch =
    options.mock && process.env.NODE_ENV !== 'production'
      ? options.mock
      : (request) => (options.fetch ?? fetch)(request);
  return createClient<paths>({
    baseUrl: options.baseUrl,
    headers: { authorization: `Bearer ${options.accessToken}`, accept: 'application/json' },
    fetch: (request) => {
      const timeoutMs = documentsTimeoutMs(request.method, new URL(request.url).pathname);
      return fetchImpl(new Request(request, { signal: AbortSignal.timeout(timeoutMs) }));
    },
  });
}

/** A documents call's outcome, folded the same way as directory calls (see `callDirectory`). */
export type DocumentsResult<T> = DirectoryResult<T>;

/** Runs one documents client call and folds every outcome into a `DocumentsResult`. */
export const callDocuments: <T>(
  request: () => Promise<{ data?: T; error?: unknown; response: Response }>,
) => Promise<DocumentsResult<T>> = callDirectory;
