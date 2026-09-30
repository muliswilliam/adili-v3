import { env } from '../env.server';
import { mockableClient } from '../mockable-client.server';
import type { paths } from './schema.gen';

/** A typed directory client with these headers. */
function createDirectoryClient(headers: Record<string, string>) {
  const config = env();
  return mockableClient<paths>({
    baseUrl: config.DIRECTORY_API_URL,
    headers,
    timeoutMs: 5_000,
    // Local development and tests only: DIRECTORY_MOCK=true serves the directory from the
    // in-memory mock until it implements spec 03 (#67). The mock trusts bearer tokens without
    // checking their signatures, so it must never ship; inline, so production builds drop it
    // (see mockableClient).
    mock:
      import.meta.env.DEV && config.DIRECTORY_MOCK
        ? async (request) => (await import('./mock.server')).mockDirectoryFetch(request)
        : null,
  });
}

/**
 * Typed client for the directory's public onboarding endpoints, generated from
 * `packages/schemas/internal/directory.yaml`. These calls carry no access token; calls on a
 * session pass its secret in the X-Onboarding-Secret header.
 *
 * `clientIp` is the browser's address from `clientIp()` (../client-ip.ts), sent as the only
 * X-Forwarded-For entry, so the directory's per-IP rate limits apply to the declarant rather
 * than to the portal. Never pass a client-supplied header through.
 */
export function onboardingClient(clientIp?: string) {
  return createDirectoryClient(clientIp ? { 'x-forwarded-for': clientIp } : {});
}

export type OnboardingClient = ReturnType<typeof onboardingClient>;

/** Typed client for the directory's authenticated endpoints, called as the signed-in user. */
export function directoryClient(accessToken: string) {
  return createDirectoryClient({ authorization: `Bearer ${accessToken}` });
}

export type DirectoryClient = ReturnType<typeof directoryClient>;
