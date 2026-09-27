import { createHash } from 'node:crypto';

import { z } from 'zod';

const principalSchema = z.object({
  subject: z.string(),
  tenant: z.string().nullable(),
  roles: z.array(z.string()),
  clientId: z.string().nullable(),
});

export type Principal = z.infer<typeof principalSchema>;

export type PrincipalResult = { ok: true; principal: Principal } | { ok: false; reason: string };

/**
 * How long an answer of `/v1/me` is reused for the same access token. The directory derives it
 * from the token alone, so it cannot change while the token is the same; reusing it spares the
 * directory a call on every navigation (route guards ask on each one).
 */
export const PRINCIPAL_CACHE_TTL_MS = 60_000;
const PRINCIPAL_CACHE_MAX_ENTRIES = 1_000;

/** Answers by SHA-256 of the token, oldest first; only successful answers are kept. */
const principals = new Map<string, { principal: Principal; expiresAt: number }>();

/**
 * Asks the directory service who the access token belongs to (`GET /v1/me`), reusing a recent
 * answer for the same token.
 */
export async function fetchPrincipal(
  baseUrl: string,
  accessToken: string,
  now: number = Date.now(),
): Promise<PrincipalResult> {
  const key = createHash('sha256').update(accessToken).digest('base64url');
  const cached = principals.get(key);
  if (cached && cached.expiresAt > now) return { ok: true, principal: cached.principal };
  principals.delete(key);
  const result = await requestPrincipal(baseUrl, accessToken);
  if (result.ok) {
    principals.set(key, { principal: result.principal, expiresAt: now + PRINCIPAL_CACHE_TTL_MS });
    for (const oldest of principals.keys()) {
      if (principals.size <= PRINCIPAL_CACHE_MAX_ENTRIES) break;
      principals.delete(oldest);
    }
  }
  return result;
}

async function requestPrincipal(baseUrl: string, accessToken: string): Promise<PrincipalResult> {
  try {
    const response = await fetch(new URL('/v1/me', baseUrl), {
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) {
      return { ok: false, reason: `Directory service answered ${response.status}` };
    }
    return { ok: true, principal: principalSchema.parse(await response.json()) };
  } catch {
    return { ok: false, reason: 'Directory service is unreachable' };
  }
}
