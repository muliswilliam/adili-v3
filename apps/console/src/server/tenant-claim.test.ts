import { describe, expect, it } from 'vitest';

import { unsignedMockToken } from './mock-http';
import { tenantClaim } from './tenant-claim';

describe("the session's tenant claim", () => {
  it("reads the Commission from the access token's tenant claim", () => {
    expect(tenantClaim(unsignedMockToken({ subject: 's', name: 'N', tenant: 'psc' }))).toBe('psc');
  });

  it('is null without a tenant claim or for a token it cannot read', () => {
    expect(tenantClaim(unsignedMockToken({ subject: 's', name: 'N' }))).toBeNull();
    expect(tenantClaim('not-a-token')).toBeNull();
    expect(tenantClaim('a.e30K.b')).toBeNull();
  });
});
