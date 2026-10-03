import type { ReleaseKind } from './schema.js';

/**
 * Events the reporting service publishes about open-data releases (spec 09b, outbox,
 * CloudEvents). The release's id, year, kind and version only: never a figure. The tenant
 * extension is `eacc` and the subject the release id.
 */
export const OPEN_DATA_RELEASE_BUILT = 'open-data.release.built.v1';

/** `open-data.release.built.v1`: a release was built as a preview, its files written. */
export interface OpenDataReleaseBuiltData extends Record<string, unknown> {
  releaseId: string;
  fy: number;
  kind: ReleaseKind;
  version: number;
}
