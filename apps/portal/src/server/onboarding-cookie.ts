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

export interface CookieOptions {
  httpOnly: boolean;
  sameSite: 'lax';
  secure: boolean;
  path: string;
  maxAge?: number;
}

/** The request's cookies: TanStack Start's cookie helpers on the server, a fake in tests. */
export interface CookieJar {
  get: (name: string) => string | undefined;
  set: (name: string, value: string, options: CookieOptions) => void;
  delete: (name: string, options: CookieOptions) => void;
}

/**
 * The one place the onboarding cookie is read and written. Every write takes the session's
 * current `expiresAt`, so the cookie lives exactly as long as the session it holds.
 */
export function onboardingCookie(jar: CookieJar, { secure }: { secure: boolean }) {
  const options: CookieOptions = { httpOnly: true, sameSite: 'lax', secure, path: '/' };
  return {
    read: (): OnboardingCredentials | null => decodeOnboardingCookie(jar.get(ONBOARDING_COOKIE)),
    save: (credentials: OnboardingCredentials, expiresAt: string) => {
      jar.set(ONBOARDING_COOKIE, encodeOnboardingCookie(credentials), {
        ...options,
        maxAge: cookieMaxAge(expiresAt),
      });
    },
    clear: () => {
      jar.delete(ONBOARDING_COOKIE, options);
    },
  };
}

export type OnboardingCookie = ReturnType<typeof onboardingCookie>;
