import { createHmac, hkdfSync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { otpCodeHmac, otpCodeMatches, sessionOtpKey } from '../../src/onboarding/otp/otp-codes.js';

const KEY = 'k'.repeat(32);
const SESSION = '0192b4c8-7a1e-7c3d-9f00-5a6b7c8d9e0f';
const OTHER_SESSION = '0192b4c8-7a1e-7c3d-9f00-5a6b7c8d9e10';

describe('sessionOtpKey', () => {
  it('is HKDF-SHA-256 of the service key with the session id as context', () => {
    const expected = Buffer.from(
      hkdfSync('sha256', KEY, '', `adili onboarding-otp ${SESSION}`, 32),
    );

    expect(sessionOtpKey(KEY, SESSION).equals(expected)).toBe(true);
    expect(sessionOtpKey(KEY, SESSION)).toHaveLength(32);
  });

  it('differs per session and from the service key', () => {
    const key = sessionOtpKey(KEY, SESSION);

    expect(key.equals(sessionOtpKey(KEY, OTHER_SESSION))).toBe(false);
    expect(key.equals(Buffer.from(KEY))).toBe(false);
  });
});

describe('otpCodeHmac', () => {
  it("is keyed with the session's own key, not the service key", () => {
    const expected = createHmac('sha256', sessionOtpKey(KEY, SESSION))
      .update('onboarding-otp')
      .update('\0')
      .update('email')
      .update('\0')
      .update('123456')
      .update('\0')
      .digest('base64url');

    expect(otpCodeHmac(KEY, SESSION, 'email', '123456')).toBe(expected);
  });

  it('binds a code to its session and channel', () => {
    const hmac = otpCodeHmac(KEY, SESSION, 'email', '123456');

    expect(otpCodeMatches(KEY, SESSION, 'email', '123456', hmac)).toBe(true);
    expect(otpCodeMatches(KEY, SESSION, 'email', '123457', hmac)).toBe(false);
    expect(otpCodeMatches(KEY, SESSION, 'phone', '123456', hmac)).toBe(false);
    expect(otpCodeMatches(KEY, OTHER_SESSION, 'email', '123456', hmac)).toBe(false);
  });
});
