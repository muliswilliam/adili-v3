// Tick steps that divide into round numbers: 1, 2, 2.5 and 5 times a power of ten.
const NICE_STEPS = [1, 2, 2.5, 5, 10];

/** Drops float noise such as 0.30000000000000004. */
export function tidy(value: number): number {
  return Number(value.toPrecision(12));
}

function niceStep(rough: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = NICE_STEPS.find((candidate) => candidate * magnitude >= tidy(rough)) ?? 10;
  return tidy(step * magnitude);
}

export interface ChartAxis {
  max: number;
  /** From zero up to `max`, evenly spaced. */
  ticks: number[];
}

/**
 * The value axis. A given positive `max` (100 for rates) is split into four even steps;
 * otherwise the largest value is rounded up to at most four round-number steps
 * (91.2 → 0 to 100 by 25, 1234 → 0 to 1500 by 500).
 */
export function chartAxis(largest: number, max?: number): ChartAxis {
  if (max !== undefined && max > 0) {
    return { max, ticks: [0, 1, 2, 3, 4].map((step) => tidy((max * step) / 4)) };
  }
  const top = Number.isFinite(largest) && largest > 0 ? largest : 1;
  const step = niceStep(top / 4);
  const count = Math.ceil(tidy(top / step));
  return {
    max: tidy(step * count),
    ticks: Array.from({ length: count + 1 }, (_, index) => tidy(step * index)),
  };
}

export interface LinePoint {
  index: number;
  value: number;
}

/**
 * Splits a series into runs of consecutive values, so a line breaks where a value is null
 * (suppressed) or undefined (missing).
 */
export function lineSegments(values: readonly (number | null | undefined)[]): LinePoint[][] {
  const segments: LinePoint[][] = [];
  let current: LinePoint[] = [];
  values.forEach((value, index) => {
    if (value === null || value === undefined) {
      if (current.length > 0) segments.push(current);
      current = [];
    } else {
      current.push({ index, value });
    }
  });
  if (current.length > 0) segments.push(current);
  return segments;
}

/**
 * Which category labels to show on an axis of `count` categories: all of them up to `limit`,
 * otherwise every nth one counted back from the last, so the latest is always labelled. The step
 * spreads at most `limit` labels over the whole axis, leaving room for the right-aligned last one.
 */
export function labelledIndexes(count: number, limit: number): number[] {
  const step = count <= limit ? 1 : Math.ceil((count - 1) / (limit - 1));
  const indexes: number[] = [];
  for (let index = count - 1; index >= 0; index -= step) indexes.unshift(index);
  return indexes;
}
