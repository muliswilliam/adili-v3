import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMockClock } from './mock-clock.js';

const SEEDED = Date.parse('2026-09-28T09:00:00Z');

afterEach(() => {
  vi.useRealTimers();
});

describe('createMockClock', () => {
  it('reads the wall clock until it is started', () => {
    vi.useFakeTimers({ toFake: ['Date'], now: SEEDED });
    expect(createMockClock().now()).toBe(SEEDED);
  });

  it('runs from the instant it was started at, as the wall clock moves on', () => {
    vi.useFakeTimers({ toFake: ['Date'], now: SEEDED + 30 * 86_400_000 });
    const clock = createMockClock();
    clock.startAt(SEEDED);
    expect(clock.now()).toBe(SEEDED);
    vi.setSystemTime(Date.now() + 1_500);
    expect(clock.now()).toBe(SEEDED + 1_500);
  });

  it('keeps each clock to itself', () => {
    vi.useFakeTimers({ toFake: ['Date'], now: SEEDED + 86_400_000 });
    const one = createMockClock();
    const other = createMockClock();
    one.startAt(SEEDED);
    expect(other.now()).toBe(SEEDED + 86_400_000);
  });
});
