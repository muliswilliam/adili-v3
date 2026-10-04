import { mockableClient } from '@adili/api-kit/client';

import { env } from '../env.server';
import type { paths } from './schema.gen';

/**
 * Typed client for the review service's declarant endpoints, generated from
 * `packages/schemas/internal/review.yaml`, called as the signed-in declarant. With REVIEW_MOCK
 * set in development it talks to the in-memory mock instead (`mock.server.ts`).
 */
export function reviewClient(accessToken: string) {
  const config = env();
  return mockableClient<paths>({
    baseUrl: config.REVIEW_API_URL,
    headers: { authorization: `Bearer ${accessToken}` },
    timeoutMs: 10_000,
    // Inline, so production builds drop the mock (see mockableClient).
    mock:
      import.meta.env.DEV && config.REVIEW_MOCK
        ? async (request) =>
            (await import('./mock.server')).mockReviewFetch(request, {
              salary: config.REVIEW_MOCK_SALARY,
            })
        : null,
  });
}

export type ReviewClient = ReturnType<typeof reviewClient>;
