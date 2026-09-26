import { createServerFn } from '@tanstack/react-start';
import { deleteCookie, getCookie, getRequestIP, setCookie } from '@tanstack/react-start/server';

import { identifySchema } from '../components/onboarding/identify';
import { onboardingClient } from './directory/client.server';
import type { OnboardingCommission } from './directory/types';
import { env } from './env.server';
import {
  cookieMaxAge,
  decodeOnboardingCookie,
  encodeOnboardingCookie,
  ONBOARDING_COOKIE,
} from './onboarding-cookie';
import {
  identify,
  type IdentifyResult,
  listCommissions,
  lookupSession,
  type SessionLookup,
} from './onboarding.server';

function client() {
  return onboardingClient(getRequestIP({ xForwardedFor: true }));
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: env().APP_URL.startsWith('https:'),
    path: '/',
  };
}

/** `GET /v1/onboarding/commissions`: the Commissions a declarant can pick, or null when unreachable. */
export const getOnboardingCommissions = createServerFn({ method: 'GET' }).handler(
  (): Promise<OnboardingCommission[] | null> => listCommissions(client()),
);

/**
 * `POST /v1/onboarding/sessions`. On a match the session secret goes into an httpOnly cookie
 * and only the next route comes back to the browser.
 */
export const identifyDeclarant = createServerFn({ method: 'POST' })
  .validator(identifySchema)
  .handler(async ({ data }): Promise<IdentifyResult> => {
    const { result, created } = await identify(client(), data);
    if (created) {
      setCookie(ONBOARDING_COOKIE, encodeOnboardingCookie(created), {
        ...cookieOptions(),
        maxAge: cookieMaxAge(created.expiresAt),
      });
    }
    return result;
  });

/** The declarant's onboarding session from the cookie. Clears the cookie once it has ended. */
export const getOnboardingSession = createServerFn({ method: 'GET' }).handler(
  async (): Promise<SessionLookup> => {
    const credentials = decodeOnboardingCookie(getCookie(ONBOARDING_COOKIE));
    if (!credentials) return { status: 'none' };
    const lookup = await lookupSession(client(), credentials);
    if (lookup.status === 'ended') deleteCookie(ONBOARDING_COOKIE, cookieOptions());
    return lookup;
  },
);
