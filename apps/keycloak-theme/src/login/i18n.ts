import { i18nBuilder } from 'keycloakify/login';

import type { ThemeName } from '../kc.gen';

/**
 * Adili copy for the pages this theme renders itself. Keycloak's own messages (errors it
 * formats server-side, field labels) keep their keys. No em dashes in copy.
 * @see https://docs.keycloakify.dev/features/i18n
 */
const en = {
  adiliActivateTitle: 'Activate your account',
  adiliSetupTitle: 'Complete your account setup',
  adiliActivateLead: 'These steps secure your account. They take about five minutes.',
  adiliSetupLead: 'Complete these steps to continue.',
  adiliStepVerifyEmail: 'Confirm your email address',
  adiliStepVerifyEmailDetail: 'Done when you continue from this page.',
  adiliStepTotp: 'Set up an authenticator app',
  adiliStepTotpDetail: 'You scan a QR code with an app on your phone.',
  adiliStepPassword: 'Choose a password',
  adiliStepPasswordDetail: 'You sign in with it and a code from the app.',
  adiliContinue: 'Continue',
  adiliAccountReadyTitle: 'Your account is ready',
  adiliAccountReadyLead:
    'Sign in with your email and new password. You will also enter a code from your authenticator app.',
  adiliSignIn: 'Sign in',
  adiliBackToAdili: 'Back to Adili Online',
  adiliCloseWindow: 'You can close this window.',
  adiliLinkExpiredTitle: 'This link has expired',
  adiliActivationLifespan: 'Activation links work for {0} hours.',
  adiliActivationAskResend: 'Ask EACC to send you a new invitation.',
  adiliLinkExpiredLead:
    'Links from Adili Online emails work for a limited time. Ask for a new one.',
  adiliAlreadyActivated: 'Already activated? Sign in',
  adiliLinkUsedTitle: 'This link has been used',
  adiliLinkUsedLead:
    'Your account is already activated. Sign in with your email, password and a code from your authenticator app.',
  adiliErrorTitle: 'Something went wrong',
  adiliErrorHelp: 'Nothing has changed on your account. If it keeps happening, contact EACC.',
  adiliTotpTitle: 'Set up your authenticator app',
  adiliTotpInstall: 'Install an app on your phone',
  adiliTotpInstallApps: 'For example {0}.',
  adiliTotpScan: 'Scan this QR code with the app',
  adiliTotpCantScan: 'Cannot scan? Enter a key',
  adiliTotpEnterKey: 'Enter this key in the app',
  adiliTotpKeyDetails: 'Time-based, {0} digits, a new code every {1} seconds.',
  adiliTotpScanInstead: 'Scan a QR code instead',
  adiliTotpEnterCode: 'Enter the 6-digit code the app shows',
  adiliTotpDeviceLabel: 'Name this device',
  adiliTotpDeviceHint: 'For example, Work phone. Helps if you add another device later.',
  adiliOptional: 'optional',
  adiliTotpSubmit: 'Verify and continue',
  adiliPasswordTitle: 'Choose a password',
  adiliPasswordLead: 'You will sign in with your email and this password.',
  adiliPasswordNew: 'New password',
  adiliPasswordConfirm: 'Confirm password',
  adiliPasswordSubmit: 'Save password',
  adiliOtpTitle: 'Enter your authenticator code',
  adiliOtpLead: 'The 6-digit code from the app you set up for Adili Online.',
  adiliOtpNewCode: 'A new code appears every 30 seconds.',
  adiliOtpLostPhone: 'Lost your phone? Ask EACC to reset your authenticator.',
  adiliOtpDevice: 'Device',
  adiliSignOutOtherDevices: 'Sign out of other devices',
  // Keycloak's own label, in the sentence case of the rest of the copy.
  doLogIn: 'Sign in',
  restartLoginTooltip: 'Not you?',
};

/** @see https://docs.keycloakify.dev/features/i18n */
// `ofTypeI18n` exists only to derive the I18n type.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { useI18n, ofTypeI18n } = i18nBuilder
  .withThemeName<ThemeName>()
  .withCustomTranslations({ en })
  .build();

type I18n = typeof ofTypeI18n;

export { type I18n, useI18n };
