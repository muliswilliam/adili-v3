import { ServiceTokenClient } from '@adili/api-kit';

import { config } from './config.js';

/**
 * The directory's own tokens for calling another service's internal API (client credentials,
 * ADR-013 §5), asking for the `scopes` that API requires. One per callee, so each token carries
 * only what that call needs.
 */
export function directoryServiceTokens(...scopes: string[]): ServiceTokenClient {
  return new ServiceTokenClient({
    issuerUrl: config.OIDC_ISSUER_URL,
    clientId: config.KEYCLOAK_CLIENT_ID,
    clientSecret: config.KEYCLOAK_CLIENT_SECRET,
    scopes,
  });
}
