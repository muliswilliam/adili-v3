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
 * with its six tables as built.
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
  return callService<OpenDataRelease, ReleasesProblem>(() =>
    client.POST('/v1/eacc/open-data/releases', {
      params: { header: { 'Idempotency-Key': idempotencyKey } },
      body: { fy, kind: 'snapshot' },
    }),
  );
}

/** A release with who built it, its source and its six tables, every row checked. */
export interface OpenDataReleaseView {
  release: OpenDataRelease;
  builtBy: Officer | null;
  source: OpenDataReleaseDetail['source'];
  tables: ReadTables;
}

/**
 * The release and its tables (`getOpenDataReleaseEacc`). reporting.yaml leaves the rows open, so
 * each is checked against what the service builds; one that is not reads as a failed load.
 */
export async function loadOpenDataRelease(
  client: ReportingClient,
  releaseId: string,
): Promise<ReleasesResult<OpenDataReleaseView>> {
  const result = await callService<OpenDataReleaseDetail, ReleasesProblem>(() =>
    client.GET('/v1/eacc/open-data/releases/{releaseId}', {
      params: { path: { releaseId } },
    }),
  );
  if (!result.ok) return result;
  const tables = readTables(result.data.tables);
  if (!tables) {
    return {
      ok: false,
      error: { kind: 'unavailable', detail: 'The release tables could not be read.' },
    };
  }
  const { release, builtBy, source } = result.data;
  return { ok: true, data: { release, builtBy, source, tables } };
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
