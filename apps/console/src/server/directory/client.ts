import createClient, { type Client } from 'openapi-fetch';

import type { components, paths } from './api.gen';

/**
 * Typed client for the directory API, generated from the committed contract
 * (packages/schemas/internal/directory.yaml → api.gen.ts via `pnpm generate:api`).
 * Runs on the server only: the browser never holds a token.
 */
export type DirectoryClient = Client<paths>;

type Schemas = components['schemas'];
export type Commission = Schemas['Commission'];
export type CommissionType = Schemas['CommissionType'];
export type OfficerCategory = Schemas['OfficerCategory'];
export type OfficerCategoryCode = Schemas['OfficerCategoryCode'];
export type CreateCommission = Schemas['CreateCommission'];
export type ReportingOfficer = Schemas['ReportingOfficer'];
export type ProblemDetails = Schemas['ProblemDetails'];
export type CommissionPage =
  paths['/v1/commissions']['get']['responses'][200]['content']['application/json'];
export type ListCommissionsQuery = NonNullable<
  paths['/v1/commissions']['get']['parameters']['query']
>;

/** Why a directory call gave no data. */
export type DirectoryError =
  /** No console session, or the directory refused the token (401): sign in again. */
  | { kind: 'unauthenticated' }
  /** Network failure, timeout or 5xx: worth retrying. */
  | { kind: 'unavailable'; detail: string | null }
  /** The directory answered with RFC 9457 problem details (400, 403, 404, 409, 422). */
  | { kind: 'problem'; problem: ProblemDetails };

export type DirectoryResult<T> = { ok: true; data: T } | { ok: false; error: DirectoryError };

const TIMEOUT_MS = 5_000;

export function createDirectoryClient(options: {
  baseUrl: string;
  accessToken: string;
  fetch?: typeof fetch;
}): DirectoryClient {
  const fetchImpl = options.fetch ?? fetch;
  return createClient<paths>({
    baseUrl: options.baseUrl,
    headers: { authorization: `Bearer ${options.accessToken}`, accept: 'application/json' },
    fetch: (request) =>
      fetchImpl(new Request(request, { signal: AbortSignal.timeout(TIMEOUT_MS) })),
  });
}

interface FetchOutcome<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

/**
 * Runs one client call and folds every outcome into a `DirectoryResult`, so server functions
 * return plain serialisable values and screens switch on `error.kind` / `problem.status`.
 *
 * @example
 * callDirectory(() => client.GET('/v1/commissions/{slug}', { params: { path: { slug } } }))
 */
export async function callDirectory<T>(
  request: () => Promise<FetchOutcome<T>>,
): Promise<DirectoryResult<T>> {
  let outcome: FetchOutcome<T>;
  try {
    outcome = await request();
  } catch {
    return { ok: false, error: { kind: 'unavailable', detail: null } };
  }
  const { data, error, response } = outcome;
  if (response.ok) {
    return { ok: true, data: data as T };
  }
  if (response.status === 401) {
    return { ok: false, error: { kind: 'unauthenticated' } };
  }
  const problem = toProblem(error, response);
  if (response.status >= 500) {
    return { ok: false, error: { kind: 'unavailable', detail: problem.detail ?? null } };
  }
  return { ok: false, error: { kind: 'problem', problem } };
}

function toProblem(body: unknown, response: Response): ProblemDetails {
  if (isProblem(body)) {
    return body;
  }
  return { type: 'about:blank', title: response.statusText || 'Error', status: response.status };
}

function isProblem(body: unknown): body is ProblemDetails {
  return (
    typeof body === 'object' &&
    body !== null &&
    'status' in body &&
    typeof body.status === 'number' &&
    'title' in body &&
    typeof body.title === 'string'
  );
}
