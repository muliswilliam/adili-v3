import type { Severity } from './registry.js';

const WEIGHTS: Record<Severity, number> = { info: 0, low: 1, medium: 3, high: 7 };

/** The queue score: a weighted sum of the flags' severities. It orders the queue and nothing else. */
export function score(flags: readonly { severity: Severity }[]): number {
  return flags.reduce((sum, flag) => sum + WEIGHTS[flag.severity], 0);
}

/** review.yaml `PriorityBand`, lowest first. */
export const BANDS = ['low', 'medium', 'high'] as const;
export type Band = (typeof BANDS)[number];

/** The priority band a score falls in: low under 3, medium 3 to 9, high 10 and above. */
export function band(value: number): Band {
  if (value >= 10) return 'high';
  return value >= 3 ? 'medium' : 'low';
}
