import { describe, expect, it } from 'vitest';

import { cookieMaxAge, decodeOnboardingCookie, encodeOnboardingCookie } from './onboarding-cookie';

describe('onboarding cookie', () => {
  it('round-trips the session id and secret', () => {
    const credentials = { sessionId: 'a1b2', secret: 's.e.c.r.e.t' };
    expect(decodeOnboardingCookie(encodeOnboardingCookie(credentials))).toEqual(credentials);
  });

  it('ignores missing or malformed values', () => {
    for (const value of [undefined, '', 'no-separator', '.secret', 'id.']) {
      expect(decodeOnboardingCookie(value)).toBeNull();
    }
  });

  it('expires with the session', () => {
    const now = Date.parse('2026-09-26T10:00:00Z');
    expect(cookieMaxAge('2026-09-26T10:30:00Z', now)).toBe(1800);
    expect(cookieMaxAge('2026-09-26T09:00:00Z', now)).toBe(0);
  });
});
