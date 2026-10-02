import { z } from 'zod';

import {
  channelSchema,
  codeSchema,
  type ContactInput,
  contactSchema,
} from '../components/onboarding/contact';
import type { IdentifyInput } from '../components/onboarding/identify';
import { identifySchema } from '../components/onboarding/identify';
import { routeForSession, type StepRoute } from '../components/onboarding/steps';
import type { OnboardingClient } from './directory/client.server';
import type { OnboardingCookie, OnboardingCredentials } from './onboarding-cookie';
import type {
  OnboardingCommission,
  OnboardingProblemCode,
  OnboardingSession,
  OtpChannel,
} from './directory/types';

/** Logic behind the onboarding server functions, kept free of request context so it can be tested. */

/** The parts of an onboarding problem the portal reads, declarant's or applicant's. */
export const problemSchema = z.object({
  code: z.string(),
  attemptsLeft: z.number().optional(),
  retryAfterSeconds: z.number().optional(),
  links: z
    .object({ signIn: z.string().optional(), recoverAccess: z.string().optional() })
    .optional(),
});

/**
 * The problem codes the contract gives Identify (404, 409 and 429). Any other code, e.g. one
 * added to the contract later, is read as `unavailable` so the page shows the generic error
 * rather than looking up copy it does not have.
 */
const IDENTIFY_PROBLEM_CODES = [
  'no-match',
  'no-roster',
  'already-onboarded',
  'rate-limit-exceeded',
] as const satisfies readonly OnboardingProblemCode[];

type IdentifyProblemCode = (typeof IDENTIFY_PROBLEM_CODES)[number];

function isIdentifyProblemCode(code: string): code is IdentifyProblemCode {
  return (IDENTIFY_PROBLEM_CODES as readonly string[]).includes(code);
}

export interface IdentifyProblem {
  /** A contract problem code, `invalid` for a rejected request or `unavailable` for anything else. */
  code: IdentifyProblemCode | 'invalid' | 'unavailable';
  retryAfterSeconds?: number;
  links?: { signIn?: string; recoverAccess?: string };
}

/** What the browser gets back from Identify. Never the session secret. */
export type IdentifyResult = { ok: true; route: StepRoute } | ({ ok: false } & IdentifyProblem);

/** A new session's credentials, for the caller to put in the cookie. */
export interface CreatedSession extends OnboardingCredentials {
  expiresAt: string;
}

export async function listCommissions(
  client: OnboardingClient,
): Promise<OnboardingCommission[] | null> {
  try {
    const { data } = await client.GET('/v1/onboarding/commissions');
    return data ?? null;
  } catch {
    return null;
  }
}

/** The wait a 429 gives, from its body or else its RateLimit-Reset header. */
export function retryAfter(
  response: Response,
  bodySeconds: number | undefined,
): number | undefined {
  if (bodySeconds !== undefined) return bodySeconds;
  const header = Number(response.headers.get('RateLimit-Reset'));
  return Number.isFinite(header) && header > 0 ? header : undefined;
}

export async function identify(
  client: OnboardingClient,
  input: IdentifyInput,
): Promise<{ result: IdentifyResult; created?: CreatedSession }> {
  const parsed = identifySchema.safeParse(input);
  if (!parsed.success) return { result: { ok: false, code: 'invalid' } };

  try {
    const { data, error, response } = await client.POST('/v1/onboarding/sessions', {
      body: parsed.data,
    });
    if (data) {
      return {
        result: { ok: true, route: routeForSession(data) },
        created: { sessionId: data.id, secret: data.secret, expiresAt: data.expiresAt },
      };
    }
    if (response.status === 400) return { result: { ok: false, code: 'invalid' } };
    const problem = problemSchema.safeParse(error);
    if (
      !problem.success ||
      ![404, 409, 429].includes(response.status) ||
      !isIdentifyProblemCode(problem.data.code)
    ) {
      return { result: { ok: false, code: 'unavailable' } };
    }
    return {
      result: {
        ok: false,
        code: problem.data.code,
        retryAfterSeconds: retryAfter(response, problem.data.retryAfterSeconds),
        links: problem.data.links,
      },
    };
  } catch {
    return { result: { ok: false, code: 'unavailable' } };
  }
}

/** Identify, putting a new session's credentials in the cookie. */
export async function startSession(
  client: OnboardingClient,
  cookie: OnboardingCookie,
  input: IdentifyInput,
): Promise<IdentifyResult> {
  const { result, created } = await identify(client, input);
  if (created) cookie.save(created, created.expiresAt);
  return result;
}

export type SessionLookup =
  | { status: 'none' }
  /** The session expired or is gone; the cookie should be cleared. */
  | { status: 'ended' }
  | { status: 'unavailable' }
  | { status: 'active'; session: OnboardingSession };

export async function lookupSession(
  client: OnboardingClient,
  { sessionId, secret }: OnboardingCredentials,
): Promise<SessionLookup> {
  try {
    const { data, response } = await client.GET('/v1/onboarding/sessions/{sessionId}', {
      params: sessionParams({ sessionId, secret }),
    });
    // An expired session is as good as gone: nothing can move it on.
    if (data)
      return data.state === 'expired' ? { status: 'ended' } : { status: 'active', session: data };
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
export async function readSession(
  client: OnboardingClient,
  cookie: OnboardingCookie,
): Promise<SessionLookup> {
  const credentials = cookie.read();
  if (!credentials) return { status: 'none' };
  const lookup = await lookupSession(client, credentials);
  if (lookup.status === 'ended') cookie.clear();
  if (lookup.status === 'active') cookie.save(credentials, lookup.session.expiresAt);
  return lookup;
}

/**
 * Runs a step on the session in the cookie. The secret stays on the server. Each step that
 * returns the session moves the cookie's expiry with it; one that finds the session ended
 * clears the cookie.
 */
export async function runStep<S extends { expiresAt: string } = OnboardingSession>(
  cookie: OnboardingCookie,
  step: (credentials: OnboardingCredentials) => Promise<StepResult<S>>,
): Promise<StepResult<S>> {
  const credentials = cookie.read();
  if (!credentials) return { ok: false, code: 'ended' };
  const result = await step(credentials);
  if (result.ok) cookie.save(credentials, result.session.expiresAt);
  else if (result.code === 'ended' || result.code === 'too-many') cookie.clear();
  return result;
}

/**
 * Why a step failed. `ended` means the session is gone and the cookie should be cleared;
 * `too-many` is the same after the last wrong code; `moved` means it is waiting on another
 * step, e.g. after a second tab moved it on.
 */
export type StepProblem =
  | { code: 'otp-invalid'; attemptsLeft?: number }
  | { code: 'otp-expired' }
  | { code: 'resend-cooldown'; retryAfterSeconds?: number }
  /** The national register did not answer; the session is unchanged and can retry. */
  | { code: 'iprs-unavailable' }
  /** The account could not be created; nothing changed and the session can retry. */
  | { code: 'identity-unavailable' }
  /** The verified email belongs to another account; nothing changed, retrying will not help. */
  | { code: 'email-in-use' }
  /** An applicant account already has this document (applicant complete only); nothing changed. */
  | { code: 'already-onboarded' }
  | { code: 'invalid' }
  | { code: 'ended' }
  | { code: 'too-many' }
  | { code: 'moved' }
  /** The directory could not send a code (502 `otp-send-failed`); nothing changed. */
  | { code: 'send-failed' }
  | { code: 'unavailable' };

/**
 * What the browser gets back from a step: the session (never its secret). A declarant's
 * onboarding session by default; an applicant's for Get started as an applicant.
 */
export type StepResult<S = OnboardingSession> =
  { ok: true; session: S } | ({ ok: false } & StepProblem);

/** A failed step's answer as the portal reads it, the same for declarants and applicants. */
export function stepProblem(response: Response, error: unknown): StepProblem {
  if (response.status === 404 || response.status === 410) return { code: 'ended' };
  const problem = problemSchema.safeParse(error);
  const code = problem.success ? problem.data.code : undefined;
  if (response.status === 409 && (code === 'email-in-use' || code === 'already-onboarded')) {
    return { code };
  }
  if (response.status === 409) return { code: 'moved' };
  if (response.status === 400 && code === 'otp-invalid') {
    // The last wrong code ends the session.
    if (problem.data?.attemptsLeft === 0) return { code: 'too-many' };
    return { code: 'otp-invalid', attemptsLeft: problem.data?.attemptsLeft };
  }
  if (response.status === 400 && code === 'otp-expired') return { code: 'otp-expired' };
  if (response.status === 400) return { code: 'invalid' };
  if (response.status === 429 && code === 'resend-cooldown') {
    return {
      code: 'resend-cooldown',
      retryAfterSeconds: retryAfter(response, problem.data?.retryAfterSeconds),
    };
  }
  if (response.status === 502 && code === 'identity-unavailable') return { code };
  if (response.status === 502) return { code: 'send-failed' };
  if (response.status === 503 && code === 'iprs-unavailable') return { code };
  return { code: 'unavailable' };
}

function sessionParams({ sessionId, secret }: OnboardingCredentials) {
  return { path: { sessionId }, header: { 'X-Onboarding-Secret': secret } };
}

function idempotentSessionParams(credentials: OnboardingCredentials, idempotencyKey: string) {
  const { path, header } = sessionParams(credentials);
  return { path, header: { ...header, 'Idempotency-Key': idempotencyKey } };
}

function channelParams({ sessionId, secret }: OnboardingCredentials, channel: OtpChannel) {
  return { path: { sessionId, channel }, header: { 'X-Onboarding-Secret': secret } };
}

/** What an openapi-fetch call on a session answers. */
export interface SessionCallResult<S = OnboardingSession> {
  data?: S;
  error?: unknown;
  response: Response;
}

/**
 * One call on the session, read the same way for every step: the session it returns; for a
 * 202 without a body, the session read back (for the new cooldown and resends left); otherwise
 * the step's problem. A call that throws is the directory being unavailable.
 */
export async function sessionCall<S>(
  call: () => Promise<SessionCallResult<S>>,
  readBack: () => Promise<StepResult<S>>,
): Promise<StepResult<S>> {
  let result: SessionCallResult<S>;
  try {
    result = await call();
  } catch {
    return { ok: false, code: 'unavailable' };
  }
  const { data, error, response } = result;
  if (data) return { ok: true, session: data };
  if (response.status === 202) return readBack();
  return { ok: false, ...stepProblem(response, error) };
}

/** The session after a call that answers 202 without it. */
async function readBack(
  client: OnboardingClient,
  credentials: OnboardingCredentials,
): Promise<StepResult> {
  const lookup = await lookupSession(client, credentials);
  if (lookup.status === 'active') return { ok: true, session: lookup.session };
  return { ok: false, code: lookup.status === 'unavailable' ? 'unavailable' : 'ended' };
}

export async function verifyCode(
  client: OnboardingClient,
  credentials: OnboardingCredentials,
  input: z.input<typeof codeSchema>,
): Promise<StepResult> {
  const parsed = codeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'invalid' };
  const { channel, code } = parsed.data;
  return sessionCall(
    () =>
      client.POST('/v1/onboarding/sessions/{sessionId}/otp/{channel}/verify', {
        params: channelParams(credentials, channel),
        body: { code },
      }),
    () => readBack(client, credentials),
  );
}

/** Sends a new code, then reads the session back for the new cooldown and resends left. */
export async function resendCode(
  client: OnboardingClient,
  credentials: OnboardingCredentials,
  input: z.input<typeof channelSchema>,
): Promise<StepResult> {
  const parsed = channelSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'invalid' };
  return sessionCall(
    () =>
      client.POST('/v1/onboarding/sessions/{sessionId}/otp/{channel}/resend', {
        params: channelParams(credentials, parsed.data.channel),
      }),
    () => readBack(client, credentials),
  );
}

/** Supplies the email or phone the roster record lacks; the directory sends a code to it. */
export async function provideContact(
  client: OnboardingClient,
  credentials: OnboardingCredentials,
  input: ContactInput,
): Promise<StepResult> {
  const parsed = contactSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'invalid' };
  return sessionCall(
    () =>
      client.POST('/v1/onboarding/sessions/{sessionId}/contacts', {
        params: sessionParams(credentials),
        body: parsed.data,
      }),
    () => readBack(client, credentials),
  );
}

/**
 * Confirms the roster details. The directory checks them against the national register, then
 * creates the account or links the record to the declarant's existing one; the session's state
 * and outcome say which. `idempotencyKey` is the submission's: a retry with it gets the first
 * answer back instead of confirming again.
 */
export function confirm(
  client: OnboardingClient,
  credentials: OnboardingCredentials,
  idempotencyKey: string,
): Promise<StepResult> {
  return sessionCall(
    async () => {
      const result = await client.POST('/v1/onboarding/sessions/{sessionId}/confirm', {
        params: idempotentSessionParams(credentials, idempotencyKey),
      });
      return { ...result, data: result.data?.session };
    },
    () => readBack(client, credentials),
  );
}

/**
 * Sends the set-password email again, then reads the session back for the new wait. A retry with
 * the submission's `idempotencyKey` sends no second email.
 */
export function resendPasswordEmail(
  client: OnboardingClient,
  credentials: OnboardingCredentials,
  idempotencyKey: string,
): Promise<StepResult> {
  return sessionCall(
    () =>
      client.POST('/v1/onboarding/sessions/{sessionId}/resend-password-email', {
        params: idempotentSessionParams(credentials, idempotencyKey),
      }),
    () => readBack(client, credentials),
  );
}
