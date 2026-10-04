/**
 * One call to a platform service, folded into a plain serialisable result: every service answers
 * RFC 9457 problem details, so server functions return `{ ok, data | error }` and screens switch
 * on `error.kind` and `problem.status`. `Problem` is the shared fields by default; a caller that
 * reads more of its contract's problem type narrows it (the directory's field errors, see
 * `callDirectory` in `directory/client.ts`).
 */

/** The fields every service's problem details carry. */
export interface BaseProblem {
  type: string;
  title: string;
  status: number;
  detail?: string;
}

/** Why a service call gave no data. */
export type ServiceError<Problem extends BaseProblem = BaseProblem> =
  /** No console session, or the service refused the token (401): sign in again. */
  | { kind: 'unauthenticated' }
  /** Network failure, timeout or 5xx: worth retrying. `problemType` is set for 5xx problems. */
  | { kind: 'unavailable'; detail: string | null; problemType?: string }
  /** The service answered with problem details (400, 403, 404, 409, 422). */
  | { kind: 'problem'; problem: Problem };

export type ServiceResult<T, Problem extends BaseProblem = BaseProblem> =
  { ok: true; data: T } | { ok: false; error: ServiceError<Problem> };

/**
 * The outcome of a call that could not be made, or got no answer: worth retrying. Also what a
 * loader returns for a Commission role without a tenant (a broken account): a failed load.
 */
export const SERVICE_UNAVAILABLE = {
  ok: false,
  error: { kind: 'unavailable', detail: null },
} as const satisfies ServiceResult<never>;

interface FetchOutcome<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

/**
 * Runs one openapi-fetch call and folds every outcome into a `ServiceResult`.
 *
 * @example
 * callService(() => client.GET('/v1/review/cases/{caseId}', { params: { path: { caseId } } }))
 */
export async function callService<T, Problem extends BaseProblem = BaseProblem>(
  request: () => Promise<FetchOutcome<T>>,
): Promise<ServiceResult<T, Problem>> {
  let outcome: FetchOutcome<T>;
  try {
    outcome = await request();
  } catch {
    return SERVICE_UNAVAILABLE;
  }
  const { data, error, response } = outcome;
  if (response.ok) {
    return { ok: true, data: data as T };
  }
  if (response.status === 401) {
    return { ok: false, error: { kind: 'unauthenticated' } };
  }
  // Each service's client names its own problem type; the fields checked here are the shared ones.
  const problem = toProblem(error, response) as Problem;
  if (response.status >= 500) {
    return {
      ok: false,
      error: { kind: 'unavailable', detail: problem.detail ?? null, problemType: problem.type },
    };
  }
  return { ok: false, error: { kind: 'problem', problem } };
}

function toProblem(body: unknown, response: Response): BaseProblem {
  if (isProblem(body)) {
    return body;
  }
  return { type: 'about:blank', title: response.statusText || 'Error', status: response.status };
}

function isProblem(body: unknown): body is BaseProblem {
  return (
    typeof body === 'object' &&
    body !== null &&
    'status' in body &&
    typeof body.status === 'number' &&
    'title' in body &&
    typeof body.title === 'string'
  );
}

/** The status of the problem a service answered with; null while loading, on success or failure. */
export function problemStatus(result: ServiceResult<unknown> | null): number | null {
  return result && !result.ok && result.error.kind === 'problem'
    ? result.error.problem.status
    : null;
}

/** A problem as screens print it beside a refusal: its status and code ("409 not-proposed"). */
export function problemLabel(status: number, code: string): string {
  return `${String(status)} ${code}`;
}

/**
 * A refusal a screen explains, named by the problem's `code` (review's 403s and 409s):
 * `separation-of-duties` also says why (`reason`), every other code is just its kind.
 */
export type CodedRefusal<K extends string> = K extends 'separation-of-duties'
  ? { kind: K; reason: 'proposer' | 'reviewer-of-record' }
  : { kind: K };

/**
 * The refusals of deciding an approval, of any kind (approve, return, decline), with the status
 * review gives each: the one source of their codes, type and guard. Each kind's status map
 * spreads it.
 */
export const DECISION_REFUSAL_STATUS = {
  /** The caller proposed it or held one of its cases (with `reason`). */
  'separation-of-duties': 403,
  /** A reviewer, not a supervisor. */
  'supervisor-required': 403,
  /** It was decided already. */
  'not-proposed': 409,
} as const satisfies Record<string, 403 | 409>;

export type DecisionRefusal = CodedRefusal<keyof typeof DECISION_REFUSAL_STATUS>;

/** Whether a kind's refusal is one of deciding an approval. */
export function isDecisionRefusal(refusal: { kind: string }): refusal is DecisionRefusal {
  return Object.hasOwn(DECISION_REFUSAL_STATUS, refusal.kind);
}

/** A call whose refusals the screens explain: its data, a refusal, or any other failure. */
export type RefusalResult<T, R> =
  | { ok: true; data: T }
  | { ok: false; refusal: R }
  | { ok: false; refusal: null; error: ServiceError };

/**
 * The refusal a 403 or 409 problem names (by `code`, else `type`) among `statuses`, the codes a
 * caller explains with the status each comes with; null for any other answer.
 */
export function refusalOf<K extends string>(
  error: ServiceError,
  statuses: Record<K, 403 | 409>,
): CodedRefusal<K> | null {
  if (error.kind !== 'problem') return null;
  const problem: { status: number; type: string; code?: unknown; reason?: unknown } = error.problem;
  if (problem.status !== 403 && problem.status !== 409) return null;
  const known = (value: unknown): value is K =>
    typeof value === 'string' && Object.hasOwn(statuses, value);
  const code = known(problem.code) ? problem.code : problem.type;
  // A known code under another status than the contract gives it is not that refusal.
  if (!known(code) || statuses[code] !== problem.status) return null;
  const refusal =
    code === 'separation-of-duties'
      ? { kind: code, reason: problem.reason === 'proposer' ? 'proposer' : 'reviewer-of-record' }
      : { kind: code };
  // TypeScript cannot resolve `CodedRefusal<K>` for a generic `K`; the branch above builds its
  // two shapes: `reason` exactly for `separation-of-duties`.
  return refusal as CodedRefusal<K>;
}

/** Runs one call like `callService`, with the refusals among `statuses` read out of its problem. */
export async function callWithRefusals<T, K extends string>(
  call: () => Promise<FetchOutcome<T>>,
  statuses: Record<K, 403 | 409>,
): Promise<RefusalResult<T, CodedRefusal<K>>> {
  const result = await callService(call);
  if (result.ok) return result;
  const refusal = refusalOf(result.error, statuses);
  return refusal ? { ok: false, refusal } : { ok: false, refusal: null, error: result.error };
}
