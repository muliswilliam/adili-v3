import type { ExtendKcContext } from 'keycloakify/login';
import type { PasswordPolicies } from 'keycloakify/login/KcContext';

import type { KcEnvName, ThemeName } from '../kc.gen';
import type { AdiliOtpAttributes } from './adili-otp';

export interface KcContextExtension {
  themeName: ThemeName;
  /** The environment variables declared in vite.config.ts, as Keycloak's environment sets them. */
  properties: Record<KcEnvName, string>;
}

/**
 * Extra data per Keycloak page. Keycloakify generates an .ftl for every page key here that is not
 * a built-in page, so `login-adili-otp.ftl` must stay a literal key in this file.
 */
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type KcContextExtensionPerPage = {
  'login-adili-otp.ftl': AdiliOtpAttributes;
  /** Keycloak does not always expose the realm policy here; the page falls back to its defaults. */
  'login-update-password.ftl': { passwordPolicies?: PasswordPolicies };
};

export type KcContext = ExtendKcContext<KcContextExtension, KcContextExtensionPerPage>;
