import { env } from '../env.server';
import { mockableClient } from '../mockable-client.server';
import type { paths } from './schema.gen';

/**
 * Typed client for the declarations service, generated from
 * `packages/schemas/internal/declarations.yaml`, called as the signed-in declarant. With
 * DECLARATIONS_MOCK set in development it talks to the in-memory mock instead (`mock.server.ts`).
 */
export function declarationsClient(accessToken: string) {
  const config = env();
  return mockableClient<paths>({
    baseUrl: config.DECLARATIONS_API_URL,
    headers: { authorization: `Bearer ${accessToken}` },
    timeoutMs: 10_000,
    // Inline, so production builds drop the mock (see mockableClient).
    mock:
      import.meta.env.DEV && config.DECLARATIONS_MOCK
        ? async (request) => (await import('./mock.server')).mockDeclarationsFetch(request)
        : null,
  });
}

export type DeclarationsClient = ReturnType<typeof declarationsClient>;
