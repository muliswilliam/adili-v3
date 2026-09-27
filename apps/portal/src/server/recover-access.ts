/**
 * Keycloak's reset-credentials page for the portal client: the declarant enters their email or
 * officer reference and gets a link that sets a new password (it also serves a declarant whose
 * set-password link expired). Built from the OIDC issuer, as sign-in is.
 */
export function recoverAccessUrl(issuerUrl: string, clientId: string): string {
  const url = new URL(`${issuerUrl.replace(/\/+$/, '')}/login-actions/reset-credentials`);
  url.searchParams.set('client_id', clientId);
  return url.toString();
}
