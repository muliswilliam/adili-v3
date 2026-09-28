import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * The session secret: 256 random bits, returned once at identify. The portal keeps it in its
 * httpOnly cookie and sends it back in `X-Onboarding-Secret`; the directory stores only its hash.
 */
export function newSessionSecret(): string {
  return randomBytes(32).toString('base64url');
}

/** What `onboarding_sessions.secret_hash` stores: SHA-256, hex. A random secret needs no salt. */
export function hashSessionSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/** Whether `secret` is the one hashed to `secretHash`, in constant time. */
export function secretMatches(secret: string | undefined, secretHash: string): boolean {
  if (!secret) return false;
  const given = Buffer.from(hashSessionSecret(secret), 'hex');
  const stored = Buffer.from(secretHash, 'hex');
  return given.length === stored.length && timingSafeEqual(given, stored);
}

/** HMAC-SHA-256 of `parts` under `key`, base64url: stored instead of IPs and codes. */
export function keyedHash(key: string | Buffer, ...parts: string[]): string {
  const hmac = createHmac('sha256', key);
  for (const part of parts) hmac.update(part).update('\0');
  return hmac.digest('base64url');
}
