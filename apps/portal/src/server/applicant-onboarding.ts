import { clientIp } from '@adili/api-kit/client';
import { createServerFn } from '@tanstack/react-start';
import {
  deleteCookie,
  getCookie,
  getRequestHeaders,
  getRequestIP,
  setCookie,
} from '@tanstack/react-start/server';
import { z } from 'zod';

import type { DetailsInput } from '../components/applicant-onboarding/details';
import {
  applicantCodeSchema,
  type ApplicantSessionLookup,
  type ApplicantStepResult,
  completeApplicant,
  readApplicantSession,
  resendApplicantCode,
  resendApplicantPasswordEmail,
  startApplicantSession,
  type StartResult,
  verifyApplicantCode,
} from './applicant-onboarding.server';
import { onboardingClient } from './directory/client.server';
import { env } from './env.server';
import {
  APPLICANT_ONBOARDING_COOKIE,
  onboardingCookie,
  type OnboardingCredentials,
} from './onboarding-cookie';
import { runStep } from './onboarding.server';

/** A directory client carrying the browser's address, derived without trusting spoofable hops. */
function client() {
  return onboardingClient(clientIp(getRequestHeaders(), getRequestIP(), env().TRUSTED_PROXY_HOPS));
}

/** The applicant's onboarding cookie on this request. */
function cookie() {
  return onboardingCookie(
    { get: getCookie, set: setCookie, delete: deleteCookie },
    { secure: env().APP_URL.startsWith('https:'), name: APPLICANT_ONBOARDING_COOKIE },
  );
}

/** Runs a step on the session in the cookie; see `runStep`. */
function onSession(
  step: (credentials: OnboardingCredentials) => Promise<ApplicantStepResult>,
): Promise<ApplicantStepResult> {
  return runStep(cookie(), step);
}

/** The form as typed; `startApplicantSession` checks it with `detailsSchema`. */
const detailsInput = z.object({
  kind: z.enum(['national-id', 'passport']),
  surname: z.string(),
  firstName: z.string(),
  otherNames: z.string(),
  number: z.string(),
  country: z.string(),
  phone: z.string(),
  email: z.string(),
}) satisfies z.ZodType<DetailsInput>;

/**
 * `POST /v1/onboarding/applicants`. On success the session secret goes into an httpOnly cookie
 * and only the next route comes back to the browser.
 */
export const startApplicantOnboarding = createServerFn({ method: 'POST' })
  .validator(detailsInput)
  .handler(({ data }): Promise<StartResult> => startApplicantSession(client(), cookie(), data));

/** The applicant's onboarding session from the cookie. Clears the cookie once it has ended. */
export const getApplicantOnboardingSession = createServerFn({ method: 'GET' }).handler(
  (): Promise<ApplicantSessionLookup> => readApplicantSession(client(), cookie()),
);

/** `POST …/otp/verify`. */
export const verifyApplicantOnboardingCode = createServerFn({ method: 'POST' })
  .validator(applicantCodeSchema)
  .handler(({ data }) =>
    onSession((credentials) => verifyApplicantCode(client(), credentials, data)),
  );

/** `POST …/otp/resend`. */
export const resendApplicantOnboardingCode = createServerFn({ method: 'POST' }).handler(() =>
  onSession((credentials) => resendApplicantCode(client(), credentials)),
);

/**
 * `POST …/complete`: the account created and its set-password email sent. Each call is one
 * submission with its own Idempotency-Key, as for the declarant's confirm.
 */
export const completeApplicantOnboarding = createServerFn({ method: 'POST' }).handler(() =>
  onSession((credentials) => completeApplicant(client(), credentials, crypto.randomUUID())),
);

/** `POST …/resend-password-email`, one Idempotency-Key per submission. */
export const resendApplicantSetPasswordEmail = createServerFn({ method: 'POST' }).handler(() =>
  onSession((credentials) =>
    resendApplicantPasswordEmail(client(), credentials, crypto.randomUUID()),
  ),
);

/**
 * Forgets the session in this browser so the applicant can start again. The contract has no
 * call to end a session, so the directory's copy lapses at its expiry.
 */
export const leaveApplicantOnboarding = createServerFn({ method: 'POST' }).handler(() => {
  cookie().clear();
});
