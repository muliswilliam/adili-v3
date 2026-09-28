import { Injectable } from '@nestjs/common';
import {
  type ConsumeOptions,
  type RateLimitDecision,
  type RateLimitPolicy,
  RateLimitStore,
} from '@adili/api-kit';
import type { Redis } from 'iovalkey';

import { InjectValkey } from './cache.module.js';

/**
 * `takeToken` from `@adili/api-kit` as one atomic script (with its `TOKEN_EPSILON`). Time comes from the Valkey server, so
 * replicas with skewed clocks share buckets correctly, unless the caller passes its own (tests,
 * through `RATE_LIMIT_CLOCK`). A bucket expires once it would be full again, which is the same
 * as having no bucket.
 */
const TAKE_TOKEN = `
local limit = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])
local cost = tonumber(ARGV[3])
local now = tonumber(ARGV[4])
if not now then
  local time = redis.call('TIME')
  now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
end
local tokens_per_ms = limit / window_ms
local bucket = redis.call('HMGET', KEYS[1], 'tokens', 'updated_at')
local tokens = limit
if bucket[1] then
  local elapsed = math.max(0, now - tonumber(bucket[2]))
  tokens = math.min(limit, tonumber(bucket[1]) + elapsed * tokens_per_ms)
end
local allowed = 0
if tokens + 1e-6 >= cost then
  tokens = math.max(0, math.min(limit, tokens - cost))
  allowed = 1
end
redis.call('HSET', KEYS[1], 'tokens', tostring(tokens), 'updated_at', now)
redis.call('PEXPIRE', KEYS[1], window_ms)
local retry_after = 0
if allowed == 0 then
  retry_after = math.ceil((cost - tokens) / tokens_per_ms / 1000)
end
return { allowed, math.floor(tokens), math.ceil((limit - tokens) / tokens_per_ms / 1000), retry_after }
`;

/**
 * Rate limit buckets in Valkey, shared by every replica of a service.
 *
 * @example
 * RateLimitModule.forRoot({ policies: config.RATE_LIMITS, store: ValkeyRateLimitStore })
 */
@Injectable()
export class ValkeyRateLimitStore extends RateLimitStore {
  constructor(@InjectValkey() private readonly valkey: Redis) {
    super();
  }

  async consume(
    key: string,
    policy: RateLimitPolicy,
    { cost = 1, nowMs }: ConsumeOptions = {},
  ): Promise<RateLimitDecision> {
    const [allowed, remaining, resetSeconds, retryAfterSeconds] = (await this.valkey.eval(
      TAKE_TOKEN,
      1,
      key,
      policy.limit,
      policy.windowSeconds * 1000,
      cost,
      nowMs === undefined ? '' : Math.floor(nowMs),
    )) as [number, number, number, number];
    return {
      allowed: allowed === 1,
      limit: policy.limit,
      remaining,
      resetSeconds,
      retryAfterSeconds,
    };
  }
}
