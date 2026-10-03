import type { FileFormat } from './files.js';
import { openDataFiles, openDataReleases } from './schema.js';
import { OPEN_DATA_TABLES, type OpenDataTableName } from './tables.js';
import type { ReleaseKind, ReleaseStatus } from './schema.js';

export type OpenDataReleaseRow = typeof openDataReleases.$inferSelect;
export type OpenDataFileRow = typeof openDataFiles.$inferSelect;

/** reporting.yaml `OpenDataRelease`. */
export interface OpenDataReleaseView {
  id: string;
  fy: number;
  kind: ReleaseKind;
  version: number;
  status: ReleaseStatus;
  builtAt: string;
  publishedAt: string | null;
  withdrawnAt: string | null;
  withdrawnReason: string | null;
  manifestVerificationId: string | null;
  tables: { table: OpenDataTableName; rows: number; sha256Json: string; sha256Csv: string }[];
}

/** A release with its tables' rows and hashes, in table order. */
export function openDataReleaseView(
  release: OpenDataReleaseRow,
  files: readonly OpenDataFileRow[],
): OpenDataReleaseView {
  const fileOf = (table: OpenDataTableName, format: FileFormat): OpenDataFileRow | undefined =>
    files.find((file) => file.table === table && file.format === format);
  return {
    id: release.id,
    fy: release.fy,
    kind: release.kind,
    version: release.version,
    status: release.status,
    builtAt: release.builtAt.toISOString(),
    publishedAt: release.publishedAt?.toISOString() ?? null,
    withdrawnAt: release.withdrawnAt?.toISOString() ?? null,
    withdrawnReason: release.withdrawnReason,
    manifestVerificationId: release.verificationId,
    tables: OPEN_DATA_TABLES.flatMap((table) => {
      const json = fileOf(table, 'json');
      const csv = fileOf(table, 'csv');
      return json && csv
        ? [{ table, rows: json.rows, sha256Json: json.sha256, sha256Csv: csv.sha256 }]
        : [];
    }),
  };
}
