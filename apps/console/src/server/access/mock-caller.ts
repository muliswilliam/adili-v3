/** Who calls the access mocks, read from the bearer token's claims (not verified: a mock). */
export interface MockCaller {
  subject: string;
  name: string;
  roles: readonly string[];
}

export function mockCallerOf(request: Request): MockCaller {
  const token = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
  try {
    const claims = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'),
    ) as { sub?: unknown; name?: unknown; realm_access?: { roles?: unknown } };
    const roles = Array.isArray(claims.realm_access?.roles)
      ? claims.realm_access.roles.filter((role): role is string => typeof role === 'string')
      : [];
    return {
      subject: typeof claims.sub === 'string' ? claims.sub : 'unknown',
      name: typeof claims.name === 'string' ? claims.name : 'You',
      roles,
    };
  } catch {
    return { subject: 'unknown', name: 'You', roles: ['access-officer'] };
  }
}

/** A token the mocks read the caller from: subject, name and realm roles. */
export function mockToken(subject: string, name: string, roles: readonly string[]): string {
  const payload = Buffer.from(
    JSON.stringify({ sub: subject, name, realm_access: { roles } }),
  ).toString('base64url');
  return `mock.${payload}.signature`;
}
