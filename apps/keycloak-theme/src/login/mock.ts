import { createGetKcContextMock } from 'keycloakify/login/KcContext';

import { kcEnvDefaults, themeNames } from '../kc.gen';
import type { KcContextExtension, KcContextExtensionPerPage } from './KcContext';

const kcContextExtension: KcContextExtension = {
  themeName: themeNames[0] ?? 'adili',
  properties: { ...kcEnvDefaults },
};
const kcContextExtensionPerPage: KcContextExtensionPerPage = {};

/** Mock Keycloak contexts for the dev preview and tests. */
export const { getKcContextMock } = createGetKcContextMock({
  kcContextExtension,
  kcContextExtensionPerPage,
  overrides: {
    realm: { displayName: 'Adili Online', displayNameHtml: 'Adili Online' },
    // Mirrors the realm's supported locales (infra/compose/keycloak/adili-realm.json).
    locale: {
      currentLanguageTag: 'en',
      supported: [
        { languageTag: 'en', label: 'English', url: '?kc_locale=en' },
        { languageTag: 'sw', label: 'Kiswahili', url: '?kc_locale=sw' },
      ],
    },
  },
  overridesPerPage: {},
});
