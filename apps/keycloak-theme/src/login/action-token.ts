/** What the theme reads from an emailed link's action token (the `key` query parameter). */
export interface ActionToken {
  /** Token type, e.g. `execute-actions` for an activation link. */
  typ: string;
  /** Where the user goes once the actions are done, if the link set it. */
  reduri?: string;
  /** How long the link was valid for, in whole hours. */
  lifespanHours: number;
  /** Whether the link had expired at `now`; a link that has not was used already. */
  expired: boolean;
}

/**
 * Decodes (without verifying: display only) the action token in `search`, or returns null
 * when there is none. Keycloak shows expired-link errors on the link's own URL.
 */
export function actionTokenOf(search: string, now: number): ActionToken | null {
  const payload = new URLSearchParams(search).get('key')?.split('.')[1];
  if (!payload) return null;
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))) as {
      typ?: unknown;
      reduri?: unknown;
      iat?: unknown;
      exp?: unknown;
    };
    if (typeof claims.typ !== 'string') return null;
    const exp = typeof claims.exp === 'number' ? claims.exp : 0;
    const lifespan = exp && typeof claims.iat === 'number' ? exp - claims.iat : 0;
    return {
      typ: claims.typ,
      reduri: typeof claims.reduri === 'string' ? claims.reduri : undefined,
      lifespanHours: Math.round(lifespan / 3600),
      expired: exp * 1000 <= now,
    };
  } catch {
    return null;
  }
}
