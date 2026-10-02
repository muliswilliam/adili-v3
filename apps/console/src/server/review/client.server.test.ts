import { describe, expect, it } from 'vitest';

import { REVIEW_TIMEOUTS_MS, reviewTimeoutMs } from './client.server';

describe('reviewTimeoutMs', () => {
  it('outlasts the review wait for an AI draft (M5)', () => {
    const timeout = reviewTimeoutMs('POST', '/v1/review/cases/c-1/copilot/drafts');
    // Review waits 10 s for the gateway after pulling the declaration; the gateway allows 12 s.
    expect(timeout).toBeGreaterThan(12_000);
    expect(timeout).toBe(REVIEW_TIMEOUTS_MS.aiDraft);
  });

  it.each([
    ['GET', '/v1/review/copilot/drafts/d-1'],
    ['GET', '/v1/review/cases/c-1/copilot'],
    ['POST', '/v1/review/cases/c-1/copilot/refresh'],
    ['POST', '/v1/review/cases/c-1/clarifications'],
  ])('keeps the default for %s %s', (method, path) => {
    expect(reviewTimeoutMs(method, path)).toBe(REVIEW_TIMEOUTS_MS.default);
  });
});
