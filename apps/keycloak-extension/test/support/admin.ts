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

  /** The config of an execution in the `adili otp` flow, by provider id. */
  async function readConfig(
    token: string,
    providerId: string,
  ): Promise<{ id: string; config: Record<string, string> }> {
    const executions = (await (
      await adminFetch(token, `/authentication/flows/${encodeURIComponent('adili otp')}/executions`)
    ).json()) as { authenticationConfig?: string; providerId?: string }[];
    const configId = executions.find(
      (execution) => execution.providerId === providerId,
    )?.authenticationConfig;
    if (!configId) throw new Error(`adili otp has no configured ${providerId}`);
    return (await (await adminFetch(token, `/authentication/config/${configId}`)).json()) as {
      id: string;
      config: Record<string, string>;
    };
  }

  /**
   * Changes the config of an execution in the `adili otp` flow (by provider id) and returns how
   * to put it back, so a case can shorten a lifetime, cooldown or max age without waiting it out.
   */
  async function changeConfig(
    token: string,
    providerId: string,
    changes: Record<string, string>,
  ): Promise<() => Promise<void>> {
    const original = await readConfig(token, providerId);
    const put = (config: Record<string, string>) =>
      adminFetch(token, `/authentication/config/${original.id}`, {
        method: 'PUT',
        body: JSON.stringify({ ...original, config }),
      });
    await put({ ...original.config, ...changes });
    return async () => {
      await put(original.config);
    };
  }

  return { adminToken, adminFetch, readConfig, changeConfig };
}
