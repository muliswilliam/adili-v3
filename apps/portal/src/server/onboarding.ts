import { createServerFn } from '@tanstack/react-start';
import {
  deleteCookie,
  getCookie,
  getRequestHeaders,
  getRequestIP,
  setCookie,
} from '@tanstack/react-start/server';

import { channelSchema, codeSchema, contactSchema } from '../components/onboarding/contact';
import { identifySchema } from '../components/onboarding/identify';
import { clientIp } from './client-ip';
import { onboardingClient } from './directory/client.server';
import type { OnboardingCommission } from './directory/types';
import { env } from './env.server';
import { onboardingCookie, type OnboardingCredentials } from './onboarding-cookie';
import {
  confirm,
  type IdentifyResult,
  listCommissions,
  provideContact,
  readSession,
  resendCode,
  resendPasswordEmail,
  runStep,
  type SessionLookup,
  startSession,
  type StepResult,
  verifyCode,
} from './onboarding.server';

/** A directory client carrying the browser's address, derived without trusting spoofable hops. */
function client() {
  return onboardingClient(clientIp(getRequestHeaders(), getRequestIP(), env().TRUSTED_PROXY_HOPS));
}

/** The onboarding cookie on this request. */
function cookie() {
  return onboardingCookie(
    { get: getCookie, set: setCookie, delete: deleteCookie },
    { secure: env().APP_URL.startsWith('https:') },
  );
}

/** Runs a step on the session in the cookie; see `runStep`. */
function onSession(
  step: (credentials: OnboardingCredentials) => Promise<StepResult>,
): Promise<StepResult> {
  return runStep(cookie(), step);
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
  .handler(({ data }): Promise<IdentifyResult> => startSession(client(), cookie(), data));

/** The declarant's onboarding session from the cookie. Clears the cookie once it has ended. */
export const getOnboardingSession = createServerFn({ method: 'GET' }).handler(
  (): Promise<SessionLookup> => readSession(client(), cookie()),
);

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
 * `POST …/confirm`: the IPRS check, then the account created or linked. Each call is one
 * submission, with its own Idempotency-Key. Minted here and never reused, so replay protection
 * is the directory's alone for now; a key owned by the browser across retries is a later option.
 */
export const confirmOnboarding = createServerFn({ method: 'POST' }).handler(() =>
  onSession((credentials) => confirm(client(), credentials, crypto.randomUUID())),
);

/** `POST …/resend-password-email`, one Idempotency-Key per submission (as for confirm). */
export const resendSetPasswordEmail = createServerFn({ method: 'POST' }).handler(() =>
  onSession((credentials) => resendPasswordEmail(client(), credentials, crypto.randomUUID())),
);

/**
 * Forgets the session in this browser so the declarant can start again. The contract has no
 * call to end a session, so the directory's copy lapses at its expiry.
 */
export const leaveOnboarding = createServerFn({ method: 'POST' }).handler(() => {
  cookie().clear();
});
