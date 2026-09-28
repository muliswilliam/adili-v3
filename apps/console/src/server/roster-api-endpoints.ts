/** Where a Commission's HR system connects: the roster API and the token endpoint. */
export interface RosterApiEndpoints {
  /** The public API's base URL, without a trailing slash. */
  baseUrl: string;
  /** The OAuth2 token endpoint that exchanges the client ID and secret for a token. */
  tokenEndpoint: string;
}

/**
 * The endpoints from the console's configuration. The token endpoint is the issuer's, as the
 * directory hands it out with a new secret (`tokenEndpoint` on `RosterApiCredentialWithSecret`).
 */
export function rosterApiEndpoints(config: {
  PUBLIC_API_URL: string;
  OIDC_ISSUER_URL: string;
}): RosterApiEndpoints {
  return {
    baseUrl: config.PUBLIC_API_URL.replace(/\/+$/, ''),
    tokenEndpoint: `${config.OIDC_ISSUER_URL.replace(/\/+$/, '')}/protocol/openid-connect/token`,
  };
}
