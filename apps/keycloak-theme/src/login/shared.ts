import type { MessageKey_defaultSet } from 'keycloakify/login';

import type { en, I18n } from './i18n';
import type { KcContext } from './KcContext';

/** Declarants sign in through the portal client; staff through the console client. */
export type Audience = 'declarant' | 'staff';

export const CONSOLE_CLIENT_ID = 'console';

export function audienceOf(kcContext: Pick<KcContext, 'client'>): Audience {
  return audienceOfClient(kcContext.client.clientId);
}

export function audienceOfClient(clientId: string | undefined): Audience {
  return clientId === CONSOLE_CLIENT_ID ? 'staff' : 'declarant';
}

/**
 * Where each audience signs in, from the theme's environment (vite.config.ts). For pages that
 * Keycloak renders without a client, such as an expired emailed link.
 */
export function signInUrlOf(
  audience: Audience,
  properties: Pick<KcContext['properties'], 'ADILI_CONSOLE_URL' | 'ADILI_PORTAL_URL'>,
): string | undefined {
  const base = audience === 'staff' ? properties.ADILI_CONSOLE_URL : properties.ADILI_PORTAL_URL;
  return clientUrl(base, 'auth/login');
}

/** A key of the theme's own copy (i18n.ts). */
export type MessageKey = keyof typeof en;

/** Copy that differs by audience: the message key each one reads. */
const AUDIENCE_COPY = {
  activateTitle: { declarant: 'adiliActivateTitle', staff: 'adiliStaffActivateTitle' },
  activateText: { declarant: 'adiliActivateText', staff: 'adiliStaffActivateText' },
  activateButton: { declarant: 'adiliActivateButton', staff: 'adiliStaffActivateButton' },
  activeTitle: { declarant: 'adiliPasswordSetTitle', staff: 'adiliStaffActiveTitle' },
  activeText: { declarant: 'adiliPasswordSetText', staff: 'adiliStaffActiveText' },
  goToApp: { declarant: 'adiliSignIn', staff: 'adiliGoToConsole' },
  logoutText: { declarant: 'adiliLogoutText', staff: 'adiliLogoutTextStaff' },
  identifier: { declarant: 'adiliIdentifierDeclarant', staff: 'adiliIdentifierStaff' },
  resetHelp: { declarant: 'adiliResetHelp', staff: 'adiliResetHelpStaff' },
  linkExpiredText: { declarant: 'adiliLinkExpiredText', staff: 'adiliLinkExpiredTextStaff' },
  linkInvalidHelp: { declarant: 'adiliLinkInvalidHelp', staff: 'adiliLinkInvalidHelpStaff' },
  disabledTitle: { declarant: 'adiliDisabledTitle', staff: 'adiliDisabledTitleStaff' },
  disabledText: { declarant: 'adiliDisabledText', staff: 'adiliDisabledTextStaff' },
  disabledHelp: { declarant: 'adiliDisabledHelp', staff: 'adiliDisabledHelpStaff' },
  helpContact: { declarant: 'adiliHelpDeclarant', staff: 'adiliHelpStaff' },
  ruleNotIdentifier: {
    declarant: 'adiliRuleNotIdentifierDeclarant',
    staff: 'adiliRuleNotIdentifierStaff',
  },
} as const satisfies Record<string, Record<Audience, MessageKey>>;

export type AudienceCopyName = keyof typeof AUDIENCE_COPY;

/** Reads audience-specific copy by name, e.g. `copy.msg('logoutText')`. */
export function audienceCopy(audience: Audience, i18n: I18n) {
  return {
    msg: (name: AudienceCopyName) => i18n.msg(AUDIENCE_COPY[name][audience]),
    msgStr: (name: AudienceCopyName) => i18n.msgStr(AUDIENCE_COPY[name][audience]),
  };
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
