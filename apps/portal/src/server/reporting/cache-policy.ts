/**
 * How long the portal trusts its copy of what tells a release's status: a minute, not the API's
 * hour, so a release EACC publishes or withdraws shows on the page (or gets its withdrawn
 * banner) within a minute. Browsers are told the same for the release JSON download.
 */
export const RELEASE_STATUS_MAX_AGE_MS = 60_000;

/** The list of releases, and one release's record; not its tables. */
const RELEASE_STATUS_PATH = /\/open-data\/v1\/releases(?:\/[^/]+\/[^/]+\/[^/]+)?$/;

/**
 * The cap on a URL's copy (`publicCache`'s `maxAgeCapMs`): `RELEASE_STATUS_MAX_AGE_MS` for the
 * list and a release's record, none for the tables, whose content never changes.
 */
export function releaseStatusCap(url: string): number | undefined {
  return RELEASE_STATUS_PATH.test(new URL(url).pathname) ? RELEASE_STATUS_MAX_AGE_MS : undefined;
}
