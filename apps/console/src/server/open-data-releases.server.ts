import { z } from 'zod';

import {
  OPEN_DATA_ROW_SCHEMAS,
  OPEN_DATA_TABLES,
  type OpenDataTableKey,
  type ReadTables,
} from './open-data-tables';
import type { ReportingClient } from './reporting/client.server';
import type {
  Officer,
  OpenDataRelease,
  OpenDataReleaseDetail,
  ReportingProblem,
} from './reporting/types';
import { callService, type ServiceResult } from './service-call';

/**
 * EACC's open-data releases (spec 09b FE-3, #350) through the reporting service, as the signed-in
 * EACC analyst or supervisor: list the releases, build a snapshot as a preview, and read a release
 * with its six tables as built and its versions; as an EACC supervisor, publish a preview and
 * withdraw a published release with a reason (#353).
 */

/**
 * The reporting service's problem details for releases. The open-data codes
 * (`reconciliation-failed`, `fy-not-started`, ...) come with #491's api-kit codes, so they are read
 * as a string here until the contract's `ProblemDetails.code` lists them.
 */
export type ReleasesProblem = Omit<ReportingProblem, 'code'> & {
  code?: string;
  /** With `reconciliation-failed`: the totals that differ (`national.all.declared`). */
  mismatches?: string[];
};

export type ReleasesResult<T> = ServiceResult<T, ReleasesProblem>;

/** Every release, previews and withdrawn ones included: the latest year first. */
export function listOpenDataReleases(
  client: ReportingClient,
): Promise<ReleasesResult<OpenDataRelease[]>> {
  return callService<OpenDataRelease[], ReleasesProblem>(() =>
    client.GET('/v1/eacc/open-data/releases'),
  );
}

/**
 * Builds the year's snapshot as a preview (`buildOpenDataRelease`, kind `snapshot`); a retry
 * with the same key replays the build. 409 `reconciliation-failed` carries the totals that differ.
 */
export function buildOpenDataSnapshot(
  client: ReportingClient,
  fy: number,
  idempotencyKey: string,
): Promise<ReleasesResult<OpenDataRelease>> {
  return buildOpenDataRelease(client, fy, 'snapshot', idempotencyKey);
}

/**
 * Builds the year's next release of `kind` as a preview (`buildOpenDataRelease`): a snapshot, or
 * a corrected annual release once the published one is withdrawn (S7).
 */
export function buildOpenDataRelease(
  client: ReportingClient,
  fy: number,
  kind: OpenDataRelease['kind'],
  idempotencyKey: string,
): Promise<ReleasesResult<OpenDataRelease>> {
  return callService<OpenDataRelease, ReleasesProblem>(() =>
    client.POST('/v1/eacc/open-data/releases', {
      params: { header: { 'Idempotency-Key': idempotencyKey } },
      body: { fy, kind },
    }),
  );
}

/**
 * Publishes a preview (`publishOpenDataRelease`, S6): an EACC supervisor only. Its manifest is
 * issued as a Public verifiable document and it is public at once. A retry with the same key
 * replays the answer.
 */
export function publishOpenDataRelease(
  client: ReportingClient,
  releaseId: string,
  idempotencyKey: string,
): Promise<ReleasesResult<OpenDataRelease>> {
  return callService<OpenDataRelease, ReleasesProblem>(() =>
    client.POST('/v1/eacc/open-data/releases/{releaseId}/publish', {
      params: { path: { releaseId }, header: { 'Idempotency-Key': idempotencyKey } },
    }),
  );
}

/**
 * Withdraws a published release with a public reason (`withdrawOpenDataRelease`, S7): an EACC
 * supervisor only. It stays in the history, its files still served, marked withdrawn with the
 * reason. A retry with the same key replays the answer.
 */
export function withdrawOpenDataRelease(
  client: ReportingClient,
  releaseId: string,
  reason: string,
  idempotencyKey: string,
): Promise<ReleasesResult<OpenDataRelease>> {
  return callService<OpenDataRelease, ReleasesProblem>(() =>
    client.POST('/v1/eacc/open-data/releases/{releaseId}/withdraw', {
      params: { path: { releaseId }, header: { 'Idempotency-Key': idempotencyKey } },
      body: { reason },
    }),
  );
}

/** A release with who built it, its source and its six tables, every row checked. */
export interface OpenDataReleaseView {
  release: OpenDataRelease;
  builtBy: Officer | null;
  source: OpenDataReleaseDetail['source'];
  tables: ReadTables;
  /**
   * Every version of the release's year and kind, the latest first, this one included (S7); null
   * when the list could not be read.
   */
  versions: OpenDataRelease[] | null;
}

/**
 * The release and its tables (`getOpenDataReleaseEacc`). reporting.yaml leaves the rows open, so
 * each is checked against what the service builds; one that is not reads as a failed load.
 */
export async function loadOpenDataRelease(
  client: ReportingClient,
  releaseId: string,
): Promise<ReleasesResult<OpenDataReleaseView>> {
  const [result, list] = await Promise.all([
    callService<OpenDataReleaseDetail, ReleasesProblem>(() =>
      client.GET('/v1/eacc/open-data/releases/{releaseId}', {
        params: { path: { releaseId } },
      }),
    ),
    listOpenDataReleases(client),
  ]);
  if (!result.ok) return result;
  const tables = readTables(result.data.tables);
  if (!tables) {
    return {
      ok: false,
      error: { kind: 'unavailable', detail: 'The release tables could not be read.' },
    };
  }
  const { release, builtBy, source } = result.data;
  const versions = list.ok
    ? list.data
        .filter((each) => each.fy === release.fy && each.kind === release.kind)
        .sort((a, b) => b.version - a.version)
    : null;
  return { ok: true, data: { release, builtBy, source, tables, versions } };
}

function readTables(files: OpenDataReleaseDetail['tables']): ReadTables | null {
  const read: Partial<Record<OpenDataTableKey, unknown>> = {};
  for (const key of OPEN_DATA_TABLES) {
    const file = files[key];
    const rows = z.array(OPEN_DATA_ROW_SCHEMAS[key]).safeParse(file.rows);
    if (!rows.success) return null;
    read[key] = {
      table: key,
      rows: rows.data,
      suppression: file.suppression,
      notCollected: file.notCollected,
    };
  }
  return read as ReadTables;
}
