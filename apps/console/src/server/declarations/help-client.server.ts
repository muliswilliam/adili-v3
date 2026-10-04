import { env } from '../env.server';
import { createDeclarationsClient, type DeclarationsClient } from './client';

/**
 * A declarations client for the help pages, called as the signed-in user. With HELP_MOCK set in
 * development it talks to the in-memory mock of the help endpoints instead
 * (`help-mock.server.ts`).
 */
export function helpClient(accessToken: string): DeclarationsClient {
  const config = env();
  return createDeclarationsClient({
    baseUrl: config.DECLARATIONS_API_URL,
    accessToken,
    // Inline, so production builds drop the mock (see mockableClient).
    mock:
      import.meta.env.DEV && config.HELP_MOCK
        ? async (request) => (await import('./help-mock.server')).mockHelpFetch(request)
        : null,
  });
}
