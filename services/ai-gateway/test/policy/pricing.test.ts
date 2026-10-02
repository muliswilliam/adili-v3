import { describe, expect, it } from 'vitest';

import { costMicros } from '../../src/policy/pricing.js';
import { currentMonth } from '../../src/policy/budgets.js';

describe('costMicros', () => {
  it('prices every kind of token at list price, in micro-USD', () => {
    // 1000 in at $4, 500 out at $20, 2000 cache reads at $0.20, 100 cache writes at $5 per MTok.
    expect(
      costMicros('claude-opus-5-5', {
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 2000,
        cacheWriteTokens: 100,
      }),
    ).toBe(4000 + 10_000 + 400 + 500);
  });

  it('has no cost for a model without a list price', () => {
    expect(
      costMicros('llama-local', {
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      }),
    ).toBeUndefined();
  });
});

describe('currentMonth', () => {
  it('is the calendar month in Nairobi', () => {
    // 22:30 UTC on 31 October is 01:30 on 1 November in Nairobi (UTC+3).
    expect(currentMonth(new Date('2026-10-31T22:30:00Z'))).toBe('2026-11');
    expect(currentMonth(new Date('2026-10-31T20:30:00Z'))).toBe('2026-10');
  });
});
