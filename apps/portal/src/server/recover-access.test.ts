import { describe, expect, it } from 'vitest';

import { recoverAccessUrl } from './recover-access';

describe('recoverAccessUrl', () => {
  it("points at the realm's reset-credentials page for the portal client", () => {
    expect(recoverAccessUrl('http://localhost:8080/realms/adili', 'portal')).toBe(
      'http://localhost:8080/realms/adili/login-actions/reset-credentials?client_id=portal',
    );
  });

  it('copes with a trailing slash on the issuer', () => {
    expect(recoverAccessUrl('https://id.adili.go.ke/realms/adili/', 'portal')).toBe(
      'https://id.adili.go.ke/realms/adili/login-actions/reset-credentials?client_id=portal',
    );
  });
});
