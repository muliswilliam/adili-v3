/** Holds the onboarding session id and secret. httpOnly, so page scripts never see the secret. */
export const ONBOARDING_COOKIE = 'adili_onboarding';

export interface OnboardingCredentials {
  sessionId: string;
  secret: string;
}

export function encodeOnboardingCookie({ sessionId, secret }: OnboardingCredentials): string {
  return `${sessionId}.${secret}`;
}

export function decodeOnboardingCookie(value: string | undefined): OnboardingCredentials | null {
  if (!value) return null;
  const separator = value.indexOf('.');
  if (separator <= 0 || separator === value.length - 1) return null;
  return { sessionId: value.slice(0, separator), secret: value.slice(separator + 1) };
}

/** Seconds from now until the session expires, so the cookie never outlives it. */
export function cookieMaxAge(expiresAt: string, now = Date.now()): number {
  return Math.max(0, Math.floor((Date.parse(expiresAt) - now) / 1000));
}
