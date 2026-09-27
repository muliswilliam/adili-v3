import createClient from 'openapi-fetch';

import { env } from '../env.server';
import { mockDirectoryFetch } from './mock.server';
import type { paths } from './schema.gen';

const TIMEOUT_MS = 5_000;

/**
 * Typed client for the directory's public onboarding endpoints, generated from
 * `packages/schemas/internal/directory.yaml`. These calls carry no access token; calls on a
 * session pass its secret in the X-Onboarding-Secret header.
 *
 * `clientIp` is the browser's address, so the directory's per-IP rate limits apply to the
 * declarant rather than to the portal.
 */
export function onboardingClient(clientIp?: string) {
  const config = env();
  const send = config.DIRECTORY_MOCK ? mockDirectoryFetch : fetch;
  const headers: Record<string, string> = { accept: 'application/json' };
  if (clientIp) headers['x-forwarded-for'] = clientIp;
  return createClient<paths>({
    baseUrl: config.DIRECTORY_API_URL,
    headers,
    fetch: (request) => send(new Request(request, { signal: AbortSignal.timeout(TIMEOUT_MS) })),
  });
}

export type OnboardingClient = ReturnType<typeof onboardingClient>;

/** Typed client for the directory's authenticated endpoints, called as the signed-in user. */
export function directoryClient(accessToken: string) {
  const config = env();
  const send = config.DIRECTORY_MOCK ? mockDirectoryFetch : fetch;
  return createClient<paths>({
    baseUrl: config.DIRECTORY_API_URL,
    headers: { accept: 'application/json', authorization: `Bearer ${accessToken}` },
    fetch: (request) => send(new Request(request, { signal: AbortSignal.timeout(TIMEOUT_MS) })),
  });
}

export type DirectoryClient = ReturnType<typeof directoryClient>;
