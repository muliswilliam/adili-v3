import { describe, expect, it } from 'vitest';

import {
  chartAxis,
  isPlotted,
  labelledIndexes,
  lineSegments,
  roundFloatNoise,
  valueState,
} from './chart-scale';

describe('chartAxis', () => {
  it.each([
    [91.2, 100, [0, 25, 50, 75, 100]],
    [100, 100, [0, 25, 50, 75, 100]],
    [7, 8, [0, 2, 4, 6, 8]],
    [0.34, 0.4, [0, 0.1, 0.2, 0.3, 0.4]],
    [1234, 1500, [0, 500, 1000, 1500]],
    [42, 60, [0, 20, 40, 60]],
  ])('rounds %s up to %s with round-number ticks', (largest, max, ticks) => {
    expect(chartAxis(largest)).toEqual({ max, ticks });
  });

  it('falls back to 0 to 1 when there is nothing to plot', () => {
    expect(chartAxis(0)).toEqual({ max: 1, ticks: [0, 0.25, 0.5, 0.75, 1] });
    expect(chartAxis(Number.NaN).max).toBe(1);
  });

  it('splits a given maximum into four even steps', () => {
    expect(chartAxis(91.2, 100)).toEqual({ max: 100, ticks: [0, 25, 50, 75, 100] });
  });

  it('ignores a maximum that is not positive', () => {
    expect(chartAxis(91.2, 0).max).toBe(100);
  });
});

describe('roundFloatNoise', () => {
  it('drops float noise', () => {
    expect(roundFloatNoise(0.1 + 0.2)).toBe(0.3);
    expect(roundFloatNoise((1 - 0.7) * 100)).toBe(30);
  });
});

describe('valueState', () => {
  it('tells a value from a suppressed or missing one', () => {
    expect(valueState(0)).toBe('value');
    expect(valueState(91.2)).toBe('value');
    expect(valueState(null)).toBe('suppressed');
    expect(valueState(undefined)).toBe('missing');
  });

  it('counts a number that is not finite as missing', () => {
    expect([NaN, Infinity, -Infinity].map(valueState)).toEqual(['missing', 'missing', 'missing']);
  });
});

describe('isPlotted', () => {
  it('plots numbers only', () => {
    expect([0, 4, null, undefined, NaN].map(isPlotted)).toEqual([true, true, false, false, false]);
  });
});

describe('lineSegments', () => {
  it('breaks the line at null values instead of plotting them', () => {
    expect(lineSegments([1, 2, null, 4, 5, null, 7])).toEqual([
      [
        { index: 0, value: 1 },
        { index: 1, value: 2 },
      ],
      [
        { index: 3, value: 4 },
        { index: 4, value: 5 },
      ],
      [{ index: 6, value: 7 }],
    ]);
  });

  it('returns no segments when every value is null', () => {
    expect(lineSegments([null, null])).toEqual([]);
  });

  it('breaks the line at missing values too', () => {
    expect(lineSegments([1, undefined, 3])).toEqual([
      [{ index: 0, value: 1 }],
      [{ index: 2, value: 3 }],
    ]);
  });
});

describe('labelledIndexes', () => {
  it('labels every category when there are few', () => {
    expect(labelledIndexes(4, 4)).toEqual([0, 1, 2, 3]);
  });

  it('keeps at most the limit, evenly spaced and always including the last', () => {
    expect(labelledIndexes(12, 4)).toEqual([3, 7, 11]);
    expect(labelledIndexes(9, 4)).toEqual([2, 5, 8]);
    expect(labelledIndexes(7, 4)).toEqual([0, 2, 4, 6]);
  });

  it('labels only the last category when the limit is 1, and none below that', () => {
    expect(labelledIndexes(12, 1)).toEqual([11]);
    expect(labelledIndexes(1, 1)).toEqual([0]);
    expect(labelledIndexes(12, 0)).toEqual([]);
    expect(labelledIndexes(12, -3)).toEqual([]);
  });

  it('labels nothing when there is no data', () => {
    expect(labelledIndexes(0, 5)).toEqual([]);
  });
});
