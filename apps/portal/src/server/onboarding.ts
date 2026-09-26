import { createServerFn } from '@tanstack/react-start';
import { deleteCookie, getCookie, getRequestIP, setCookie } from '@tanstack/react-start/server';

import { channelSchema, codeSchema, contactSchema } from '../components/onboarding/contact';
import { identifySchema } from '../components/onboarding/identify';
import { onboardingClient } from './directory/client.server';
import type { OnboardingCommission } from './directory/types';
import { env } from './env.server';
import {
  cookieMaxAge,
  decodeOnboardingCookie,
  encodeOnboardingCookie,
  ONBOARDING_COOKIE,
  type OnboardingCredentials,
} from './onboarding-cookie';
import {
  identify,
  type IdentifyResult,
  listCommissions,
  lookupSession,
  provideContact,
  resendCode,
  type SessionLookup,
  type StepResult,
  verifyCode,
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

/**
 * Runs a verification step on the session in the cookie. The secret stays on the server; the
 * cookie is cleared once the directory says the session has ended.
 */
async function onSession(
  step: (credentials: OnboardingCredentials) => Promise<StepResult>,
): Promise<StepResult> {
  const credentials = decodeOnboardingCookie(getCookie(ONBOARDING_COOKIE));
  const result = credentials
    ? await step(credentials)
    : { ok: false as const, code: 'ended' as const };
  if (!result.ok && result.code === 'ended') deleteCookie(ONBOARDING_COOKIE, cookieOptions());
  return result;
}

/** `POST …/otp/{channel}/verify`. */
export const verifyOnboardingCode = createServerFn({ method: 'POST' })
  .validator(codeSchema)
  .handler(({ data }) => onSession((credentials) => verifyCode(client(), credentials, data)));

/** `POST …/otp/{channel}/resend`. */
export const resendOnboardingCode = createServerFn({ method: 'POST' })
  .validator(channelSchema)
  .handler(({ data }) => onSession((credentials) => resendCode(client(), credentials, data)));

/** `POST …/contacts`, with the phone already normalised to E.164 by the schema. */
export const provideOnboardingContact = createServerFn({ method: 'POST' })
  .validator(contactSchema)
  .handler(({ data }) => onSession((credentials) => provideContact(client(), credentials, data)));

/**
 * Forgets the session in this browser so the declarant can start again. The contract has no
 * call to end a session, so the directory's copy lapses at its expiry.
 */
export const leaveOnboarding = createServerFn({ method: 'POST' }).handler(() => {
  deleteCookie(ONBOARDING_COOKIE, cookieOptions());
});
