import { describe, expect, it } from 'vitest';

import { rosterApiEndpoints } from './roster-api-endpoints';

describe('rosterApiEndpoints', () => {
  it('names the API base and the issuer token endpoint', () => {
    expect(
      rosterApiEndpoints({
        PUBLIC_API_URL: 'https://api.adili.go.ke',
        OIDC_ISSUER_URL: 'https://id.adili.go.ke/realms/adili',
      }),
    ).toEqual({
      baseUrl: 'https://api.adili.go.ke',
      tokenEndpoint: 'https://id.adili.go.ke/realms/adili/protocol/openid-connect/token',
    });
  });

  it('drops trailing slashes so paths join cleanly', () => {
    expect(
      rosterApiEndpoints({
        PUBLIC_API_URL: 'http://localhost:4001/',
        OIDC_ISSUER_URL: 'http://localhost:8080/realms/adili/',
      }),
    ).toEqual({
      baseUrl: 'http://localhost:4001',
      tokenEndpoint: 'http://localhost:8080/realms/adili/protocol/openid-connect/token',
    });
  });
});
