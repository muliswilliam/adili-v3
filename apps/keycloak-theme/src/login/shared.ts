import type { MessageKey_defaultSet } from 'keycloakify/login';

import type { I18n } from './i18n';
import type { KcContext } from './KcContext';

/** Declarants sign in through the portal client; staff through the console client. */
export type Audience = 'declarant' | 'staff';

export const CONSOLE_CLIENT_ID = 'console';

export function audienceOf(kcContext: Pick<KcContext, 'client'>): Audience {
  return kcContext.client.clientId === CONSOLE_CLIENT_ID ? 'staff' : 'declarant';
}

/**
 * Whether the page's Keycloak message is one of these keys. Keycloak sends only the resolved
 * text, so it is matched against the same keys resolved by the theme's bundle.
 */
export function messageIsOneOf(
  kcContext: Pick<KcContext, 'message'>,
  i18n: I18n,
  keys: readonly MessageKey_defaultSet[],
): boolean {
  const summary = kcContext.message?.summary.trim();
  if (!summary) return false;
  return keys.some((key) => i18n.msgStr(key).trim() === summary);
}

/**
 * A link into the client application (the portal or console), from the client's base URL.
 * Undefined when Keycloak did not give one.
 */
export function clientUrl(baseUrl: string | undefined, path = ''): string | undefined {
  if (!baseUrl || baseUrl === '#') return baseUrl;
  try {
    return new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
  } catch {
    return undefined;
  }
}
