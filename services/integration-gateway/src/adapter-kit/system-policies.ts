import type { System } from '../db/schema.js';

export const SYSTEM_POLICIES = Symbol('SYSTEM_POLICIES');

/** How the kit treats one registry. Configuration, so load can be tuned with the registry. */
export interface SystemPolicy {
  /** Longest wait for one answer (every call the adapter makes for it). */
  timeoutMs: number;
  /** How long an answer (found or not found) is reused. */
  cacheTtlSeconds: number;
  /** Calls per minute sent to the registry across every instance; one second's worth may burst. */
  ratePerMinute: number;
  /** Longest a lookup queues for the rate limit before it is answered `rate-limited`. */
  maxQueueMs: number;
}

/** The policy of every system that has an adapter. */
export type SystemPolicies = Partial<Record<System, SystemPolicy>>;

export function policyOf(policies: SystemPolicies, system: System): SystemPolicy {
  const policy = policies[system];
  if (!policy) throw new Error(`No policy configured for ${system}`);
  return policy;
}
