import { ACCESS_GROUNDS, ACCESS_OUTCOMES, type AccessOutcome } from '@adili/events/contracts';
import { z } from 'zod';

import { isWithinScope, type Scope, scopeSchema } from './scope.js';

/**
 * An access officer's decision on a Form K or law enforcement request (access.yaml `Decision`):
 * final once taken. Denials and partial grants cite Regulation 24 grounds; a partial grant
 * narrows the scope; reasons are always given.
 */

export const outcomeSchema = z.enum(ACCESS_OUTCOMES);
export const groundSchema = z.enum(ACCESS_GROUNDS).meta({ description: 'Regulation 24' });

export const decisionSchema = z.object({
  outcome: outcomeSchema,
  /** The scope granted: the requested one for a grant, a narrower one for a partial grant. */
  grantedScope: scopeSchema.nullable(),
  grounds: z.array(groundSchema),
  reasons: z.string(),
  decidedBy: z.object({ subject: z.string(), name: z.string() }),
  decidedAt: z.iso.datetime({ offset: true }),
});

export type Decision = z.infer<typeof decisionSchema>;

/**
 * access.yaml `DecisionInput`: what the access officer decides. The rules between the fields
 * (which outcome needs grounds or a narrowed scope) are `decisionOf`'s, as they need the
 * requested scope.
 */
export const decisionInputSchema = z.strictObject({
  outcome: outcomeSchema,
  grantedScope: scopeSchema.nullable().optional().meta({
    description:
      'Required for partial-grant: narrower than the requested scope, never wider. A grant is of the requested scope (omit it, or send the requested scope); a denial has none',
  }),
  grounds: z
    .array(groundSchema)
    .max(ACCESS_GROUNDS.length)
    .refine((grounds) => new Set(grounds).size === grounds.length, 'must not repeat a ground')
    .optional()
    .meta({
      description: 'Regulation 24 grounds: required for partial-grant and deny, none for grant',
    }),
  reasons: z.string().trim().min(1).max(4000),
});

export type DecisionInput = z.infer<typeof decisionInputSchema>;

/** Why a decision cannot be taken as given: a registered problem code, or a plain 400. */
export interface DecisionRejection {
  code: 'grounds-required' | 'scope-exceeds-request' | null;
  path: 'grantedScope' | 'grounds';
  message: string;
}

/** The request status a decision's outcome leaves it in. */
export const DECIDED_STATUS = {
  grant: 'granted',
  'partial-grant': 'partially-granted',
  deny: 'denied',
} as const satisfies Record<AccessOutcome, string>;

/**
 * The decision `input` makes on a request for `requested` (S6), or why it cannot be taken. A
 * grant is of the requested scope and cites no grounds. A partial grant narrows the scope (any
 * wider part is `scope-exceeds-request`; the whole of it is a grant) and cites Regulation 24
 * grounds for what it refuses. A denial cites grounds and grants nothing. Reasons are always
 * given.
 */
export function decisionOf(
  input: DecisionInput,
  requested: Scope,
  decidedBy: Decision['decidedBy'],
  decidedAt: Date,
): Decision | DecisionRejection {
  const grounds = input.grounds ?? [];
  const scope = input.grantedScope ?? null;
  const decision = (grantedScope: Scope | null): Decision => ({
    outcome: input.outcome,
    grantedScope,
    grounds,
    reasons: input.reasons,
    decidedBy,
    decidedAt: decidedAt.toISOString(),
  });
  const exceeds = scope !== null && !isWithinScope(scope, requested);
  const whole = scope !== null && !exceeds && isWithinScope(requested, scope);

  switch (input.outcome) {
    case 'grant':
      if (exceeds) return exceedsRequest();
      if (scope !== null && !whole) {
        return rejection(
          'grantedScope',
          'is narrower than the requested scope: decide a partial grant to narrow it',
        );
      }
      if (grounds.length > 0) {
        return rejection('grounds', 'must be empty for a grant: grounds are for what is refused');
      }
      return decision(requested);
    case 'partial-grant':
      if (scope === null) return rejection('grantedScope', 'is required for a partial grant');
      if (exceeds) return exceedsRequest();
      if (whole) {
        return rejection('grantedScope', 'is the whole requested scope: decide a grant instead');
      }
      if (grounds.length === 0) return groundsRequired('a partial grant');
      return decision(scope);
    case 'deny':
      if (scope !== null) return rejection('grantedScope', 'must be absent for a denial');
      if (grounds.length === 0) return groundsRequired('a denial');
      return decision(null);
  }
}

export function isDecisionRejection(
  value: Decision | DecisionRejection,
): value is DecisionRejection {
  return 'path' in value;
}

function rejection(path: DecisionRejection['path'], message: string): DecisionRejection {
  return { code: null, path, message };
}

function exceedsRequest(): DecisionRejection {
  return {
    code: 'scope-exceeds-request',
    path: 'grantedScope',
    message: 'grants a year, section or household member the request did not ask for',
  };
}

function groundsRequired(what: string): DecisionRejection {
  return {
    code: 'grounds-required',
    path: 'grounds',
    message: `${what} must cite at least one Regulation 24 ground`,
  };
}

/** A granted package as the requests show it (access.yaml `Package`). */
export const packageSchema = z.object({
  documentId: z.uuid(),
  verificationId: z.string(),
  issuedAt: z.iso.datetime({ offset: true }),
  downloadExpiresAt: z.iso.datetime({ offset: true }),
  downloads: z.int().min(0),
});

export type Package = z.infer<typeof packageSchema>;
