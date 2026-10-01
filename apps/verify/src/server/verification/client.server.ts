import { mockableClient } from '@adili/api-kit/client';

import { env } from '../env.server';
import type { paths } from './schema.gen';

/**
 * Typed client for verification-api, generated from
 * `packages/schemas/internal/verification-api.yaml`. `clientIp` is the browser's address, sent
 * as the only X-Forwarded-For entry so the API's per-IP rate limit applies to the visitor
 * rather than to this server. Mocked under VERIFICATION_MOCK.
 */
export function verificationClient(clientIp?: string) {
  const config = env();
  return mockableClient<paths>({
    baseUrl: config.VERIFICATION_API_URL,
    headers: clientIp ? { 'x-forwarded-for': clientIp } : {},
    // Short: a visitor on a slow connection is already waiting for this page.
    timeoutMs: 5_000,
    // Inline, so production builds drop the mock (see mockableClient).
    mock:
      import.meta.env.DEV && config.VERIFICATION_MOCK
        ? async (request) => (await import('./mock.server')).mockVerificationFetch(request)
        : null,
  });
}

export type VerificationClient = ReturnType<typeof verificationClient>;
