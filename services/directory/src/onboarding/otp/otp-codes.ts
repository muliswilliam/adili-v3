import { randomInt, timingSafeEqual } from 'node:crypto';

import { keyedHash } from '../secret.js';
import type { OtpChannel } from '../session-state.js';

/** A 6-digit one-time code from the CSPRNG. */
export function generateOtpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/**
 * What `onboarding_otps.code_hmac` stores: an HMAC of the code keyed per session and channel
 * (`ONBOARDING_HMAC_KEY` with the session id), so a code is only ever valid for the session and
 * channel it was sent for.
 */
export function otpCodeHmac(key: string, sessionId: string, channel: OtpChannel, code: string) {
  return keyedHash(key, 'onboarding-otp', sessionId, channel, code);
}

/** Whether `code` is the one whose HMAC is `codeHmac`, in constant time. */
export function otpCodeMatches(
  key: string,
  sessionId: string,
  channel: OtpChannel,
  code: string,
  codeHmac: string,
): boolean {
  const given = Buffer.from(otpCodeHmac(key, sessionId, channel, code));
  const stored = Buffer.from(codeHmac);
  return given.length === stored.length && timingSafeEqual(given, stored);
}
