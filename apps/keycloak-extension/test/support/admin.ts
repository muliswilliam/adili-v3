/** Keycloak's Admin REST API on the `adili` realm, as compose bootstraps it (admin / admin_dev). */
export function keycloakAdmin(keycloakUrl: string) {
  async function adminToken(): Promise<string> {
    const response = await fetch(`${keycloakUrl}/realms/master/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: 'admin-cli',
        username: 'admin',
        password: 'admin_dev',
      }),
    });
    if (!response.ok) throw new Error(`admin token: ${response.status}`);
    return ((await response.json()) as { access_token: string }).access_token;
  }

  /** Throws on any answer but 2xx. */
  async function adminFetch(token: string, path: string, init: RequestInit = {}) {
    const response = await fetch(`${keycloakUrl}/admin/realms/adili${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    });
    if (!response.ok)
      throw new Error(
        `${init.method ?? 'GET'} ${path}: ${response.status} ${await response.text()}`,
      );
    return response;
  }

  return { adminToken, adminFetch };
}
