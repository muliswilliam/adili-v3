/** What the theme reads from an emailed link's action token (the `key` query parameter). */
export interface ActionToken {
  /** Token type, e.g. `execute-actions` for an activation link. */
  typ: string;
  /** Client the link was made for (`portal` or `console`), if it names one. */
  azp?: string;
  /** Whether the link had expired at `now`; a link that has not was used already. */
  expired: boolean;
}

/**
 * Decodes (without verifying: display only) the action token in `search`, or returns null
 * when there is none. Keycloak shows expired-link errors on the link's own URL. Anyone can craft
 * such a URL, so nothing read here may decide where a link on the page leads.
 */
export function actionTokenOf(search: string, now: number): ActionToken | null {
  const payload = new URLSearchParams(search).get('key')?.split('.')[1];
  if (!payload) return null;
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))) as {
      typ?: unknown;
      azp?: unknown;
      exp?: unknown;
    };
    if (typeof claims.typ !== 'string') return null;
    const exp = typeof claims.exp === 'number' ? claims.exp : 0;
    return {
      typ: claims.typ,
      ...(typeof claims.azp === 'string' ? { azp: claims.azp } : {}),
      expired: exp * 1000 <= now,
    };
  } catch {
    return null;
  }
}
