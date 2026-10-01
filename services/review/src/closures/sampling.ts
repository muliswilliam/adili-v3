import { createHash } from 'node:crypto';

/** Buckets a case hashes into; the sample is the buckets below `rate` of them. */
export const SAMPLE_BUCKETS = 10_000;

/**
 * The bucket of a case for a cycle, 0 to 9,999: the first four bytes of SHA-256 of
 * `<caseId>:<cycleYear>`, modulo 10,000. The cycle year is the seed, so a case is always in or
 * always out of a cycle's sample, whenever and however often the sweep runs.
 */
export function sampleBucket(caseId: string, cycleYear: number): number {
  const digest = createHash('sha256')
    .update(`${caseId}:${String(cycleYear)}`)
    .digest();
  return digest.readUInt32BE(0) % SAMPLE_BUCKETS;
}

/**
 * Whether the closure sweep diverts a case to a reviewer instead of proposing its closure (spec
 * 08): `hash(caseId, cycleYear) mod 10000 < rate * 10000`, `rate` a fraction (0.02 is 2%).
 */
export function inClosureSample(caseId: string, cycleYear: number, rate: number): boolean {
  return sampleBucket(caseId, cycleYear) < Math.round(rate * SAMPLE_BUCKETS);
}
