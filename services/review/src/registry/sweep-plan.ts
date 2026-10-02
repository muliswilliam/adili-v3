import type { RegistryCheckRequest, SweepCheck } from './contract.js';

/**
 * How much of each system's rate limit the sweep takes: the rest is for the registry checks of
 * new submissions and re-checks, which run at the same time.
 */
export const SWEEP_RATE_SHARE = 0.5;

/**
 * How long into its run the sweep may start a check. Checks started late still wait out their
 * retries (35 seconds at most) and end well within the hour, before the next run.
 */
export const SWEEP_WINDOW_MINUTES = 45;

/** A case the sweep may check, with the calls its check sends each system (gateway names). */
export interface SweepCandidate {
  request: RegistryCheckRequest;
  /**
   * Registry calls per system, as the gateway's rate limits count them: those of the case's
   * unavailable lookups (a KRA lookup is two); the answered ones come from the cache.
   */
  calls: Readonly<Record<string, number>>;
}

/**
 * Paces the sweep under the systems' rate limits (spec 07b, "bounded per run by the rate
 * limits"): the cases in the order given (oldest check first), each starting once every system
 * it looks up has had room, at `share` of its rate, for the calls of the cases before it. A case
 * that could not start within `windowMinutes` ends the run's plan: it and the rest wait for the
 * next run, still oldest first. A system without a known limit does not hold a case back.
 */
export function planSweep(
  candidates: readonly SweepCandidate[],
  ratePerMinute: Readonly<Record<string, number>>,
  { share = SWEEP_RATE_SHARE, windowMinutes = SWEEP_WINDOW_MINUTES } = {},
): SweepCheck[] {
  const sent: Record<string, number> = {};
  const plan: SweepCheck[] = [];
  for (const { request, calls } of candidates) {
    const startMinutes = Math.max(
      0,
      ...Object.entries(calls).map(([system, count]) => {
        const rate = ratePerMinute[system];
        return count > 0 && rate !== undefined ? (sent[system] ?? 0) / (rate * share) : 0;
      }),
    );
    if (startMinutes >= windowMinutes) break;
    plan.push({ request, startAfterMs: Math.ceil(startMinutes * 60_000) });
    for (const [system, count] of Object.entries(calls)) {
      sent[system] = (sent[system] ?? 0) + count;
    }
  }
  return plan;
}
