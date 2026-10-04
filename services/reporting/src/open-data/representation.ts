import { z } from 'zod';

import { countSchema as count } from '../compliance-reports/representation.js';
import { officerSchema, storedOfficer } from '../officer.js';
import type { FileFormat } from './files.js';
import {
  type openDataFiles,
  type openDataReleases,
  RELEASE_KINDS,
  RELEASE_STATUSES,
} from './schema.js';
import { SUPPRESSION_THRESHOLD } from './suppression.js';
import { OPEN_DATA_TABLES, type OpenDataTable, type OpenDataTableName } from './tables.js';

export type OpenDataReleaseRow = typeof openDataReleases.$inferSelect;

/**
 * No release the caller may see has the key: none has the id (EACC's endpoints), or none of the
 * year, kind and version is public (published or withdrawn; the public API). Answered 404.
 */
export class ReleaseNotFound extends Error {
  override readonly name = 'ReleaseNotFound';
}
export type OpenDataFileRow = typeof openDataFiles.$inferSelect;

/** reporting.yaml `OpenDataTable`: a table of a release, by name. */
export const openDataTableNameSchema = z.enum(OPEN_DATA_TABLES);

/** A table file of a release: its rows and the SHA-256 (hex) of its JSON and CSV files. */
export const releaseTableSchema = z.object({
  table: openDataTableNameSchema,
  rows: count,
  sha256Json: z
    .string()
    .meta({ description: "SHA-256 (hex) of the table's JSON as `getOpenDataTable` serves it" }),
  sha256Csv: z.string().meta({ description: "SHA-256 (hex) of the table's CSV" }),
});

/** reporting.yaml `OpenDataRelease`: a release as EACC sees it, previews and withdrawn included. */
export const openDataReleaseSchema = z.object({
  id: z.uuid(),
  fy: z.number().int().meta({ description: 'Financial year start year' }),
  kind: z.enum(RELEASE_KINDS),
  version: z.number().int().min(1),
  status: z.enum(RELEASE_STATUSES),
  builtAt: z.iso.datetime(),
  publishedAt: z.iso.datetime().nullable(),
  publishedBy: officerSchema.nullable().meta({
    description:
      'The EACC supervisor who published it; for an annual release, who approved its NCR. Null while a preview',
  }),
  withdrawnAt: z.iso.datetime().nullable(),
  withdrawnBy: officerSchema
    .nullable()
    .meta({ description: 'The EACC supervisor who withdrew it; null unless withdrawn' }),
  withdrawnReason: z.string().nullable(),
  manifestDocumentId: z.uuid().nullable().meta({
    description: 'The Public manifest document (documents service); null while a preview',
  }),
  manifestVerificationId: z
    .string()
    .nullable()
    .meta({ description: 'Verification code of the Public manifest document' }),
  tables: z.array(releaseTableSchema),
});
export type OpenDataReleaseView = z.infer<typeof openDataReleaseSchema>;

/**
 * reporting.yaml `OpenDataTableFile`: a table as released and served by `getOpenDataTable` as
 * JSON, byte for byte the stored file.
 */
export const openDataTableFileSchema = z
  .object({
    table: openDataTableNameSchema,
    columns: z.array(z.string()),
    rows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))),
    suppression: z.object({
      threshold: z
        .number()
        .int()
        .meta({
          description: `Fewest officers a published figure stands for (${String(SUPPRESSION_THRESHOLD)})`,
        }),
      cellsSuppressed: count.meta({
        description: 'Figures hidden by suppression; figures not collected are not counted',
      }),
    }),
    notCollected: z.array(z.string()).meta({
      description:
        "Figures not collected yet: columns, or in `national-totals` measures, whose values are null for want of data, not suppression (`suppressed` stays false): `by-entity-type`'s filing figures (no rows) until the directory carries entity types; empty otherwise.",
    }),
  })
  .meta({
    description:
      'A table of a release: its columns in order, its rows (dimensions, figures, null when suppressed or not collected, and the `suppressed` marker), and how many figures suppression hid',
  }) satisfies z.ZodType<OpenDataTable>;

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
    publishedBy: storedOfficer(release.publishedBy, release.publishedByName),
    withdrawnAt: release.withdrawnAt?.toISOString() ?? null,
    withdrawnBy: storedOfficer(release.withdrawnBy, release.withdrawnByName),
    withdrawnReason: release.withdrawnReason,
    manifestDocumentId: release.manifestDocumentId,
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
