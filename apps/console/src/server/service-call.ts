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

/** One field a service's validation refused, by dotted path, as problem details' `errors` list it. */
export interface FieldProblem {
  path: string;
  message: string;
}

/** A validation problem (400): the shared fields and the fields at fault. */
export interface ValidationProblem extends BaseProblem {
  errors?: FieldProblem[];
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
