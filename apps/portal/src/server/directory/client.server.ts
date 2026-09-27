import createClient from 'openapi-fetch';

import { env } from '../env.server';
import type { paths } from './schema.gen';

const TIMEOUT_MS = 5_000;

/**
 * The in-memory directory (./mock.server.ts), loaded on first use. It trusts bearer tokens
 * without checking their signatures, so it must never ship: see `createDirectoryClient`.
 */
async function mockFetch(request: Request): Promise<Response> {
  const { mockDirectoryFetch } = await import('./mock.server');
  return mockDirectoryFetch(request);
}

/** A typed directory client with these headers. */
function createDirectoryClient(headers: Record<string, string>) {
  const config = env();
  // Local development and tests only: DIRECTORY_MOCK=true serves the directory from the mock
  // until it implements spec 03 (#67). `import.meta.env.DEV` is `false` in production builds,
  // so the bundler drops this branch and the mock's chunk with it; keep the check inline here
  // for that to work. The NODE_ENV check keeps the mock off even if a dev build were started
  // with production settings.
  const send =
    import.meta.env.DEV && process.env.NODE_ENV !== 'production' && config.DIRECTORY_MOCK
      ? mockFetch
      : fetch;
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
