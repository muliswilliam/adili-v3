import { describe, expect, it } from 'vitest';

import { maxWorkers } from './workers.js';

const underTurbo = { TURBO_HASH: 'abc123' };

describe('maxWorkers', () => {
  it("keeps Vitest's default outside Turborepo", () => {
    expect(maxWorkers({}, 14)).toBe(undefined);
    expect(maxWorkers({ TURBO_CONCURRENCY: '2' }, 14)).toBe(undefined);
  });

  it("splits the cores between Turborepo's default 10 tasks", () => {
    expect(maxWorkers(underTurbo, 14)).toBe(1);
    expect(maxWorkers(underTurbo, 32)).toBe(3);
  });

  it('splits the cores between TURBO_CONCURRENCY tasks', () => {
    expect(maxWorkers({ ...underTurbo, TURBO_CONCURRENCY: '2' }, 4)).toBe(2);
    expect(maxWorkers({ ...underTurbo, TURBO_CONCURRENCY: '2' }, 2)).toBe(1);
    expect(maxWorkers({ ...underTurbo, TURBO_CONCURRENCY: '1' }, 14)).toBe(14);
  });

  it('reads a TURBO_CONCURRENCY percentage of the cores', () => {
    expect(maxWorkers({ ...underTurbo, TURBO_CONCURRENCY: '50%' }, 16)).toBe(2);
    expect(maxWorkers({ ...underTurbo, TURBO_CONCURRENCY: '1%' }, 4)).toBe(4);
  });

  it('never goes below one worker', () => {
    expect(maxWorkers({ ...underTurbo, TURBO_CONCURRENCY: '64' }, 14)).toBe(1);
    expect(maxWorkers(underTurbo, 1)).toBe(1);
  });

  it("falls back to Turborepo's default on a value it cannot read", () => {
    expect(maxWorkers({ ...underTurbo, TURBO_CONCURRENCY: 'many' }, 20)).toBe(2);
    expect(maxWorkers({ ...underTurbo, TURBO_CONCURRENCY: '' }, 20)).toBe(2);
  });
});
