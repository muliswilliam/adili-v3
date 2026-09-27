import { Injectable } from '@nestjs/common';
import { type RateLimitDecision, type RateLimitPolicy, RateLimitStore } from '@adili/api-kit';
import type { Redis } from 'iovalkey';

import { InjectValkey } from './cache.module.js';

/**
 * `takeToken` from `@adili/api-kit` as one atomic script. Time comes from the Valkey server, so
 * replicas with skewed clocks share buckets correctly. A bucket expires once it would be full
 * again, which is the same as having no bucket.
 */
const TAKE_TOKEN = `
local limit = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local tokens_per_ms = limit / window_ms
local bucket = redis.call('HMGET', KEYS[1], 'tokens', 'updated_at')
local tokens = limit
if bucket[1] then
  local elapsed = math.max(0, now - tonumber(bucket[2]))
  tokens = math.min(limit, tonumber(bucket[1]) + elapsed * tokens_per_ms)
end
local allowed = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
end
redis.call('HSET', KEYS[1], 'tokens', tostring(tokens), 'updated_at', now)
redis.call('PEXPIRE', KEYS[1], window_ms)
local retry_after = 0
if allowed == 0 then
  retry_after = math.ceil((1 - tokens) / tokens_per_ms / 1000)
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

  async consume(key: string, policy: RateLimitPolicy): Promise<RateLimitDecision> {
    const [allowed, remaining, resetSeconds, retryAfterSeconds] = (await this.valkey.eval(
      TAKE_TOKEN,
      1,
      key,
      policy.limit,
      policy.windowSeconds * 1000,
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
