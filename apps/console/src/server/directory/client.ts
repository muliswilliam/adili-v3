import createClient, { type Client } from 'openapi-fetch';

import { callService, type ServiceError, type ServiceResult } from '../service-call';
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
export type ConfirmExits = Schemas['ConfirmExits'];
export type ExitsResult = Schemas['ExitsResult'];
export type KeepResult = Schemas['KeepResult'];
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

/** Why a directory call gave no data (see `service-call.ts`). */
export type DirectoryError = ServiceError<ProblemDetails>;

export type DirectoryResult<T> = ServiceResult<T, ProblemDetails>;

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

/**
 * Runs one directory call and folds every outcome into a `DirectoryResult`.
 *
 * @example
 * callDirectory(() => client.GET('/v1/commissions/{slug}', { params: { path: { slug } } }))
 */
export function callDirectory<T>(
  request: Parameters<typeof callService<T, ProblemDetails>>[0],
): Promise<DirectoryResult<T>> {
  return callService<T, ProblemDetails>(request);
}
