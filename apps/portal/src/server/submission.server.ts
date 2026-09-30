import type { DeclarationsClient } from './declarations/client.server';
import type {
  CompletenessIssue,
  Declaration,
  DeclarationVersion,
  SubmissionResult,
} from './declarations/types';
import { attempt, type NotFound, notFound, type Unavailable, unavailable } from './results';

/**
 * The declarations service's spec 06 submission endpoints, reduced to discriminated results the
 * summary's submit flow and the success page branch on. Pure: the caller injects the client
 * (see `submission.ts` for the server functions that call these as the signed-in declarant).
 */

/**
 * The 409 codes of `SubmitProblem`, each with its own copy. Listed here: the contract's
 * `SubmitProblem` extends `ProblemDetails`, whose `code` enum has none of them, so the
 * generated `SubmitProblem` intersects to `never`.
 */
export const SUBMIT_CONFLICTS = [
  'before-statement-date',
  'amendment-window-closed',
  'not-a-draft',
  'obligation-cancelled',
] as const;

export type SubmitConflict = (typeof SUBMIT_CONFLICTS)[number];

function isSubmitConflict(code: unknown): code is SubmitConflict {
  return SUBMIT_CONFLICTS.includes(code as SubmitConflict);
}

export type SubmitOutcome =
  | { status: 'submitted'; result: SubmissionResult }
  /** 403: the token lacks a fresh step-up; confirm identity again. */
  | { status: 'step-up-required' }
  /** 400 with blocking issues: the document does not validate. */
  | { status: 'incomplete'; blocking: CompletenessIssue[] }
  | { status: 'conflict'; code: SubmitConflict }
  | NotFound
  /** Network, 5xx, or an answer the flow cannot act on: retry with the same key. */
  | Unavailable;

export interface SubmitInput {
  declarationId: string;
  /** One per affirmation dialog; reuse it when retrying, so a replay files once. */
  idempotencyKey: string;
}

/** `POST /v1/declarations/{id}/submit` with `Idempotency-Key`: the legal act. */
export function submitDeclaration(
  client: DeclarationsClient,
  input: SubmitInput,
): Promise<SubmitOutcome> {
  return attempt(async () => {
    const { data, error, response } = await client.POST('/v1/declarations/{declarationId}/submit', {
      params: {
        path: { declarationId: input.declarationId },
        header: { 'Idempotency-Key': input.idempotencyKey },
      },
    });
    if (data) return { status: 'submitted', result: data };
    const problem = error as { code?: unknown; blocking?: CompletenessIssue[] } | undefined;
    if (response.status === 403 && problem?.code === 'step-up-required') {
      return { status: 'step-up-required' };
    }
    if (response.status === 400 && problem?.blocking) {
      return { status: 'incomplete', blocking: problem.blocking };
    }
    if (response.status === 409 && isSubmitConflict(problem?.code)) {
      return { status: 'conflict', code: problem.code };
    }
    return response.status === 404 ? notFound : unavailable;
  });
}

export type SubmissionLoad =
  | { status: 'ok'; declaration: Declaration; version: DeclarationVersion }
  /** The declaration has no submitted version (still a draft, or discarded). */
  | { status: 'not-submitted' }
  | NotFound
  | Unavailable;

/**
 * The declaration and its newest submitted version, for the success page: `GET
 * /v1/declarations/{id}` and `GET /v1/declarations/{id}/versions` (newest first).
 */
export function loadSubmission(
  client: DeclarationsClient,
  declarationId: string,
): Promise<SubmissionLoad> {
  return attempt(async () => {
    const path = { params: { path: { declarationId } } };
    const [declaration, versions] = await Promise.all([
      client.GET('/v1/declarations/{declarationId}', path),
      client.GET('/v1/declarations/{declarationId}/versions', path),
    ]);
    if (declaration.response.status === 404) return notFound;
    if (!declaration.data) return unavailable;
    if (versions.response.status === 404) return { status: 'not-submitted' };
    if (!versions.data) return unavailable;
    const [latest] = versions.data;
    if (!latest) return { status: 'not-submitted' };
    return { status: 'ok', declaration: declaration.data, version: latest };
  });
}
