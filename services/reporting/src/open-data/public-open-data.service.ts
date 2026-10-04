import { Inject, Injectable } from '@nestjs/common';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';

import type { ReportingTransaction } from '../compliance-reports/reports.js';
import type { ReportingSchema } from '../db/schema.js';
import { PLATFORM_TENANT, SYSTEM_SUBJECT } from '../system-context.js';
import { type FileFormat, objectKeyOf, sha256 } from './files.js';
import { OpenDataFiles } from './open-data-files.js';
import {
  lastChangeOf,
  PUBLIC_RELEASE_STATUSES,
  type PublicOpenDataReleaseView,
  publicOpenDataReleaseView,
  type PublicReleaseRow,
} from './public-representation.js';
import { ReleaseNotFound } from './representation.js';
import type { ReleaseKind } from './schema.js';
import { openDataFiles, openDataReleases } from './schema.js';
import type { OpenDataTableName } from './tables.js';

/** Injection token of the verify app's origin (`VERIFY_BASE_URL`). */
export const VERIFY_BASE_URL = Symbol('VERIFY_BASE_URL');

/** A release by its public identity: year, kind and version. */
export interface PublicReleaseKey {
  fy: number;
  kind: ReleaseKind;
  version: number;
}

/** A response body with what caches validate it by. */
export interface CacheableBody {
  body: Buffer;
  /** SHA-256 (hex) of `body`. */
  sha256: string;
  lastModified: Date;
}

/**
 * The public open-data API's reads (spec 09b): published and withdrawn releases only (a preview
 * is EACC's), in their public representation, and their tables' files as stored, byte for
 * byte, so the hashes in the release and its manifest identify what is served. Releases are
 * EACC's data, read in the platform's row-level security context.
 */
@Injectable()
export class PublicOpenDataService {
  constructor(
    @InjectDatabase() private readonly db: Database<ReportingSchema>,
    private readonly files: OpenDataFiles,
    @Inject(VERIFY_BASE_URL) private readonly verifyBaseUrl: string,
  ) {}

  /** Every public release, the latest year first, then by kind and the latest version first. */
  async list(): Promise<{ releases: PublicOpenDataReleaseView[]; lastModified: Date | null }> {
    return this.asPlatform(async (tx) => {
      const releases = (await tx
        .select()
        .from(openDataReleases)
        .where(inArray(openDataReleases.status, [...PUBLIC_RELEASE_STATUSES]))
        .orderBy(
          desc(openDataReleases.fy),
          asc(openDataReleases.kind),
          desc(openDataReleases.version),
        )) as PublicReleaseRow[];
      if (releases.length === 0) return { releases: [], lastModified: null };
      const files = await tx
        .select()
        .from(openDataFiles)
        .where(
          inArray(
            openDataFiles.releaseId,
            releases.map((release) => release.id),
          ),
        );
      return {
        releases: releases.map((release) =>
          publicOpenDataReleaseView(
            release,
            files.filter((file) => file.releaseId === release.id),
            releases.filter((each) => each.fy === release.fy && each.kind === release.kind),
            this.verifyBaseUrl,
          ),
        ),
        lastModified: new Date(Math.max(...releases.map((each) => lastChangeOf(each).getTime()))),
      };
    });
  }

  /** The release, `ReleaseNotFound` unless it is public. */
  async release(
    key: PublicReleaseKey,
  ): Promise<{ release: PublicOpenDataReleaseView; lastModified: Date }> {
    return this.asPlatform(async (tx) => {
      const release = await publicRelease(tx, key);
      const files = await tx
        .select()
        .from(openDataFiles)
        .where(eq(openDataFiles.releaseId, release.id));
      const siblings = await tx
        .select({ version: openDataReleases.version, status: openDataReleases.status })
        .from(openDataReleases)
        .where(and(eq(openDataReleases.fy, key.fy), eq(openDataReleases.kind, key.kind)));
      return {
        release: publicOpenDataReleaseView(release, files, siblings, this.verifyBaseUrl),
        lastModified: lastChangeOf(release),
      };
    });
  }

  /**
   * The table's file in `format` as stored (the JSON is reporting.yaml's `getOpenDataTable`
   * body), also of a withdrawn release. `ReleaseNotFound` unless the release is public;
   * the store's `OpenDataStorageUnavailable` and `OpenDataFileMissing` propagate.
   */
  async table(
    key: PublicReleaseKey,
    table: OpenDataTableName,
    format: FileFormat,
  ): Promise<CacheableBody> {
    const { releaseId, file, builtAt } = await this.asPlatform(async (tx) => {
      const release = await publicRelease(tx, key);
      const [row] = await tx
        .select()
        .from(openDataFiles)
        .where(
          and(
            eq(openDataFiles.releaseId, release.id),
            eq(openDataFiles.table, table),
            eq(openDataFiles.format, format),
          ),
        );
      return { releaseId: release.id, file: row, builtAt: release.builtAt };
    });
    if (!file) throw new Error(`Open-data release ${releaseId} has no ${table}.${format}`);
    const body = Buffer.from(await this.files.get(objectKeyOf(releaseId, table, format)));
    // The bytes are the release's, written once when it was built.
    return { body, sha256: file.sha256, lastModified: builtAt };
  }

  private asPlatform<T>(work: (tx: ReportingTransaction) => Promise<T>): Promise<T> {
    return withTenant(this.db, { tenant: PLATFORM_TENANT, subject: SYSTEM_SUBJECT }, work);
  }
}

/** A JSON response body with its SHA-256, for the views the service builds. */
export function jsonBody(value: unknown): { body: Buffer; sha256: string } {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  return { body, sha256: sha256(body) };
}

async function publicRelease(
  tx: ReportingTransaction,
  key: PublicReleaseKey,
): Promise<PublicReleaseRow> {
  const [release] = await tx
    .select()
    .from(openDataReleases)
    .where(
      and(
        eq(openDataReleases.fy, key.fy),
        eq(openDataReleases.kind, key.kind),
        eq(openDataReleases.version, key.version),
        inArray(openDataReleases.status, [...PUBLIC_RELEASE_STATUSES]),
      ),
    );
  if (!release) {
    throw new ReleaseNotFound(
      `No public open-data release ${String(key.fy)} ${key.kind} v${String(key.version)}`,
    );
  }
  return release as PublicReleaseRow;
}
