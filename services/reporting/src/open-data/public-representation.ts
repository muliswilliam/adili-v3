import type { OpenDataFileRow, OpenDataReleaseRow } from './representation.js';
import type { ReleaseKind } from './schema.js';
import { OPEN_DATA_TABLES, type OpenDataTableName } from './tables.js';

/** The statuses the public sees: a preview is EACC's until it is published. */
export const PUBLIC_RELEASE_STATUSES = ['published', 'withdrawn'] as const;
export type PublicReleaseStatus = (typeof PUBLIC_RELEASE_STATUSES)[number];

/** A release row the public may see. */
export type PublicReleaseRow = OpenDataReleaseRow & { status: PublicReleaseStatus };

/**
 * reporting.yaml `PublicOpenDataRelease`: a published or withdrawn release as anyone may read
 * it. Ids, figures' metadata and hashes only: never who built, published or withdrew it (no
 * person's name or subject) nor the manifest's document id; the manifest is reached through its
 * verification code and verify page. A withdrawn release keeps its tables (still served) and
 * carries when and why, and the version that corrects it once one is published.
 */
export interface PublicOpenDataReleaseView {
  id: string;
  fy: number;
  kind: ReleaseKind;
  version: number;
  status: PublicReleaseStatus;
  builtAt: string;
  publishedAt: string;
  withdrawnAt: string | null;
  withdrawnReason: string | null;
  /** The latest published version of the same year and kind after a withdrawn one; else null. */
  correctedVersion: number | null;
  manifestVerificationId: string;
  /** The manifest's page on the verify app, as its QR code links it. */
  verifyUrl: string;
  tables: { table: OpenDataTableName; rows: number; sha256Json: string; sha256Csv: string }[];
}

/**
 * The release's public view. `siblings` are the public releases of the same year and kind (any
 * order; the release itself may be among them), for the version correcting a withdrawn one.
 */
export function publicOpenDataReleaseView(
  release: PublicReleaseRow,
  files: readonly OpenDataFileRow[],
  siblings: readonly Pick<OpenDataReleaseRow, 'version' | 'status'>[],
  verifyBaseUrl: string,
): PublicOpenDataReleaseView {
  const { publishedAt, verificationId } = release;
  // Publishing issues the manifest first and stamps the time: a public release has both.
  if (!publishedAt || !verificationId) {
    throw new Error(`Open-data release ${release.id} is ${release.status} without its manifest`);
  }
  const fileOf = (table: OpenDataTableName, format: 'json' | 'csv') =>
    files.find((file) => file.table === table && file.format === format);
  return {
    id: release.id,
    fy: release.fy,
    kind: release.kind,
    version: release.version,
    status: release.status,
    builtAt: release.builtAt.toISOString(),
    publishedAt: publishedAt.toISOString(),
    withdrawnAt: release.withdrawnAt?.toISOString() ?? null,
    withdrawnReason: release.withdrawnReason,
    correctedVersion: release.status === 'withdrawn' ? correctionOf(release, siblings) : null,
    manifestVerificationId: verificationId,
    verifyUrl: verifyUrlOf(verifyBaseUrl, verificationId),
    tables: OPEN_DATA_TABLES.flatMap((table) => {
      const json = fileOf(table, 'json');
      const csv = fileOf(table, 'csv');
      return json && csv
        ? [{ table, rows: json.rows, sha256Json: json.sha256, sha256Csv: csv.sha256 }]
        : [];
    }),
  };
}

/** When the release last changed as the public sees it: built, published or withdrawn. */
export function lastChangeOf(release: OpenDataReleaseRow): Date {
  const instants = [release.builtAt, release.publishedAt, release.withdrawnAt].filter(
    (instant): instant is Date => instant !== null,
  );
  return new Date(Math.max(...instants.map((instant) => instant.getTime())));
}

/** documents' verify page of a code: `<origin>/v/<code>`. */
export function verifyUrlOf(verifyBaseUrl: string, verificationId: string): string {
  return new URL(`/v/${encodeURIComponent(verificationId)}`, verifyBaseUrl).toString();
}

function correctionOf(
  release: OpenDataReleaseRow,
  siblings: readonly Pick<OpenDataReleaseRow, 'version' | 'status'>[],
): number | null {
  const later = siblings
    .filter((each) => each.status === 'published' && each.version > release.version)
    .map((each) => each.version);
  return later.length > 0 ? Math.max(...later) : null;
}
