import type { ExtendKcContext } from 'keycloakify/login';

import type { KcEnvName, ThemeName } from '../kc.gen';

export interface KcContextExtension {
  themeName: ThemeName;
  /** The environment variables declared in vite.config.ts, as Keycloak's environment sets them. */
  properties: Record<KcEnvName, string>;
}

/** Extra data per Keycloak page; none yet. Keycloakify requires an object type here. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/consistent-type-definitions
export type KcContextExtensionPerPage = {};

export type KcContext = ExtendKcContext<KcContextExtension, KcContextExtensionPerPage>;
