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

/**
 * `open-data.release.published.v1`: a release went public, on its NCR's approval (annual) or
 * by an EACC supervisor (snapshot), its manifest issued as a Public verifiable document.
 */
export const OPEN_DATA_RELEASE_PUBLISHED = 'open-data.release.published.v1';
export type OpenDataReleasePublishedData = OpenDataReleaseBuiltData;

/**
 * `open-data.release.withdrawn.v1`: an EACC supervisor withdrew a published release. Its files
 * are still served, marked withdrawn with the reason, which the event does not carry.
 */
export const OPEN_DATA_RELEASE_WITHDRAWN = 'open-data.release.withdrawn.v1';
export type OpenDataReleaseWithdrawnData = OpenDataReleaseBuiltData;
