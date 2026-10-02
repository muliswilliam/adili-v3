import { mockableClient } from '@adili/api-kit/client';

import { env } from '../env.server';
import type { paths } from './api.gen';

/**
 * How long the console waits for review. Review bounds its own reads of other services so that
 * it always answers first, the case without its declaration or the Registry tab's 502 with the
 * last statuses, within 8 seconds at worst (`services/review/src/internal-api/view-budget.ts`,
 * ADR-013 §2). Waiting less than that turned a slow declarations service into "could not load
 * this case".
 */
export const REVIEW_TIMEOUT_MS = 15_000;

/**
 * Typed client for the review service, generated from `packages/schemas/internal/review.yaml`,
 * called as the signed-in reviewer or supervisor. With REVIEW_MOCK set in development it talks
 * to the in-memory mock instead (`mock.server.ts`).
 */
export function reviewClient(accessToken: string) {
  const config = env();
  return mockableClient<paths>({
    baseUrl: config.REVIEW_API_URL,
    headers: { authorization: `Bearer ${accessToken}` },
    timeoutMs: REVIEW_TIMEOUT_MS,
    // Inline, so production builds drop the mock (see mockableClient).
    mock:
      import.meta.env.DEV && config.REVIEW_MOCK
        ? async (request) => (await import('./mock.server')).mockReviewFetch(request)
        : null,
  });
}

export type ReviewClient = ReturnType<typeof reviewClient>;
