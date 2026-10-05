import { describe, expect, it } from 'vitest';

import { oidcRealmUrl } from '../src/config.js';

describe('oidcRealmUrl', () => {
  it('reaches the realm at its issuer by default', () => {
    expect(oidcRealmUrl({ OIDC_ISSUER_URL: 'http://localhost:8080/realms/adili' })).toBe(
      'http://localhost:8080/realms/adili',
    );
  });

  it('reaches it at the internal URL when the issuer is only the public name', () => {
    expect(
      oidcRealmUrl({
        OIDC_ISSUER_URL: 'https://demo.example:8080/realms/adili',
        OIDC_INTERNAL_URL: 'http://127.0.0.1:18080/realms/adili',
      }),
    ).toBe('http://127.0.0.1:18080/realms/adili');
  });
});
