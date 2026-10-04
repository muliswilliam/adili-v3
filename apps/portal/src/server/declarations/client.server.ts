import { mockableClient } from '@adili/api-kit/client';

import { env } from '../env.server';
import type { paths } from './schema.gen';

/**
 * Typed client for the declarations service, generated from
 * `packages/schemas/internal/declarations.yaml`, called as the signed-in declarant. With
 * OBLIGATIONS_MOCK, DECLARATIONS_MOCK or ASSISTANT_MOCK set in development, the in-memory mock answers
 * that part (`mock.server.ts`) and the real service the rest.
 */
/** A streamed Ask Adili answer may run past the service's 55 s gateway deadline. */
const ANSWER_TIMEOUT_MS = 90_000;

export function declarationsClient(accessToken: string) {
  const config = env();
  return mockableClient<paths>({
    baseUrl: config.DECLARATIONS_API_URL,
    headers: { authorization: `Bearer ${accessToken}` },
    // An Ask Adili answer streams for longer than any other call takes.
    timeoutMs: (request) =>
      request.headers.get('accept') === 'text/event-stream' ? ANSWER_TIMEOUT_MS : 10_000,
    // Inline, so production builds drop the mock (see mockableClient).
    mock:
      import.meta.env.DEV &&
      (config.OBLIGATIONS_MOCK || config.DECLARATIONS_MOCK || config.ASSISTANT_MOCK)
        ? async (request, init) =>
            (await import('./mock.server')).declarationsMock({
              obligations: config.OBLIGATIONS_MOCK,
              declarations: config.DECLARATIONS_MOCK,
              assistant: config.ASSISTANT_MOCK,
              assistantMode: config.ASSISTANT_MOCK_MODE,
            })(request, init)
        : null,
  });
}

export type DeclarationsClient = ReturnType<typeof declarationsClient>;
