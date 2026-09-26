import { z } from 'zod';

import type { IdentifyInput } from '../components/onboarding/identify';
import { identifySchema } from '../components/onboarding/identify';
import { routeForSession, type StepRoute } from '../components/onboarding/steps';
import type { OnboardingClient } from './directory/client.server';
import type { OnboardingCredentials } from './onboarding-cookie';
import type {
  OnboardingCommission,
  OnboardingProblemCode,
  OnboardingSession,
} from './directory/types';

/** Logic behind the onboarding server functions, kept free of request context so it can be tested. */

const problemSchema = z.object({
  code: z.string(),
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
      params: { path: { sessionId }, header: { 'X-Onboarding-Secret': secret } },
    });
    if (data) return { status: 'active', session: data };
    if (response.status === 404 || response.status === 410) return { status: 'ended' };
    return { status: 'unavailable' };
  } catch {
    return { status: 'unavailable' };
  }
}
