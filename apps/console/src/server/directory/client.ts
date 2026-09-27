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
export type AssignReportingOfficer = Schemas['AssignReportingOfficer'];
export type ProblemDetails = Schemas['ProblemDetails'];
export type RosterApiCredential = Schemas['RosterApiCredential'];
export type RosterApiCredentialWithSecret = Schemas['RosterApiCredentialWithSecret'];
export type RosterSummary = Schemas['RosterSummary'];
export type RosterImport = Schemas['RosterImport'];
export type RosterImportPreview = Schemas['RosterImportPreview'];
export type ColumnMapping = Schemas['ColumnMapping'];
export type ImportCounts = Schemas['ImportCounts'];
export type RosterImportRow = Schemas['RosterImportRow'];
export type RowError = Schemas['RowError'];
export type RosterImportRowPage =
  paths['/v1/commissions/{slug}/roster/imports/{importId}/rows']['get']['responses'][200]['content']['application/json'];
export type RosterRecordListItem = Schemas['RosterRecordListItem'];
export type RosterRecord = Schemas['RosterRecord'];
export type RosterRecordState = Schemas['RosterRecordState'];
export type RosterRecordPage =
  paths['/v1/commissions/{slug}/roster/records']['get']['responses'][200]['content']['application/json'];
export type ListRosterRecordsQuery = NonNullable<
  paths['/v1/commissions/{slug}/roster/records']['get']['parameters']['query']
>;
export type RosterImportPage =
  paths['/v1/commissions/{slug}/roster/imports']['get']['responses'][200]['content']['application/json'];
export type CommissionPage =
  paths['/v1/commissions']['get']['responses'][200]['content']['application/json'];
export type ListCommissionsQuery = NonNullable<
  paths['/v1/commissions']['get']['parameters']['query']
>;

/** Why a directory call gave no data. */
export type DirectoryError =
  /** No console session, or the directory refused the token (401): sign in again. */
  | { kind: 'unauthenticated' }
  /** Network failure, timeout or 5xx: worth retrying. `problemType` is set for 5xx problems. */
  | { kind: 'unavailable'; detail: string | null; problemType?: string }
  /** The directory answered with RFC 9457 problem details (400, 403, 404, 409, 422). */
  | { kind: 'problem'; problem: ProblemDetails };

export type DirectoryResult<T> = { ok: true; data: T } | { ok: false; error: DirectoryError };

/**
 * How long the console waits for the directory, by kind of call. Reads and plain writes are
 * quick. Changing a roster API credential waits on several Keycloak admin calls (client, secret,
 * mappers). Assigning and resending wait on Keycloak too: at worst a dozen or so admin calls at the
 * directory's 5 s timeout each, then the activation email, which Keycloak sends over SMTP before
 * answering (the directory allows it 25 s). Giving up sooner would report a failure for an
 * assignment that still succeeds. A write that does time out keeps its Idempotency-Key, so the
 * retry replays the directory's outcome. Previewing a roster import fetches the uploaded file from
 * the documents service to read its header; an XLSX of up to 50 MB is read whole.
 */
export const DIRECTORY_TIMEOUTS_MS = {
  read: 5_000,
  write: 10_000,
  file: 30_000,
  identity: 120_000,
} as const;

/** The timeout of one directory call, from its method and path. */
export function directoryTimeoutMs(method: string, path: string): number {
  if (method === 'GET' || method === 'HEAD') return DIRECTORY_TIMEOUTS_MS.read;
  if (/\/(reporting-officer|roster\/api-credential)(\/|$)/.test(path)) {
    return DIRECTORY_TIMEOUTS_MS.identity;
  }
  if (path.endsWith('/roster/imports/preview')) return DIRECTORY_TIMEOUTS_MS.file;
  return DIRECTORY_TIMEOUTS_MS.write;
}

export function createDirectoryClient(options: {
  baseUrl: string;
  accessToken: string;
  fetch?: typeof fetch;
}): DirectoryClient {
  const fetchImpl = options.fetch ?? fetch;
  return createClient<paths>({
    baseUrl: options.baseUrl,
    headers: { authorization: `Bearer ${options.accessToken}`, accept: 'application/json' },
    fetch: (request) => {
      const timeoutMs = directoryTimeoutMs(request.method, new URL(request.url).pathname);
      return fetchImpl(new Request(request, { signal: AbortSignal.timeout(timeoutMs) }));
    },
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
    return {
      ok: false,
      error: { kind: 'unavailable', detail: problem.detail ?? null, problemType: problem.type },
    };
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
