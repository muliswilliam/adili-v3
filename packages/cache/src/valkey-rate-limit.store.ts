import { randomUUID } from 'node:crypto';

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
 * `countRequest` from `@adili/api-kit` as one atomic script over a sorted set of request times
 * (score = time in ms, member = unique per request). Time comes from the Valkey server, so
 * replicas with skewed clocks share windows correctly, unless the caller passes its own (tests,
 * through `RATE_LIMIT_CLOCK`). The set expires when its newest request leaves the window, which
 * is the same as having no set. A key of another type (a token bucket hash written by an earlier
 * version) is replaced.
 */
const COUNT_REQUEST = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])
local cost = tonumber(ARGV[3])
local now = tonumber(ARGV[4])
local member = ARGV[5]
if not now then
  local time = redis.call('TIME')
  now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
end
local kind = redis.call('TYPE', key).ok
if kind ~= 'zset' and kind ~= 'none' then
  redis.call('DEL', key)
end
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window_ms)
local count = redis.call('ZCARD', key)
local allowed = 1
if cost > 0 then
  if count + cost <= limit then
    for i = 1, cost do
      redis.call('ZADD', key, now, member .. ':' .. i)
    end
    count = count + cost
  else
    allowed = 0
  end
elseif cost < 0 then
  local removed = redis.call('ZPOPMAX', key, -cost)
  count = count - #removed / 2
end
local reset = 0
if count > 0 then
  local newest = tonumber(redis.call('ZRANGE', key, -1, -1, 'WITHSCORES')[2])
  local ttl = newest + window_ms - now
  reset = math.ceil(ttl / 1000)
  redis.call('PEXPIRE', key, math.max(1, ttl))
end
local retry_after = 0
if allowed == 0 then
  local index = count + cost - limit - 1
  local blocking = tonumber(redis.call('ZRANGE', key, index, index, 'WITHSCORES')[2])
  retry_after = math.max(0, math.ceil((blocking + window_ms - now) / 1000))
end
return { allowed, math.max(0, limit - count), reset, retry_after }
`;

/**
 * Rate limit windows in Valkey, shared by every replica of a service.
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
      COUNT_REQUEST,
      1,
      key,
      policy.limit,
      policy.windowSeconds * 1000,
      cost,
      nowMs === undefined ? '' : Math.floor(nowMs),
      randomUUID(),
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
