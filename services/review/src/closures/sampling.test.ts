import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { inClosureSample, sampleBucket } from './sampling.js';

describe('closure sampling', () => {
  const ids = Array.from({ length: 20_000 }, () => randomUUID());

  it('puts the same case in or out every time for the same cycle', () => {
    for (const id of ids.slice(0, 500)) {
      expect(sampleBucket(id, 2027)).toBe(sampleBucket(id, 2027));
      expect(inClosureSample(id, 2027, 0.02)).toBe(inClosureSample(id, 2027, 0.02));
    }
  });

  it('draws a different sample for another cycle', () => {
    const in2027 = ids.filter((id) => inClosureSample(id, 2027, 0.02));
    const in2029 = ids.filter((id) => inClosureSample(id, 2029, 0.02));
    expect(in2027).not.toEqual(in2029);
  });

  it('diverts about the sample rate of cases', () => {
    const sampled = ids.filter((id) => inClosureSample(id, 2027, 0.02)).length;
    // 2% of 20,000 is 400; the binomial's standard deviation is about 20.
    expect(sampled).toBeGreaterThan(300);
    expect(sampled).toBeLessThan(500);
  });

  it('samples nothing at 0 and everything at 1', () => {
    expect(ids.some((id) => inClosureSample(id, 2027, 0))).toBe(false);
    expect(ids.every((id) => inClosureSample(id, 2027, 1))).toBe(true);
  });

  it('keeps a case sampled at a rate sampled at any higher rate', () => {
    for (const id of ids.slice(0, 2_000)) {
      if (inClosureSample(id, 2027, 0.02)) expect(inClosureSample(id, 2027, 0.1)).toBe(true);
    }
  });
});
