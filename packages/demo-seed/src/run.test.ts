import { describe, expect, it } from 'vitest';

import { selectSteps } from './run.js';
import type { SeedStep } from './step.js';

const step = (id: string): SeedStep => ({
  id,
  title: id,
  run: () => Promise.resolve({ changed: 0 }),
});
const steps = [step('a'), step('b'), step('c')];

describe('selectSteps', () => {
  it('runs every step in order by default', () => {
    expect(selectSteps(steps, {}).map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('runs from a step, or only the steps named, still in order', () => {
    expect(selectSteps(steps, { from: 'b' }).map((s) => s.id)).toEqual(['b', 'c']);
    expect(selectSteps(steps, { only: ['c', 'a'] }).map((s) => s.id)).toEqual(['a', 'c']);
  });

  it('refuses a step it does not know rather than doing nothing', () => {
    expect(() => selectSteps(steps, { only: ['z'] })).toThrow(/Unknown seed step "z"/);
    expect(() => selectSteps(steps, { from: 'z' })).toThrow(/Unknown seed step "z"/);
  });
});
