import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SLOWEST_VIEW_MS,
  VIEW_DECLARATIONS_BUDGET_MS,
  VIEW_REGISTRY_RECORDS_BUDGET_MS,
  within,
} from './view-budget.js';

/** What the console waits for review (apps/console/src/server/review/client.server.ts). */
const CONSOLE_WAITS_MS = 15_000;

describe('within', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('gives the answer that comes in time', async () => {
    await expect(
      within(
        1_000,
        () => Promise.resolve('document'),
        () => new Error('late'),
      ),
    ).resolves.toBe('document');
  });

  it('gives up at the deadline on work that hangs', async () => {
    const answer = within(
      1_000,
      () => new Promise<never>(() => undefined),
      () => new Error('late'),
    );
    const outcome = expect(answer).rejects.toThrow('late');

    await vi.advanceTimersByTimeAsync(999);
    let settled = false;
    void answer.catch(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await outcome;
  });

  it('passes on a failure that comes in time, and ignores one after the deadline', async () => {
    await expect(
      within(
        1_000,
        () => Promise.reject(new Error('refused')),
        () => new Error('late'),
      ),
    ).rejects.toThrow('refused');

    const late = within(
      1_000,
      () =>
        new Promise<never>((_, reject) =>
          setTimeout(() => {
            reject(new Error('refused late'));
          }, 2_000),
        ),
      () => new Error('late'),
    );
    const outcome = expect(late).rejects.toThrow('late');
    await vi.advanceTimersByTimeAsync(2_000);
    await outcome;
  });
});

describe('view budgets', () => {
  it("keep review's slowest read clearly inside what the console waits", () => {
    expect(SLOWEST_VIEW_MS).toBe(VIEW_DECLARATIONS_BUDGET_MS + VIEW_REGISTRY_RECORDS_BUDGET_MS);
    expect(CONSOLE_WAITS_MS - SLOWEST_VIEW_MS).toBeGreaterThanOrEqual(5_000);
  });
});
