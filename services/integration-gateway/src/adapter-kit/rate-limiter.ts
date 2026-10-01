import { Injectable, Logger } from '@nestjs/common';
import { errorType } from '@adili/api-kit';
import { InjectValkey } from '@adili/cache';
import type { Redis } from 'iovalkey';

import type { System } from '../db/schema.js';
import type { SystemPolicy } from './system-policies.js';

/**
 * A token bucket as GCRA (the theoretical arrival time of the next call, in ms) in one atomic
 * script, so every instance shares a system's bucket. A call that finds the bucket empty takes
 * the next free slot and is told how long to wait for it, unless that is longer than the max
 * wait: then it takes nothing and gets -1. Time comes from the Valkey server, so instances with
 * skewed clocks agree.
 */
const RESERVE = `
local interval = tonumber(ARGV[1])
local tolerance = tonumber(ARGV[2])
local max_wait = tonumber(ARGV[3])
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local tat = tonumber(redis.call('GET', KEYS[1]) or '0')
if tat < now then tat = now end
local wait = tat - tolerance - now
if wait < 0 then wait = 0 end
if wait > max_wait then return -1 end
local next_tat = tat + interval
redis.call('SET', KEYS[1], next_tat, 'PX', next_tat - now + 1000)
return wait
`;

/**
 * The per-system rate limit: calls to a registry queue for a slot rather than exceed it, up to
 * the policy's max wait. It protects the registry, so it fails open: when Valkey is down calls
 * go out unmetered (the circuit breaker still guards the registry).
 */
@Injectable()
export class RateLimiter {
  private readonly logger = new Logger(RateLimiter.name);

  constructor(@InjectValkey() private readonly valkey: Redis) {}

  /** Waits for a slot to call `system`. False when none frees up within the max wait. */
  async acquire(system: System, policy: SystemPolicy): Promise<boolean> {
    const interval = Math.max(1, Math.round(60_000 / policy.ratePerMinute));
    const burst = Math.max(1, Math.ceil(policy.ratePerMinute / 60));
    let wait: number;
    try {
      wait = (await this.valkey.eval(
        RESERVE,
        1,
        `rate:${system}`,
        interval,
        interval * (burst - 1),
        policy.maxQueueMs,
      )) as number;
    } catch (error) {
      this.logger.warn(
        { system, errorType: errorType(error) },
        'Rate limit unavailable; not metering',
      );
      return true;
    }
    if (wait < 0) return false;
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    return true;
  }
}
