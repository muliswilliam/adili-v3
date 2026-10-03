import { sql } from 'drizzle-orm';
import {
  check,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { nationalReports } from '../national-reports/schema.js';
import type { FileFormat, ReleaseFileName } from './files.js';

/**
 * Open-data releases (spec 09b): the year's aggregates as six suppressed tables, built from the
 * national consolidated report (or, for a snapshot of a year without one, the live projections)
 * and versioned per financial year and kind. Two tables:
 *
 * - `open_data_releases`: a release's identity, status and who published or withdrew it, and
 *   its manifest once issued as a Public verifiable document;
 * - `open_data_files`: its dataset files in object storage (JSON and CSV per table, and the
 *   release JSON), each with its SHA-256.
 *
 * Counts and rates only live in the files; these rows hold no figure. EACC data: row-level
 * security admits `app.tenant` `eacc` and `platform` (the public API reads as `platform`).
 */

/** reporting.yaml `OpenDataRelease.kind`: on NCR approval, or a deliberate mid-year snapshot. */
export const RELEASE_KINDS = ['annual', 'snapshot'] as const;
export type ReleaseKind = (typeof RELEASE_KINDS)[number];

/** reporting.yaml `OpenDataRelease.status`. */
export type ReleaseStatus = 'preview' | 'published' | 'withdrawn';

export const openDataReleases = pgTable(
  'open_data_releases',
  {
    id: uuid().primaryKey(),
    /** Financial year start year: 2027 is 1 July 2027 to 30 June 2028. */
    fy: integer().notNull(),
    kind: text().$type<ReleaseKind>().notNull(),
    /** 1, 2, ... per financial year and kind: a corrected release is the next version. */
    version: integer().notNull(),
    status: text().$type<ReleaseStatus>().notNull(),
    /**
     * The national consolidated report the release was built from and reconciles with; null for
     * a snapshot of a year with no NCR yet, built from the live projections.
     */
    nationalReportId: uuid().references(() => nationalReports.id),
    builtAt: timestamp({ withTimezone: true }).notNull(),
    /** Who built it (a subject), or null for the release workflow on NCR approval. */
    builtBy: text(),
    publishedAt: timestamp({ withTimezone: true }),
    /**
     * The EACC supervisor who published it (subject and name as their token gave it): who
     * approved the NCR, for an annual release published on its approval.
     */
    publishedBy: text(),
    publishedByName: text(),
    withdrawnAt: timestamp({ withTimezone: true }),
    /** The EACC supervisor who withdrew it. */
    withdrawnBy: text(),
    withdrawnByName: text(),
    /** Why, shown with the withdrawn release in the public API. */
    withdrawnReason: text(),
    /** The manifest (tables, hashes, version, FY, kind) as a Public verifiable document. */
    manifestDocumentId: uuid(),
    verificationId: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('open_data_releases_fy_kind_version_key').on(table.fy, table.kind, table.version),
    // Only a snapshot is ever built without an NCR.
    check(
      'open_data_releases_annual_ncr',
      sql`${table.kind} <> 'annual' or ${table.nationalReportId} is not null`,
    ),
  ],
);

/** A dataset file of a release, as written to the open-data bucket. */
export const openDataFiles = pgTable(
  'open_data_files',
  {
    releaseId: uuid()
      .notNull()
      .references(() => openDataReleases.id, { onDelete: 'cascade' }),
    /** One of the six tables, or `release` for the release JSON. */
    table: text().$type<ReleaseFileName>().notNull(),
    format: text().$type<FileFormat>().notNull(),
    objectKey: text().notNull(),
    /** SHA-256 of the file's bytes, hex. */
    sha256: text().notNull(),
    /** Data rows (for the release JSON, its table entries). */
    rows: integer().notNull(),
    bytes: integer().notNull(),
  },
  (table) => [primaryKey({ columns: [table.releaseId, table.table, table.format] })],
);

export const openDataSchema = { openDataReleases, openDataFiles };
