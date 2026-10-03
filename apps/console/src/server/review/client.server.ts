import { mockableClient } from '@adili/api-kit/client';

import { env } from '../env.server';
import type { paths } from './api.gen';

/**
 * How long the console waits for the review service, by kind of call. Review bounds its own reads
 * of other services so that it always answers first, the case without its declaration or the
 * Registry tab's 502 with the last statuses, within 8 seconds at worst
 * (`services/review/src/internal-api/view-budget.ts`, ADR-013 §2); waiting less than that turned a
 * slow declarations service into "could not load this case". Drafting a clarification with AI
 * holds the request while review pulls the declaration and waits up to 10 s for the ai-gateway
 * (which itself allows the call 12 s), so the console allows it well past that: giving up first
 * would show "AI service unavailable" for a draft still being written. A retry after a timeout
 * reuses the Idempotency-Key, so it answers the same draft. A bulk closure approval holds the
 * request while review approves every chunk of 100 in turn; past two minutes the screen shows it
 * stopped, and Resume sends the same key, which carries on where the chunks got to.
 */
export const REVIEW_TIMEOUTS_MS = {
  default: 15_000,
  aiDraft: 25_000,
  bulkApproval: 120_000,
} as const;

/** The timeout of one review call, from its method and path. */
export function reviewTimeoutMs(method: string, path: string): number {
  if (method === 'POST' && /\/v1\/review\/cases\/[^/]+\/copilot\/drafts$/.test(path)) {
    return REVIEW_TIMEOUTS_MS.aiDraft;
  }
  if (method === 'POST' && /^\/v1\/commissions\/[^/]+\/closures$/.test(path)) {
    return REVIEW_TIMEOUTS_MS.bulkApproval;
  }
  return REVIEW_TIMEOUTS_MS.default;
}

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
    timeoutMs: (request) => reviewTimeoutMs(request.method, new URL(request.url).pathname),
    // Inline, so production builds drop the mock (see mockableClient).
    mock:
      import.meta.env.DEV && config.REVIEW_MOCK
        ? async (request) => (await import('./mock.server')).mockReviewFetch(request)
        : null,
  });
}

export type ReviewClient = ReturnType<typeof reviewClient>;
