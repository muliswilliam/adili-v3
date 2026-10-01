import { createHash } from 'node:crypto';

import type { AuthenticatedRequest } from '../auth/jwt-auth.guard.js';

/**
 * Whose budget a request draws on: a string naming the caller, or `undefined` when the request
 * does not say (that limit then does not apply to it, e.g. a body without the field; validation
 * rejects such requests anyway). Runs before validation, so it must accept any input.
 */
export type RateLimitKey = (request: AuthenticatedRequest) => string | undefined;

/**
 * The default: machine clients (client credentials, one service account) have one budget each;
 * people signed in through the same app each have their own; unauthenticated calls on
 * `@Public()` routes are counted by client IP.
 */
export const byCaller: RateLimitKey = (request) => {
  const { principal } = request;
  if (!principal) return byClientIp(request);
  return `client:${principal.clientId ?? '-'}:${principal.subject}`;
};

/**
 * The client IP address, whether or not the caller is signed in: the socket address, or the
 * X-Forwarded-For entry the `TRUSTED_PROXIES` in front of the service vouch for (the portal
 * sends the browser's address as the only entry).
 */
export const byClientIp: RateLimitKey = (request) => `ip:${request.ip}`;

/** Where a request carries a value, e.g. `{ body: 'commission' }` or `{ param: 'tenant' }`. */
export type RequestValue = { param: string } | { body: string } | { query: string };

/**
 * The client IP address plus a value the request names, e.g. the Commission a declarant
 * identifies against: a budget per address and Commission, apart from the address's own. The
 * value is hashed into the key, so any input makes a short key; a request without it (or with
 * a non-string) is not limited by this key.
 *
 * @example
 * @RateLimit('onboarding-identify-commission', { key: byClientIpAnd({ body: 'commission' }) })
 */
export function byClientIpAnd(source: RequestValue): RateLimitKey {
  const [where, name] = Object.entries(source)[0] as ['param' | 'body' | 'query', string];
  return (request) => {
    const container = { param: request.params, body: request.body, query: request.query }[where];
    const value =
      typeof container === 'object' && container !== null
        ? (container as Record<string, unknown>)[name]
        : undefined;
    if (typeof value !== 'string' || value === '') return undefined;
    const digest = createHash('sha256').update(value).digest('base64url').slice(0, 22);
    return `${byClientIp(request)}:${where}.${name}:${digest}`;
  };
}
