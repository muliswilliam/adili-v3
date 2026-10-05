import { describe, expect, it } from 'vitest';

import { RELEASE_STATUS_MAX_AGE_MS, releaseStatusCap } from './cache-policy';

const BASE = 'http://reporting.test';

describe('how long the portal trusts a copy of the open-data API', () => {
  it('caps the list of releases and a release’s record at a minute (publish, withdraw)', () => {
    expect(releaseStatusCap(`${BASE}/open-data/v1/releases`)).toBe(RELEASE_STATUS_MAX_AGE_MS);
    expect(releaseStatusCap(`${BASE}/open-data/v1/releases/2025/annual/1`)).toBe(60_000);
    expect(releaseStatusCap(`${BASE}/open-data/v1/releases/2024/snapshot/12`)).toBe(60_000);
  });

  it('leaves the tables, which never change, to the API’s max-age', () => {
    expect(
      releaseStatusCap(`${BASE}/open-data/v1/releases/2025/annual/1/tables/by-cycle`),
    ).toBeUndefined();
    expect(
      releaseStatusCap(`${BASE}/open-data/v1/releases/2025/annual/1/tables/by-cycle.csv`),
    ).toBeUndefined();
  });

  it('matches the path, behind a gateway prefix too, never the query', () => {
    expect(releaseStatusCap(`${BASE}/gateway/open-data/v1/releases?x=1`)).toBe(60_000);
    expect(releaseStatusCap(`${BASE}/other?next=/open-data/v1/releases`)).toBeUndefined();
  });
});
