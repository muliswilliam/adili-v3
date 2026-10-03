import type { OpenDataClient } from './reporting/client.server';
import {
  type NationalTotalsRow,
  OPEN_DATA_TABLES,
  type OpenDataRelease,
  type OpenDataTableName,
  readTable,
  type ReleaseKind,
  type ReleaseTables,
} from './reporting/types';
import { type NotFound, notFound, type Unavailable, unavailable } from './results';

/**
 * The public Open data page's reads of the reporting service's open-data API (spec 09b S8,
 * S11): the releases, the one shown with its six tables, and the national trend. Pure: the
 * caller injects the client (`open-data.ts`).
 */

export interface RateLimited {
  status: 'rate-limited';
  retryAfterSeconds: number | null;
}

/** A release to show; whatever is left out is chosen (`pickRelease`). */
export interface ReleaseSelection {
  fy?: number;
  kind?: ReleaseKind;
  version?: number;
}

/** A year and kind of release, as the release selector offers them. */
export interface ReleaseChoice {
  fy: number;
  kind: ReleaseKind;
}

/** A year's national figures, from its current annual release. */
export interface TrendPoint {
  fy: number;
  totals: NationalTotalsRow[];
}

export interface OpenDataPage {
  status: 'ok';
  choices: ReleaseChoice[];
  release: OpenDataRelease;
  /** Every version of the release's year and kind, latest first. */
  versions: Pick<OpenDataRelease, 'version' | 'status'>[];
  tables: ReleaseTables;
  /** Up to the release's year, oldest first. */
  trend: TrendPoint[];
}

export type OpenDataPageResult =
  OpenDataPage | { status: 'empty' } | NotFound | RateLimited | Unavailable;

class Failure extends Error {
  constructor(readonly result: NotFound | RateLimited | Unavailable) {
    super(result.status);
  }
}

/** Reads a non-200 answer as the result the page shows. */
function failure(response: Response): Failure {
  if (response.status === 429) {
    const seconds = Number(response.headers.get('retry-after'));
    return new Failure({
      status: 'rate-limited',
      retryAfterSeconds: Number.isFinite(seconds) && seconds > 0 ? seconds : null,
    });
  }
  if (response.status === 404 || response.status === 400) return new Failure(notFound);
  return new Failure(unavailable);
}

async function settle<T>(
  call: () => Promise<T>,
): Promise<T | NotFound | RateLimited | Unavailable> {
  try {
    return await call();
  } catch (error) {
    // A thrown error other than an answer read (network, timeout) is the service being down.
    return error instanceof Failure ? error.result : unavailable;
  }
}

async function listReleases(client: OpenDataClient): Promise<OpenDataRelease[]> {
  const { data, response } = await client.GET('/open-data/v1/releases');
  if (!data) throw failure(response);
  return data;
}

/** One table of a release, as JSON. */
async function getTable<Name extends OpenDataTableName>(
  client: OpenDataClient,
  release: OpenDataRelease,
  table: Name,
): Promise<ReleaseTables[Name]> {
  const { data, response } = await client.GET(
    '/open-data/v1/releases/{fy}/{kind}/{version}/tables/{table}',
    { params: { path: { fy: release.fy, kind: release.kind, version: release.version, table } } },
  );
  // The operation also serves CSV; asked for JSON, a string is not an answer to read.
  if (!data || typeof data === 'string') throw failure(response);
  return readTable(data, table);
}

async function readTables(
  client: OpenDataClient,
  release: OpenDataRelease,
): Promise<ReleaseTables> {
  const tables = await Promise.all(
    OPEN_DATA_TABLES.map(async (table) => [table, await getTable(client, release, table)] as const),
  );
  return Object.fromEntries(tables) as unknown as ReleaseTables;
}

/** The current version of a year and kind: its latest published one, else its latest. */
function currentOf(releases: OpenDataRelease[], fy: number, kind: ReleaseKind) {
  const versions = releases
    .filter((release) => release.fy === fy && release.kind === kind)
    .sort((a, b) => b.version - a.version);
  return versions.find((release) => release.status === 'published') ?? versions[0];
}

/**
 * The release a selection names. Without a year, the latest year; without a kind, its annual
 * release if it has one (a mid-year snapshot otherwise); without a version, the current one.
 */
export function pickRelease(
  releases: OpenDataRelease[],
  selection: ReleaseSelection,
): OpenDataRelease | undefined {
  const fy = selection.fy ?? Math.max(...releases.map((release) => release.fy));
  const kind =
    selection.kind ??
    (releases.some((release) => release.fy === fy && release.kind === 'annual')
      ? 'annual'
      : 'snapshot');
  if (selection.version === undefined) return currentOf(releases, fy, kind);
  return releases.find(
    (release) =>
      release.fy === fy && release.kind === kind && release.version === selection.version,
  );
}

/** The Open data page: the releases, the one selected with its tables, and the trend. */
export async function loadOpenDataPage(
  client: OpenDataClient,
  selection: ReleaseSelection,
): Promise<OpenDataPageResult> {
  return settle(async (): Promise<OpenDataPageResult> => {
    const releases = await listReleases(client);
    if (releases.length === 0) return { status: 'empty' };
    const release = pickRelease(releases, selection);
    if (!release) return notFound;

    const choices: ReleaseChoice[] = [];
    for (const { fy, kind } of [...releases].sort(
      (a, b) => b.fy - a.fy || (a.kind === b.kind ? 0 : a.kind === 'annual' ? -1 : 1),
    )) {
      if (!choices.some((choice) => choice.fy === fy && choice.kind === kind)) {
        choices.push({ fy, kind });
      }
    }
    const versions = releases
      .filter((each) => each.fy === release.fy && each.kind === release.kind)
      .sort((a, b) => b.version - a.version)
      .map(({ version, status }) => ({ version, status }));

    // Each year's current annual release, up to the year shown, oldest first; the year shown
    // from the release shown (a withdrawn version too), so the trend agrees with its tables.
    const annuals = [...new Set(releases.map((each) => each.fy))]
      .filter((fy) => fy <= release.fy)
      .sort((a, b) => a - b)
      .flatMap((fy) =>
        fy === release.fy && release.kind === 'annual'
          ? release
          : (currentOf(releases, fy, 'annual') ?? []),
      );
    const [tables, trend] = await Promise.all([
      readTables(client, release),
      Promise.all(
        annuals.map(async (annual): Promise<TrendPoint> => ({
          fy: annual.fy,
          totals: (await getTable(client, annual, 'national-totals')).rows,
        })),
      ),
    ]);
    return { status: 'ok', choices, release, versions, tables, trend };
  });
}

/** A file of a release, as the API serves it, for the page's download links. */
export interface OpenDataFileRef {
  fy: number;
  kind: ReleaseKind;
  version: number;
  /** `<table>.csv`, or `release.json` for the release itself. */
  file: string;
}

export type OpenDataFileResult =
  | { status: 'ok'; body: string; contentType: string; fileName: string }
  | NotFound
  | RateLimited
  | Unavailable;

/**
 * A table's CSV byte for byte (its SHA-256 is the release's `sha256Csv`), or the release JSON
 * (what the manifest's verification code vouches for), named for the year, kind and version.
 */
export async function loadOpenDataFile(
  client: OpenDataClient,
  ref: OpenDataFileRef,
): Promise<OpenDataFileResult> {
  const path = { fy: ref.fy, kind: ref.kind, version: ref.version };
  const prefix = `adili-open-data-${String(ref.fy)}-${ref.kind}-v${String(ref.version)}`;
  return settle(async (): Promise<OpenDataFileResult> => {
    if (ref.file === 'release.json') {
      const { data, response } = await client.GET('/open-data/v1/releases/{fy}/{kind}/{version}', {
        params: { path },
        parseAs: 'text',
      });
      if (data === undefined) throw failure(response);
      return {
        status: 'ok',
        body: data,
        contentType: 'application/json; charset=utf-8',
        fileName: `${prefix}-release.json`,
      };
    }
    const table = ref.file.replace(/\.csv$/, '') as OpenDataTableName;
    if (!ref.file.endsWith('.csv') || !OPEN_DATA_TABLES.includes(table)) return notFound;
    const { data, response } = await client.GET(
      '/open-data/v1/releases/{fy}/{kind}/{version}/tables/{table}.csv',
      { params: { path: { ...path, table } }, parseAs: 'text' },
    );
    if (data === undefined) throw failure(response);
    return {
      status: 'ok',
      body: data,
      contentType: response.headers.get('content-type') ?? 'text/csv; charset=utf-8',
      fileName: `${prefix}-${table}.csv`,
    };
  });
}
