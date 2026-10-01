import type { Usage } from '../providers/port.js';

/** List prices in USD per million tokens. */
interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
  /** Five-minute cache writes, the kind the adapters make. */
  cacheWrite: number;
}

/**
 * Anthropic list prices (first-party API, 2026-09). A model missing here costs 0, and a
 * self-hosted model has no per-token price. Replayed jobs are priced as the model they replay,
 * so budgets and usage behave in tests and the demo as they would in production.
 */
const PRICES: Readonly<Record<string, ModelPrice>> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
};

/** Estimated cost of one call in micro-USD at list price (USD per MTok = micro-USD per token). */
export function costMicros(model: string, usage: Usage): number {
  const price = PRICES[model];
  if (!price) return 0;
  return Math.round(
    usage.inputTokens * price.input +
      usage.outputTokens * price.output +
      usage.cacheReadTokens * price.cacheRead +
      usage.cacheWriteTokens * price.cacheWrite,
  );
}
