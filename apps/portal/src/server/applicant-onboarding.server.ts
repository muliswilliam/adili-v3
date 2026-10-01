import { z } from 'zod';

import {
  DETAILS_FIELDS,
  type DetailsField,
  type DetailsInput,
  detailsSchema,
  fieldForPath,
} from '../components/applicant-onboarding/details';
import {
  type ApplicantRoute,
  routeForApplicantSession,
} from '../components/applicant-onboarding/steps';
import type { OnboardingClient } from './directory/client.server';
import type { ApplicantOnboardingSession } from './directory/types';
import type { OnboardingCookie, OnboardingCredentials } from './onboarding-cookie';
import {
  type CreatedSession,
  problemSchema,
  retryAfter,
  sessionCall,
  type StepResult,
} from './onboarding.server';

/**
 * Logic behind Get started as an applicant's server functions (spec 10), kept free of request
 * context so it can be tested. The session steps read the directory's answers as the declarant's
 * onboarding does (`stepProblem`, `sessionCall`, `runStep` in onboarding.server).
 */

export type ApplicantStepResult = StepResult<ApplicantOnboardingSession>;

/** Why starting failed, in the portal's terms. */
export type StartProblem =
  /** IPRS has no person with this national ID under these names (409). */
  | { code: 'identity-mismatch' }
  /** An applicant account already has this document (409). */
  | { code: 'already-onboarded'; links?: { signIn?: string; recoverAccess?: string } }
  | { code: 'rate-limit-exceeded'; retryAfterSeconds?: number }
  /** The national register did not answer (503); nothing was kept. */
  | { code: 'iprs-unavailable' }
  /** The code could not be sent (502 `otp-send-failed`); nothing was kept. */
  | { code: 'send-failed' }
  /** The directory refused these fields (400); the form shows its own copy for them. */
  | { code: 'invalid'; fields: DetailsField[] }
  | { code: 'unavailable' };

/** What the browser gets back from starting. Never the session secret. */
export type StartResult = { ok: true; route: ApplicantRoute } | ({ ok: false } & StartProblem);

const fieldErrorsSchema = z.object({
  errors: z.array(z.object({ path: z.string() })).optional(),
});

/** The given fields once each, in the order the form shows them. */
function inFormOrder(fields: readonly (DetailsField | null)[]): DetailsField[] {
  return DETAILS_FIELDS.filter((field) => fields.includes(field));
}

/** The form fields a 400 names. */
function refusedFields(error: unknown): DetailsField[] {
  const parsed = fieldErrorsSchema.safeParse(error);
  return inFormOrder(
    (parsed.success ? (parsed.data.errors ?? []) : []).map((entry) => fieldForPath(entry.path)),
  );
}

function startProblem(response: Response, error: unknown): StartProblem {
  if (response.status === 400) return { code: 'invalid', fields: refusedFields(error) };
  const problem = problemSchema.safeParse(error);
  const code = problem.success ? problem.data.code : undefined;
  if (response.status === 409 && code === 'identity-mismatch') return { code };
  if (response.status === 409 && code === 'already-onboarded') {
    return { code, links: problem.data?.links };
  }
  if (response.status === 429) {
    return {
      code: 'rate-limit-exceeded',
      retryAfterSeconds: retryAfter(response, problem.data?.retryAfterSeconds),
    };
  }
  if (response.status === 502) return { code: 'send-failed' };
  if (response.status === 503 && code === 'iprs-unavailable') return { code };
  return { code: 'unavailable' };
}

/** `POST /v1/onboarding/applicants`: the IPRS check for a national ID, then the phone's code. */
export async function startApplicant(
  client: OnboardingClient,
  input: DetailsInput,
): Promise<{ result: StartResult; created?: CreatedSession }> {
  const parsed = detailsSchema.safeParse(input);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path[0] as DetailsField);
    return { result: { ok: false, code: 'invalid', fields: inFormOrder(fields) } };
  }
  try {
    const { data, error, response } = await client.POST('/v1/onboarding/applicants', {
      body: parsed.data,
    });
    if (data) {
      return {
        result: { ok: true, route: routeForApplicantSession(data) },
        created: { sessionId: data.id, secret: data.secret, expiresAt: data.expiresAt },
      };
    }
    return { result: { ok: false, ...startProblem(response, error) } };
  } catch {
    return { result: { ok: false, code: 'unavailable' } };
  }
}

/** Start, putting a new session's credentials in the cookie. */
export async function startApplicantSession(
  client: OnboardingClient,
  cookie: OnboardingCookie,
  input: DetailsInput,
): Promise<StartResult> {
  const { result, created } = await startApplicant(client, input);
  if (created) cookie.save(created, created.expiresAt);
  return result;
}

export type ApplicantSessionLookup =
  | { status: 'none' }
  /** The session expired or is gone; the cookie should be cleared. */
  | { status: 'ended' }
  | { status: 'unavailable' }
  | { status: 'active'; session: ApplicantOnboardingSession };

function sessionParams({ sessionId, secret }: OnboardingCredentials) {
  return { path: { sessionId }, header: { 'X-Onboarding-Secret': secret } };
}

function idempotentSessionParams(credentials: OnboardingCredentials, idempotencyKey: string) {
  const { path, header } = sessionParams(credentials);
  return { path, header: { ...header, 'Idempotency-Key': idempotencyKey } };
}

export async function lookupApplicantSession(
  client: OnboardingClient,
  credentials: OnboardingCredentials,
): Promise<ApplicantSessionLookup> {
  try {
    const { data, response } = await client.GET('/v1/onboarding/applicants/{sessionId}', {
      params: sessionParams(credentials),
    });
    if (data) {
      return data.state === 'expired' ? { status: 'ended' } : { status: 'active', session: data };
    }
    if (response.status === 404 || response.status === 410) return { status: 'ended' };
    return { status: 'unavailable' };
  } catch {
    return { status: 'unavailable' };
  }
}

/**
 * The session in the cookie. A live session's cookie is written again with its current expiry;
 * an ended or expired one's is cleared.
 */
export async function readApplicantSession(
  client: OnboardingClient,
  cookie: OnboardingCookie,
): Promise<ApplicantSessionLookup> {
  const credentials = cookie.read();
  if (!credentials) return { status: 'none' };
  const lookup = await lookupApplicantSession(client, credentials);
  if (lookup.status === 'ended') cookie.clear();
  if (lookup.status === 'active') cookie.save(credentials, lookup.session.expiresAt);
  return lookup;
}

/** The session after a call that answers 202 without it. */
async function readBack(
  client: OnboardingClient,
  credentials: OnboardingCredentials,
): Promise<ApplicantStepResult> {
  const lookup = await lookupApplicantSession(client, credentials);
  if (lookup.status === 'active') return { ok: true, session: lookup.session };
  return { ok: false, code: lookup.status === 'unavailable' ? 'unavailable' : 'ended' };
}

export const applicantCodeSchema = z.object({ code: z.string().regex(/^\d{6}$/) });

/** `POST …/otp/verify`: the phone's code. */
export function verifyApplicantCode(
  client: OnboardingClient,
  credentials: OnboardingCredentials,
  input: z.input<typeof applicantCodeSchema>,
): Promise<ApplicantStepResult> {
  const parsed = applicantCodeSchema.safeParse(input);
  if (!parsed.success) return Promise.resolve({ ok: false, code: 'invalid' });
  return sessionCall(
    () =>
      client.POST('/v1/onboarding/applicants/{sessionId}/otp/verify', {
        params: sessionParams(credentials),
        body: parsed.data,
      }),
    () => readBack(client, credentials),
  );
}

/** `POST …/otp/resend`, then the session read back for the new cooldown and resends left. */
export function resendApplicantCode(
  client: OnboardingClient,
  credentials: OnboardingCredentials,
): Promise<ApplicantStepResult> {
  return sessionCall(
    () =>
      client.POST('/v1/onboarding/applicants/{sessionId}/otp/resend', {
        params: sessionParams(credentials),
      }),
    () => readBack(client, credentials),
  );
}

/**
 * `POST …/complete`: creates the account and sends its set-password email. A retry with the
 * submission's `idempotencyKey` gets the first answer back instead of completing again.
 */
export function completeApplicant(
  client: OnboardingClient,
  credentials: OnboardingCredentials,
  idempotencyKey: string,
): Promise<ApplicantStepResult> {
  return sessionCall(
    () =>
      client.POST('/v1/onboarding/applicants/{sessionId}/complete', {
        params: idempotentSessionParams(credentials, idempotencyKey),
      }),
    () => readBack(client, credentials),
  );
}

/** `POST …/resend-password-email`, then the session read back for the next wait. */
export function resendApplicantPasswordEmail(
  client: OnboardingClient,
  credentials: OnboardingCredentials,
  idempotencyKey: string,
): Promise<ApplicantStepResult> {
  return sessionCall(
    () =>
      client.POST('/v1/onboarding/applicants/{sessionId}/resend-password-email', {
        params: idempotentSessionParams(credentials, idempotencyKey),
      }),
    () => readBack(client, credentials),
  );
}
