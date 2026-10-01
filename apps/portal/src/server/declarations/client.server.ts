import { mockableClient } from '@adili/api-kit/client';

import { env } from '../env.server';
import type { paths } from './schema.gen';

/**
 * Typed client for the declarations service, generated from
 * `packages/schemas/internal/declarations.yaml`, called as the signed-in declarant. With
 * OBLIGATIONS_MOCK or DECLARATIONS_MOCK set in development, the in-memory mock answers
 * that part (`mock.server.ts`) and the real service the rest.
 */
export function declarationsClient(accessToken: string) {
  const config = env();
  return mockableClient<paths>({
    baseUrl: config.DECLARATIONS_API_URL,
    headers: { authorization: `Bearer ${accessToken}` },
    timeoutMs: 10_000,
    // Inline, so production builds drop the mock (see mockableClient).
    mock:
      import.meta.env.DEV && (config.OBLIGATIONS_MOCK || config.DECLARATIONS_MOCK)
        ? async (request, init) =>
            (await import('./mock.server')).declarationsMock({
              obligations: config.OBLIGATIONS_MOCK,
              declarations: config.DECLARATIONS_MOCK,
            })(request, init)
        : null,
  });
}

export type DeclarationsClient = ReturnType<typeof declarationsClient>;
