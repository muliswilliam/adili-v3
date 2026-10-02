import { Injectable, Logger } from '@nestjs/common';
import { errorType } from '@adili/api-kit';
import { InjectValkey } from '@adili/cache';
import type { Redis } from 'iovalkey';

import type { System } from '../db/schema.js';
import type { SystemPolicy } from './system-policies.js';

/**
 * A token bucket as GCRA (the theoretical arrival time of the next call, in ms) in one atomic
 * script, so every instance shares a system's bucket. A reservation of `cost` calls takes them
 * all at once: when the bucket lacks room it takes the next free slots and is told how long to
 * wait for them, unless that is longer than the max wait: then it takes nothing and gets -1. A
 * negative max wait is a charge: it takes the calls whatever the bucket holds and never waits.
 * Time comes from the Valkey server, so instances with skewed clocks agree.
 */
const RESERVE = `
local interval = tonumber(ARGV[1])
local burst = tonumber(ARGV[2])
local cost = tonumber(ARGV[3])
local max_wait = tonumber(ARGV[4])
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local tat = tonumber(redis.call('GET', KEYS[1]) or '0')
if tat < now then tat = now end
local next_tat = tat + cost * interval
local wait = 0
if max_wait >= 0 then
  wait = next_tat - burst * interval - now
  if wait < 0 then wait = 0 end
  if wait > max_wait then return -1 end
end
redis.call('SET', KEYS[1], next_tat, 'PX', next_tat - now + 1000)
return wait
`;

/**
 * The per-system rate limit: calls to a registry queue for slots rather than exceed it, up to
 * the policy's max wait. It protects the registry, so it fails open: when Valkey is down calls
 * go out unmetered (the circuit breaker still guards the registry).
 */
@Injectable()
export class RateLimiter {
  private readonly logger = new Logger(RateLimiter.name);

  constructor(@InjectValkey() private readonly valkey: Redis) {}

  /**
   * Waits for `calls` slots to call `system`, taken together so a lookup never holds some of its
   * calls' slots and queues for the rest. False when they do not free up within the max wait.
   */
  async reserve(system: System, policy: SystemPolicy, calls: number): Promise<boolean> {
    const wait = await this.take(system, policy, calls, policy.maxQueueMs);
    if (wait < 0) return false;
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    return true;
  }

  /**
   * Charges `calls` the lookup is already making (beyond those it reserved) to `system`'s
   * bucket, without waiting or refusing: later lookups queue for them instead.
   */
  async charge(system: System, policy: SystemPolicy, calls: number): Promise<void> {
    if (calls > 0) await this.take(system, policy, calls, -1);
  }

  private async take(
    system: System,
    policy: SystemPolicy,
    calls: number,
    maxWaitMs: number,
  ): Promise<number> {
    const interval = Math.max(1, Math.round(60_000 / policy.ratePerMinute));
    try {
      return (await this.valkey.eval(
        RESERVE,
        1,
        `rate:${system}`,
        interval,
        policy.burst,
        calls,
        maxWaitMs,
      )) as number;
    } catch (error) {
      this.logger.warn(
        { system, errorType: errorType(error) },
        'Rate limit unavailable; not metering',
      );
      return 0;
    }
  }
}
