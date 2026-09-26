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
import type { OnboardingCredentials } from './onboarding-cookie';
import type {
  OnboardingCommission,
  OnboardingProblemCode,
  OnboardingSession,
  OtpChannel,
} from './directory/types';

/** Logic behind the onboarding server functions, kept free of request context so it can be tested. */

const problemSchema = z.object({
  code: z.string(),
  attemptsLeft: z.number().optional(),
  retryAfterSeconds: z.number().optional(),
  links: z
    .object({ signIn: z.string().optional(), recoverAccess: z.string().optional() })
    .optional(),
});

export interface IdentifyProblem {
  /** A contract problem code, `invalid` for a rejected request or `unavailable` for anything else. */
  code: OnboardingProblemCode | 'invalid' | 'unavailable';
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

function retryAfter(response: Response, bodySeconds: number | undefined): number | undefined {
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
    const known = [404, 409, 429].includes(response.status) && problem.success;
    if (!known) return { result: { ok: false, code: 'unavailable' } };
    return {
      result: {
        ok: false,
        code: problem.data.code as OnboardingProblemCode,
        retryAfterSeconds: retryAfter(response, problem.data.retryAfterSeconds),
        links: problem.data.links,
      },
    };
  } catch {
    return { result: { ok: false, code: 'unavailable' } };
  }
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
    if (data) return { status: 'active', session: data };
    if (response.status === 404 || response.status === 410) return { status: 'ended' };
    return { status: 'unavailable' };
  } catch {
    return { status: 'unavailable' };
  }
}

/**
 * Why a step failed. `ended` means the session is gone and the cookie should be cleared;
 * `moved` means it is waiting on another step, e.g. after a second tab moved it on.
 */
export type StepProblem =
  | { code: 'otp-invalid'; attemptsLeft?: number }
  | { code: 'otp-expired' }
  | { code: 'resend-cooldown'; retryAfterSeconds?: number }
  /** The national register did not answer; the session is unchanged and can retry. */
  | { code: 'iprs-unavailable' }
  /** The account could not be created; nothing changed and the session can retry. */
  | { code: 'identity-unavailable' }
  | { code: 'invalid' }
  | { code: 'ended' }
  | { code: 'moved' }
  | { code: 'unavailable' };

/** What the browser gets back from a step: the session (never its secret). */
export type StepResult = { ok: true; session: OnboardingSession } | ({ ok: false } & StepProblem);

function stepProblem(response: Response, error: unknown): StepProblem {
  if (response.status === 404 || response.status === 410) return { code: 'ended' };
  if (response.status === 409) return { code: 'moved' };
  const problem = problemSchema.safeParse(error);
  const code = problem.success ? problem.data.code : undefined;
  if (response.status === 400 && code === 'otp-invalid') {
    // The last wrong code ends the session.
    if (problem.data?.attemptsLeft === 0) return { code: 'ended' };
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
  if (response.status === 503 && code === 'iprs-unavailable') return { code };
  return { code: 'unavailable' };
}

function sessionParams({ sessionId, secret }: OnboardingCredentials) {
  return { path: { sessionId }, header: { 'X-Onboarding-Secret': secret } };
}

function channelParams({ sessionId, secret }: OnboardingCredentials, channel: OtpChannel) {
  return { path: { sessionId, channel }, header: { 'X-Onboarding-Secret': secret } };
}

export async function verifyCode(
  client: OnboardingClient,
  credentials: OnboardingCredentials,
  input: z.input<typeof codeSchema>,
): Promise<StepResult> {
  const parsed = codeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'invalid' };
  const { channel, code } = parsed.data;
  try {
    const { data, error, response } = await client.POST(
      '/v1/onboarding/sessions/{sessionId}/otp/{channel}/verify',
      { params: channelParams(credentials, channel), body: { code } },
    );
    if (data) return { ok: true, session: data };
    return { ok: false, ...stepProblem(response, error) };
  } catch {
    return { ok: false, code: 'unavailable' };
  }
}

/** Sends a new code, then reads the session back for the new cooldown and resends left. */
export async function resendCode(
  client: OnboardingClient,
  credentials: OnboardingCredentials,
  input: z.input<typeof channelSchema>,
): Promise<StepResult> {
  const parsed = channelSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'invalid' };
  try {
    const { error, response } = await client.POST(
      '/v1/onboarding/sessions/{sessionId}/otp/{channel}/resend',
      {
        params: channelParams(credentials, parsed.data.channel),
      },
    );
    if (response.status !== 202) return { ok: false, ...stepProblem(response, error) };
  } catch {
    return { ok: false, code: 'unavailable' };
  }
  return readBack(client, credentials);
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

/** Supplies the email or phone the roster record lacks; the directory sends a code to it. */
export async function provideContact(
  client: OnboardingClient,
  credentials: OnboardingCredentials,
  input: ContactInput,
): Promise<StepResult> {
  const parsed = contactSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'invalid' };
  try {
    const { data, error, response } = await client.POST(
      '/v1/onboarding/sessions/{sessionId}/contacts',
      { params: sessionParams(credentials), body: parsed.data },
    );
    if (data) return { ok: true, session: data };
    return { ok: false, ...stepProblem(response, error) };
  } catch {
    return { ok: false, code: 'unavailable' };
  }
}

/**
 * Confirms the roster details. The directory checks them against the national register, then
 * creates the account or links the record to the declarant's existing one; the session's state
 * and outcome say which.
 */
export async function confirm(
  client: OnboardingClient,
  credentials: OnboardingCredentials,
): Promise<StepResult> {
  try {
    const { data, error, response } = await client.POST(
      '/v1/onboarding/sessions/{sessionId}/confirm',
      { params: sessionParams(credentials) },
    );
    if (data) return { ok: true, session: data.session };
    return { ok: false, ...stepProblem(response, error) };
  } catch {
    return { ok: false, code: 'unavailable' };
  }
}

/** Sends the set-password email again, then reads the session back for the new wait. */
export async function resendPasswordEmail(
  client: OnboardingClient,
  credentials: OnboardingCredentials,
): Promise<StepResult> {
  try {
    const { error, response } = await client.POST(
      '/v1/onboarding/sessions/{sessionId}/resend-password-email',
      { params: sessionParams(credentials) },
    );
    if (response.status !== 202) return { ok: false, ...stepProblem(response, error) };
  } catch {
    return { ok: false, code: 'unavailable' };
  }
  return readBack(client, credentials);
}
