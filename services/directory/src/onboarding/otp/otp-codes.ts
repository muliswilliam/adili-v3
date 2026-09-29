import type { ContactChannel } from '@adili/contacts';
import { hkdfSync, randomInt, timingSafeEqual } from 'node:crypto';

import { keyedHash } from '../secret.js';

/** A 6-digit one-time code from the CSPRNG. */
export function generateOtpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/**
 * The session's own code key: HKDF-SHA-256 of `ONBOARDING_HMAC_KEY` with the session id as
 * context (spec 03, "HMAC with a per-session key"). A code's HMAC then says nothing about any
 * other session's codes, and the service key itself never keys a code.
 */
export function sessionOtpKey(key: string, sessionId: string): Buffer {
  return Buffer.from(hkdfSync('sha256', key, '', `adili onboarding-otp ${sessionId}`, 32));
}

/**
 * What `onboarding_otps.code_hmac` stores: an HMAC of the channel and code under the session's
 * own key (`sessionOtpKey`), so a code is only ever valid for the session and channel it was
 * sent for.
 */
export function otpCodeHmac(key: string, sessionId: string, channel: ContactChannel, code: string) {
  return keyedHash(sessionOtpKey(key, sessionId), 'onboarding-otp', channel, code);
}

/** Whether `code` is the one whose HMAC is `codeHmac`, in constant time. */
export function otpCodeMatches(
  key: string,
  sessionId: string,
  channel: ContactChannel,
  code: string,
  codeHmac: string,
): boolean {
  const given = Buffer.from(otpCodeHmac(key, sessionId, channel, code));
  const stored = Buffer.from(codeHmac);
  return given.length === stored.length && timingSafeEqual(given, stored);
}
