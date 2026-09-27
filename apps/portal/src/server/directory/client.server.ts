import createClient from 'openapi-fetch';

import { env } from '../env.server';
import { mockDirectoryFetch } from './mock.server';
import type { paths } from './schema.gen';

const TIMEOUT_MS = 5_000;

/** A typed directory client with these headers, served by the mock when DIRECTORY_MOCK is set. */
function createDirectoryClient(headers: Record<string, string>) {
  const config = env();
  const send = config.DIRECTORY_MOCK ? mockDirectoryFetch : fetch;
  return createClient<paths>({
    baseUrl: config.DIRECTORY_API_URL,
    headers: { accept: 'application/json', ...headers },
    fetch: (request) => send(new Request(request, { signal: AbortSignal.timeout(TIMEOUT_MS) })),
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
