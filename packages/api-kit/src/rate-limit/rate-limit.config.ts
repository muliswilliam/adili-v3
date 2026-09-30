import { z } from 'zod';

import type { RateLimitPolicy } from './rate-limit.store.js';

const ENTRY = /^(?<group>[a-z0-9][a-z0-9-]*)=(?<limit>\d+)\/(?<window>\d+)s$/;

/**
 * Rate limits per route group as one environment variable: comma-separated
 * `<group>=<limit>/<window seconds>s` entries, e.g. `roster-api=120/60s,roster-batch=10/60s`
 * (at most 120 requests in any minute). Parses to `RateLimitModule`'s `policies`.
 *
 * @example
 * RATE_LIMITS: rateLimitsSchema.prefault('roster-api=120/60s'),
 */
export const rateLimitsSchema = z.string().transform((value, context) => {
  const groups: Record<string, RateLimitPolicy> = {};
  for (const entry of value.split(',').map((part) => part.trim())) {
    if (entry === '') continue;
    const match = ENTRY.exec(entry)?.groups;
    const limit = Number(match?.limit);
    const windowSeconds = Number(match?.window);
    if (!match?.group || limit < 1 || windowSeconds < 1) {
      context.addIssue({
        code: 'custom',
        message: `"${entry}" is not <group>=<limit>/<seconds>s with positive numbers, e.g. roster-api=120/60s`,
      });
      return z.NEVER;
    }
    if (match.group in groups) {
      context.addIssue({
        code: 'custom',
        message: `Rate limit group "${match.group}" is repeated`,
      });
      return z.NEVER;
    }
    groups[match.group] = { limit, windowSeconds };
  }
  return groups;
});
