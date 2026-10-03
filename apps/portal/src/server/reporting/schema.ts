/**
 * The reporting service's public open-data API (spec 09b S8), typed by hand in the shape
 * openapi-typescript generates, so the client and mock read it as they would a `schema.gen.ts`.
 *
 * TODO(#491): replace this file with `schema.gen.ts`, generated from
 * `packages/schemas/internal/reporting.yaml` by the portal's `generate` script, once #491 lands
 * the public `/open-data/v1/*` operations in that contract. This branch cannot generate it: the
 * contract on main still has the earlier draft (`/open-data/v1/releases/{fy}/{version}`, no
 * `kind`), and the contract drift check fails on a client generated from anything else. Only the
 * operations the portal calls are here, copied from #491's `reporting.yaml`; keep them in step
 * with it until then.
 */

type OpenDataTableName =
  | 'filing-by-commission'
  | 'compliance-by-commission'
  | 'by-entity-type'
  | 'by-cycle'
  | 'access-requests'
  | 'national-totals';

type ReleaseKind = 'annual' | 'snapshot';

interface ReleasePath {
  /** Financial year start year, e.g. 2027 for 1 July 2027 to 30 June 2028. */
  fy: number;
  kind: ReleaseKind;
  /** 1, 2, ... per financial year and kind; a corrected release is the next version. */
  version: number;
}

interface TablePath extends ReleasePath {
  table: OpenDataTableName;
}

interface Problem {
  headers: Record<string, unknown>;
  content: { 'application/problem+json': components['schemas']['ProblemDetails'] };
}

interface NotModified {
  headers: Record<string, unknown>;
  content?: never;
}

interface Ok<Content> {
  headers: Record<string, unknown>;
  content: Content;
}

export interface components {
  schemas: {
    OpenDataTable: OpenDataTableName;
    /**
     * A published or withdrawn release as the public sees it. Never who built, published or
     * withdrew it, nor the manifest's document id.
     */
    PublicOpenDataRelease: {
      id: string;
      /** Financial year start year. */
      fy: number;
      kind: ReleaseKind;
      version: number;
      status: 'published' | 'withdrawn';
      builtAt: string;
      publishedAt: string;
      withdrawnAt: string | null;
      /** Why EACC withdrew it (the withdrawn banner); null unless withdrawn. */
      withdrawnReason: string | null;
      /**
       * For a withdrawn release, the latest published version of the same year and kind that
       * corrects it; null otherwise or until one is published.
       */
      correctedVersion: number | null;
      /** Verification code of the release manifest (a Public verifiable document). */
      manifestVerificationId: string;
      /** The manifest's verify page (`<verify app>/v/<code>`). */
      verifyUrl: string;
      tables: {
        table: OpenDataTableName;
        rows: number;
        /** SHA-256 (hex) of the table's JSON as `getOpenDataTable` serves it. */
        sha256Json: string;
        /** SHA-256 (hex) of the table's CSV. */
        sha256Csv: string;
      }[];
    };
    /** `getOpenDataTable` as JSON. */
    OpenDataTableBody: {
      table: OpenDataTableName;
      columns: string[];
      rows: Record<string, unknown>[];
      suppression: {
        threshold: number;
        /** Figures hidden by suppression; figures not collected are not counted. */
        cellsSuppressed: number;
      };
      /**
       * Figures not collected yet: columns, or in `national-totals` measures, whose values are
       * null for want of data, not suppression (`suppressed` stays false).
       */
      notCollected: string[];
    };
    ProblemDetails: {
      type: string;
      title: string;
      status: number;
      detail?: string;
      instance?: string;
      code?: string;
      errors?: { path: string; message: string }[];
    };
  };
}

export interface paths {
  '/open-data/v1/releases': {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    get: operations['listOpenDataReleases'];
  };
  '/open-data/v1/releases/{fy}/{kind}/{version}': {
    parameters: { query?: never; header?: never; path: ReleasePath; cookie?: never };
    get: operations['getOpenDataRelease'];
  };
  '/open-data/v1/releases/{fy}/{kind}/{version}/tables/{table}': {
    parameters: { query?: never; header?: never; path: TablePath; cookie?: never };
    get: operations['getOpenDataTable'];
  };
  '/open-data/v1/releases/{fy}/{kind}/{version}/tables/{table}.csv': {
    parameters: { query?: never; header?: never; path: TablePath; cookie?: never };
    get: operations['getOpenDataTableCsv'];
  };
}

export interface operations {
  listOpenDataReleases: {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    requestBody?: never;
    responses: {
      200: Ok<{ 'application/json': components['schemas']['PublicOpenDataRelease'][] }>;
      304: NotModified;
      429: Problem;
    };
  };
  getOpenDataRelease: {
    parameters: { query?: never; header?: never; path: ReleasePath; cookie?: never };
    requestBody?: never;
    responses: {
      200: Ok<{ 'application/json': components['schemas']['PublicOpenDataRelease'] }>;
      304: NotModified;
      400: Problem;
      404: Problem;
      429: Problem;
    };
  };
  getOpenDataTable: {
    parameters: { query?: never; header?: never; path: TablePath; cookie?: never };
    requestBody?: never;
    responses: {
      200: Ok<{
        'application/json': components['schemas']['OpenDataTableBody'];
        'text/csv': string;
      }>;
      304: NotModified;
      400: Problem;
      404: Problem;
      406: Problem;
      429: Problem;
      503: Problem;
    };
  };
  getOpenDataTableCsv: {
    parameters: { query?: never; header?: never; path: TablePath; cookie?: never };
    requestBody?: never;
    responses: {
      200: Ok<{ 'text/csv': string }>;
      304: NotModified;
      400: Problem;
      404: Problem;
      429: Problem;
      503: Problem;
    };
  };
}
