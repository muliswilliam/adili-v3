import { i18nBuilder } from 'keycloakify/login';

import type { ThemeName } from '../kc.gen';

/**
 * The theme's copy, in one table. Keycloakify writes these into the theme's messages bundle, so
 * Keycloak itself resolves them too: the `adili-otp` authenticator sets the `adiliOtpTooMany*`
 * keys, and the reworded Keycloak keys at the end change the text Keycloak puts in
 * `message.summary`. `{0}` is the first parameter.
 *
 * Kiswahili: slot pending. The realm has internationalization off; when it is turned on, add an
 * `sw` table with the same keys (through `withExtraLanguages`, as Keycloakify ships no `sw`).
 */
export const en = {
  // Shared
  adiliPartiallyHidden: '(partially hidden for privacy)',
  adiliBackToSignIn: 'Back to sign in',
  adiliGoToSignIn: 'Go to sign in',
  adiliSignIn: 'Sign in',
  adiliTryAgain: 'Try again',
  adiliStartAgain: 'Start again',
  adiliContinue: 'Continue',
  adiliHelpDeclarant: "your Commission's reporting officer",
  adiliHelpStaff: 'the EACC platform team',

  // OTP page (login-adili-otp.ftl)
  adiliOtpTitle: 'Enter the code we sent',
  adiliOtpStepUpTitle: "Confirm it's you",
  adiliOtpSentBySms: 'We sent a 6-digit code by SMS to',
  adiliOtpSentByEmail: 'We sent a 6-digit code to',
  adiliOtpCodeLabel: 'Enter the 6-digit code',
  adiliOtpValidFor: 'The code works for 10 minutes.',
  adiliOtpChecking: 'Checking the code',
  adiliOtpDidNotGetIt: "Didn't get it?",
  adiliOtpResend: 'Resend code',
  adiliOtpResendIn: 'Resend in {0}',
  adiliOtpResendWait: 'You can ask for a new code in {0} seconds.',
  adiliOtpResendReady: 'You can ask for a new code now.',
  adiliOtpResendsLeft: 'You can ask for {0} more codes.',
  adiliOtpResendsLeftOne: 'You can ask for 1 more code.',
  adiliOtpResendsNone: 'Asking for another code starts sign-in again.',
  adiliOtpSwitchToEmail: 'Send it by email instead',
  adiliOtpSwitchToSms: 'Send it by SMS instead',
  adiliOtpInvalid: 'That code is not right. {0} attempts left.',
  adiliOtpInvalidOne: 'That code is not right. 1 attempt left.',
  adiliOtpExpired: 'That code has expired. Resend to get a new one.',
  adiliOtpTooManyAttempts:
    'Too many wrong codes. For your security we stopped this sign-in. Sign in again to get a new code.',
  adiliOtpTooManyResends:
    'Too many codes requested. You asked for a new code too many times. Sign in again to start over.',
  adiliOtpSmsFailedTitle: 'We could not send the SMS',
  adiliOtpEmailFailedTitle: 'We could not send the email',
  adiliOtpSendFailedText: 'Choose another way to get your code.',
  adiliOtpSendFailedNoAlternative: 'Try again in a few minutes.',
  adiliOtpEmailInstead: 'We can email the code to',
  adiliOtpSmsInstead: 'We can text the code to',
  adiliOtpSendByEmail: 'Send by email',
  adiliOtpSendBySms: 'Send by SMS',
  adiliOtpRetrySms: 'Try SMS again',
  adiliOtpRetryEmail: 'Try email again',
  adiliOtpBothFailedTitle: 'We could not send your code',
  adiliOtpBothFailedText:
    'SMS and email are not responding. Your account is fine. Try again in a few minutes.',

  // Update password (login-update-password.ftl)
  adiliSetPasswordTitle: 'Set your password',
  adiliNewPassword: 'New password',
  adiliConfirmPassword: 'Confirm new password',
  adiliPasswordRules: 'Password rules',
  adiliRuleLength: 'At least {0} characters',
  adiliRuleDigits: 'At least {0} number(s)',
  adiliRuleUpperCase: 'At least {0} capital letter(s)',
  adiliRuleLowerCase: 'At least {0} small letter(s)',
  adiliRuleSpecialChars: 'At least {0} symbol(s), such as ! or #',
  adiliRuleNotIdentifierDeclarant: 'Not your email or officer reference',
  adiliRuleNotIdentifierStaff: 'Not your email address',
  adiliRuleMet: '(met)',
  adiliRuleNotMet: '(not met yet)',
  adiliPasswordsDoNotMatch: 'The passwords do not match.',
  adiliSignOutOtherDevices: 'Sign out of other devices',
  adiliSignOutOtherDevicesHint: 'Recommended if someone may know your old password.',
  adiliSaveAndContinue: 'Save and continue',
  adiliSaving: 'Saving',

  // Execute-actions landing and done (info.ftl)
  adiliActivateTitle: 'Set your password',
  adiliActivateText: 'Your Adili Online account is ready. Set a password to finish.',
  adiliActivateButton: 'Set password',
  adiliStaffActivateTitle: 'Activate your console account',
  adiliStaffActivateText: 'Finish these steps to start using the console.',
  adiliStaffActivateButton: 'Start',
  adiliLinkWorksOnce: 'This link works once.',
  adiliPasswordSetTitle: 'Your password is set',
  adiliPasswordSetText: 'Next time, sign in with your password and a code sent to your phone.',
  adiliStaffActiveTitle: 'Your console account is active',
  adiliStaffActiveText: 'Sign in with your email, password and authenticator code.',
  adiliGoToConsole: 'Go to console',

  // Errors (error.ftl)
  adiliLinkExpiredTitle: 'This link has expired',
  adiliLinkExpiredText: 'Ask for a new one from the Adili portal.',
  adiliLinkExpiredTextStaff:
    'Activation links work for 72 hours. Ask EACC to resend your invitation.',
  adiliGetNewLink: 'Get a new link',
  adiliLinkExpiredOtherDevice:
    'On another device? Use "Forgot password" on the sign-in page instead. It sets your password too.',
  adiliLinkInvalidTitle: 'This link does not work',
  adiliLinkInvalidText: 'It may be used already, or copied only in part.',
  adiliLinkInvalidHelp:
    'Already set your password? Sign in. If not, get a new link from the portal.',
  adiliLinkInvalidHelpStaff:
    'Already activated? Sign in. If not, ask EACC to resend your invitation.',
  adiliDisabledTitle: 'Your account is disabled',
  adiliDisabledTitleStaff: 'Your console access has ended',
  adiliDisabledText: 'You cannot sign in with this account.',
  adiliDisabledTextStaff: 'EACC has usually assigned another reporting officer to your Commission.',
  adiliDisabledHelp:
    "Contact your Commission's reporting officer. Quote your officer reference, never your ID number or password.",
  adiliDisabledHelpStaff: 'Contact the EACC platform team if you think this is a mistake.',
  adiliErrorTitle: 'Something went wrong',
  adiliErrorText: 'Nothing has changed on your account. Try signing in again.',
  adiliErrorHelp: 'If it keeps happening, contact {0}.',

  // Staff activation steps, listed on the execute-actions landing page (info.ftl)
  adiliStepVerifyEmail: 'Confirm your email address',
  adiliStepVerifyEmailDetail: 'Done when you continue from this page.',
  adiliStepTotp: 'Set up an authenticator app',
  adiliStepTotpDetail: 'You scan a QR code with an app on your phone.',
  adiliStepPassword: 'Choose a password',
  adiliStepPasswordDetail: 'You sign in with it and a code from the app.',

  // Authenticator enrolment (login-config-totp.ftl)
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

  // Authenticator code at staff sign-in (login-otp.ftl)
  adiliTotpCodeTitle: 'Enter your authenticator code',
  adiliTotpCodeLead: 'The 6-digit code from the app you set up for Adili Online.',
  adiliTotpNewCode: 'A new code appears every 30 seconds.',
  adiliTotpLostPhone: 'Lost your phone? Ask EACC to reset your authenticator.',
  adiliTotpDevice: 'Device',

  // Page expired (login-page-expired.ftl)
  adiliPageExpiredTitle: 'This page has expired',
  adiliPageExpiredText: 'You may have waited too long, or opened sign-in in another tab.',

  // Forgot password (login-reset-password.ftl)
  adiliResetTitle: 'Reset your password',
  adiliResetText: 'We will email you a reset link.',
  adiliResetButton: 'Send reset link',
  adiliResetHelp: 'Email changed? Ask your reporting officer.',
  adiliResetHelpStaff: 'Lost access to this email? Ask EACC.',
  adiliIdentifierDeclarant: 'Email or officer reference',
  adiliIdentifierStaff: 'Official email',

  // Sign out (logout-confirm.ftl)
  adiliLogoutTitle: 'Sign out of Adili Online?',
  adiliLogoutText: 'Your saved declaration stays safe.',
  adiliLogoutTextStaff: 'You will need your password and authenticator code to sign in again.',
  adiliSignOut: 'Sign out',
  adiliCancel: 'Cancel',

  // Keycloak's own keys, reworded. They reach login.ftl and info.ftl as `message.summary`.
  expiredCodeMessage:
    'Your sign-in took too long. For your security we started again. Enter your details once more.',
  emailSentMessage: 'Check your email. If an account exists, we sent a reset link.',
  accountDisabledMessage:
    "Your account is disabled. Contact your Commission's reporting officer and quote your officer reference.",
  accountUpdatedMessage: 'Your password is set.',
  // In the sentence case of the rest of the copy.
  doLogIn: 'Sign in',
  restartLoginTooltip: 'Not you?',
} as const;

/** @see https://docs.keycloakify.dev/features/i18n */
// `ofTypeI18n` exists only to derive the I18n type.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { useI18n, ofTypeI18n } = i18nBuilder
  .withThemeName<ThemeName>()
  .withCustomTranslations({ en })
  .build();

type I18n = typeof ofTypeI18n;

export { type I18n, useI18n };
