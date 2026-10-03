/** Response helpers for the in-memory service mocks (review and its documents stand-in). */

export function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': status >= 400 ? 'application/problem+json' : 'application/json',
      ...headers,
    },
  });
}

export function problem(status: number, title: string, code?: string) {
  return json(status, { type: 'about:blank', title, status, ...(code ? { code } : {}) });
}

export function noContent() {
  return new Response(null, { status: 204 });
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return (await request.json()) as unknown;
  } catch {
    return null;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** What the mocks read from a caller's bearer token. */
export interface MockCaller {
  subject: string | null;
  name: string | null;
  /** Keycloak realm roles (`realm_access.roles`). */
  roles: string[];
  /** The Commission the caller belongs to (the `tenant` claim); null for national staff. */
  tenant: string | null;
}

/**
 * The caller from the request's bearer token claims. The mocks do not verify the token (the
 * services would); a missing or unreadable one reads as nobody.
 */
export function mockCallerOf(request: Request): MockCaller {
  const nobody: MockCaller = { subject: null, name: null, roles: [], tenant: null };
  const token = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
  try {
    const claims: unknown = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'),
    );
    if (!isRecord(claims)) return nobody;
    const access = claims.realm_access;
    const roles = isRecord(access) && Array.isArray(access.roles) ? access.roles : [];
    return {
      subject: typeof claims.sub === 'string' ? claims.sub : null,
      name: typeof claims.name === 'string' ? claims.name : null,
      roles: roles.filter((role): role is string => typeof role === 'string'),
      tenant: typeof claims.tenant === 'string' ? claims.tenant : null,
    };
  } catch {
    return nobody;
  }
}

/** An unsigned bearer token with the claims `mockCallerOf` reads, for tests and mock clients. */
export function unsignedMockToken({
  subject,
  name,
  roles,
  tenant,
}: {
  subject: string;
  name: string;
  roles?: readonly string[];
  tenant?: string;
}): string {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const claims = {
    sub: subject,
    name,
    ...(roles ? { realm_access: { roles } } : {}),
    ...(tenant ? { tenant } : {}),
  };
  return `${part({ alg: 'none' })}.${part(claims)}.`;
}

/** The document a documents `GET /v1/documents/{documentId}/download` request names, or null. */
export function documentDownloadIdOf(request: Request): string | null {
  if (request.method !== 'GET') return null;
  return /^\/v1\/documents\/([^/]+)\/download$/.exec(new URL(request.url).pathname)?.[1] ?? null;
}
