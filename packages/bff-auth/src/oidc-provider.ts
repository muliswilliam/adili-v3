import * as oidc from 'openid-client';

export interface TokenSet {
  accessToken: string;
  expiresInSeconds: number;
  refreshToken?: string;
  /** Keycloak extension: lifetime of the refresh token, i.e. the SSO session idle limit. */
  refreshExpiresInSeconds?: number;
  idToken?: string;
  claims?: IdTokenClaims;
}

export interface IdTokenClaims {
  sub: string;
  name?: string;
  email?: string;
  preferred_username?: string;
  /** Authentication context class the provider reports it satisfied, e.g. `step-up`. */
  acr?: string;
  /** When the user last actively authenticated, in seconds since the epoch. */
  auth_time?: number;
}

/** The OpenID Provider operations the BFF needs; a seam for tests. */
export interface OidcProvider {
  authorizationUrl(params: {
    redirectUri: string;
    state: string;
    nonce: string;
    codeChallenge: string;
    /** Requested authentication context classes (`acr_values`), e.g. `step-up`. */
    acrValues?: string;
  }): Promise<URL>;
  exchangeCode(
    callbackUrl: URL,
    checks: { codeVerifier: string; state: string; nonce: string },
  ): Promise<TokenSet>;
  refresh(refreshToken: string): Promise<TokenSet>;
  endSessionUrl(params: { idTokenHint?: string; postLogoutRedirectUri: string }): Promise<URL>;
}

export interface OpenIdProviderOptions {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  /** Plain-HTTP issuers (local Keycloak) are refused unless explicitly allowed. */
  allowHttp: boolean;
}

/** OidcProvider backed by openid-client, with discovery cached after the first success. */
export function createOpenIdProvider(options: OpenIdProviderOptions): OidcProvider {
  let configuration: Promise<oidc.Configuration> | undefined;
  const getConfiguration = () => {
    configuration ??= oidc
      .discovery(new URL(options.issuerUrl), options.clientId, options.clientSecret, undefined, {
        // Deprecated only as a warning sign; used solely for the local plain-HTTP Keycloak.
        // eslint-disable-next-line @typescript-eslint/no-deprecated
        execute: options.allowHttp ? [oidc.allowInsecureRequests] : [],
      })
      .catch((error: unknown) => {
        // Retry discovery on the next request instead of caching the failure.
        configuration = undefined;
        throw error;
      });
    return configuration;
  };

  return {
    async authorizationUrl({ redirectUri, state, nonce, codeChallenge, acrValues }) {
      const parameters: Record<string, string> = {
        redirect_uri: redirectUri,
        scope: 'openid profile email',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        state,
        nonce,
      };
      if (acrValues) parameters.acr_values = acrValues;
      return oidc.buildAuthorizationUrl(await getConfiguration(), parameters);
    },
    async exchangeCode(callbackUrl, { codeVerifier, state, nonce }) {
      const tokens = await oidc.authorizationCodeGrant(await getConfiguration(), callbackUrl, {
        pkceCodeVerifier: codeVerifier,
        expectedState: state,
        expectedNonce: nonce,
        idTokenExpected: true,
      });
      return toTokenSet(tokens);
    },
    async refresh(refreshToken) {
      return toTokenSet(await oidc.refreshTokenGrant(await getConfiguration(), refreshToken));
    },
    async endSessionUrl({ idTokenHint, postLogoutRedirectUri }) {
      const parameters: Record<string, string> = {
        post_logout_redirect_uri: postLogoutRedirectUri,
      };
      if (idTokenHint) parameters.id_token_hint = idTokenHint;
      return oidc.buildEndSessionUrl(await getConfiguration(), parameters);
    },
  };
}

function toTokenSet(
  tokens: oidc.TokenEndpointResponse & oidc.TokenEndpointResponseHelpers,
): TokenSet {
  const claims = tokens.claims();
  const refreshExpiresIn = tokens.refresh_expires_in;
  return {
    accessToken: tokens.access_token,
    expiresInSeconds: tokens.expiresIn() ?? 60,
    refreshToken: tokens.refresh_token,
    refreshExpiresInSeconds: typeof refreshExpiresIn === 'number' ? refreshExpiresIn : undefined,
    idToken: tokens.id_token,
    claims: claims
      ? {
          sub: claims.sub,
          name: stringClaim(claims.name),
          email: stringClaim(claims.email),
          preferred_username: stringClaim(claims.preferred_username),
          acr: stringClaim(claims.acr),
          auth_time: typeof claims.auth_time === 'number' ? claims.auth_time : undefined,
        }
      : undefined,
  };
}

function stringClaim(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
