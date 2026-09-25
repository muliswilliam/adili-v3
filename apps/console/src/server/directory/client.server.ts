import createClient from 'openapi-fetch';

import { env } from '../env.server';
import { mockDirectoryFetch } from './mock.server';
import type { paths } from './schema.gen';

const TIMEOUT_MS = 5_000;

/**
 * Typed client for the directory, generated from `packages/schemas/internal/directory.yaml`.
 * Calls carry the caller's access token so the directory applies their visibility.
 */
export function directoryClient(accessToken: string) {
  const config = env();
  const send = config.DIRECTORY_MOCK ? mockDirectoryFetch : fetch;
  return createClient<paths>({
    baseUrl: config.DIRECTORY_API_URL,
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
    fetch: (request) => send(new Request(request, { signal: AbortSignal.timeout(TIMEOUT_MS) })),
  });
}

export type DirectoryClient = ReturnType<typeof directoryClient>;
