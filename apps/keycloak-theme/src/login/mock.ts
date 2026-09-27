import { createGetKcContextMock } from 'keycloakify/login/KcContext';

import { kcEnvDefaults, themeNames } from '../kc.gen';
import type { KcContextExtension, KcContextExtensionPerPage } from './KcContext';

const kcContextExtension: KcContextExtension = {
  themeName: themeNames[0] ?? 'adili',
  properties: { ...kcEnvDefaults },
};

export const PORTAL_URL = 'http://localhost:3000/';

/** What the `adili-otp` authenticator sends on its first render: an SMS just went out. */
const kcContextExtensionPerPage: KcContextExtensionPerPage = {
  'login-adili-otp.ftl': {
    channel: 'sms',
    maskedDestination: '07** *** 123',
    alternativeDestination: 'j***@gmail.com',
    attemptsLeft: 5,
    resendsLeft: 3,
  },
  'login-update-password.ftl': {},
};

/** Mock Keycloak contexts for the dev preview and tests. */
export const { getKcContextMock } = createGetKcContextMock({
  kcContextExtension,
  kcContextExtensionPerPage,
  overrides: {
    realm: { displayName: 'Adili Online', displayNameHtml: 'Adili Online' },
    // The declarant's client; stories switch to `console` for staff.
    client: { clientId: 'portal' },
    // Mirrors the realm's supported locales (infra/compose/keycloak/adili-realm.json).
    locale: {
      currentLanguageTag: 'en',
      supported: [
        { languageTag: 'en', label: 'English', url: '?kc_locale=en' },
        { languageTag: 'sw', label: 'Kiswahili', url: '?kc_locale=sw' },
      ],
    },
  },
  overridesPerPage: {
    'info.ftl': { client: { baseUrl: PORTAL_URL } },
    'error.ftl': { client: { baseUrl: PORTAL_URL } },
    'logout-confirm.ftl': { client: { baseUrl: PORTAL_URL } },
    'login-adili-otp.ftl': {
      auth: { showUsername: true, attemptedUsername: 'OFR-0012345-B' },
    },
  },
});
