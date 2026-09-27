import createClient from 'openapi-fetch';

import { env } from '../env.server';
import { mockDeclarationsFetch } from './mock.server';
import type { paths } from './schema.gen';

const TIMEOUT_MS = 10_000;

/**
 * Typed client for the declarations service, generated from
 * `packages/schemas/internal/declarations.yaml`, called as the signed-in declarant. With
 * DECLARATIONS_MOCK set it talks to the in-memory mock instead (see `mock.server.ts`).
 */
export function declarationsClient(accessToken: string) {
  const config = env();
  const send = config.DECLARATIONS_MOCK ? mockDeclarationsFetch : fetch;
  return createClient<paths>({
    baseUrl: config.DECLARATIONS_API_URL,
    headers: { accept: 'application/json', authorization: `Bearer ${accessToken}` },
    fetch: (request) => send(new Request(request, { signal: AbortSignal.timeout(TIMEOUT_MS) })),
  });
}

export type DeclarationsClient = ReturnType<typeof declarationsClient>;
