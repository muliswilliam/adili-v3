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
 * and versioned per financial year and kind. Three tables:
 *
 * - `open_data_releases`: a release's identity, status and who published or withdrew it, and
 *   its manifest once issued as a Public verifiable document;
 * - `open_data_files`: its dataset files in object storage (JSON and CSV per table, and the
 *   release JSON), each with its SHA-256;
 * - `open_data_release_builds`: builds under way, and failed ones with the files they left.
 *
 * Counts and rates only live in the files; these rows hold no figure. EACC data: row-level
 * security admits `app.tenant` `eacc` and `platform` (the public API reads as `platform`).
 */

/** reporting.yaml `OpenDataRelease.kind`: on NCR approval, or a deliberate mid-year snapshot. */
export const RELEASE_KINDS = ['annual', 'snapshot'] as const;
export type ReleaseKind = (typeof RELEASE_KINDS)[number];

/** reporting.yaml `OpenDataRelease.status`. */
export const RELEASE_STATUSES = ['preview', 'published', 'withdrawn'] as const;
export type ReleaseStatus = (typeof RELEASE_STATUSES)[number];

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
    /**
     * Who built it (subject and name as their token gave it), or null for the release workflow
     * on NCR approval.
     */
    builtBy: text(),
    builtByName: text(),
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

/** `open_data_release_builds.status`: under way, or abandoned with its files left behind. */
export type ReleaseBuildStatus = 'building' | 'failed';

/**
 * A release build under way, or one that failed (spec 09b; `OpenDataReleaseBuilder`): the
 * version it took and when, recorded and committed before its files are written to object
 * storage, so no storage call runs under the year's release lock and every object in the bucket
 * belongs to a row, a release's or a build's. A build that writes its files becomes a release
 * (`preview`) and its row goes; one whose writes fail stays `failed`, naming the objects left
 * under `releases/<releaseId>/` for a sweep, and gives its version back. One build of a year and
 * kind runs at a time; one `building` longer than the builder's lease is taken over as failed (a
 * process that died mid-build). Nothing else reads these rows; no figures.
 */
export const openDataReleaseBuilds = pgTable(
  'open_data_release_builds',
  {
    releaseId: uuid().primaryKey(),
    fy: integer().notNull(),
    kind: text().$type<ReleaseKind>().notNull(),
    version: integer().notNull(),
    status: text().$type<ReleaseBuildStatus>().notNull(),
    /** When the build began: the release's `builtAt`, and the start of its lease. */
    startedAt: timestamp({ withTimezone: true }).notNull(),
    builtBy: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // One build of a year's releases of a kind at a time.
    uniqueIndex('open_data_release_builds_fy_kind_building_key')
      .on(table.fy, table.kind)
      .where(sql`${table.status} = 'building'`),
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

export const openDataSchema = { openDataReleases, openDataFiles, openDataReleaseBuilds };
