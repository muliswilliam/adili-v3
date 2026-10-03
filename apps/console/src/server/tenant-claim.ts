/**
 * The Commission the signed-in user belongs to: the access token's `tenant` claim, or null when it
 * has none or cannot be read. Read, not verified: the service the token goes to verifies it, so
 * this only picks which Commission to ask for, and a forged claim gets nothing it could not ask
 * for anyway.
 */
export function tenantClaim(accessToken: string): string | null {
  try {
    const claims: unknown = JSON.parse(
      Buffer.from(accessToken.split('.')[1] ?? '', 'base64url').toString('utf8'),
    );
    return typeof claims === 'object' &&
      claims !== null &&
      'tenant' in claims &&
      typeof claims.tenant === 'string'
      ? claims.tenant
      : null;
  } catch {
    return null;
  }
}
