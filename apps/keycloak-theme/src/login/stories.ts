import type { DeepPartial } from 'keycloakify/tools/DeepPartial';

import { en } from './i18n';
import type { KcContext } from './KcContext';
import { getKcContextMock } from './mock';

type PageId = KcContext['pageId'];
type PageContext<P extends PageId> = Extract<KcContext, { pageId: P }>;

/**
 * Named states of the theme's pages, one per prototype screen, for the dev preview
 * (`pnpm dev`, then `/?story=otp-wrong`) and the tests. Each builds a fresh context when called,
 * so countdowns start from now.
 */
// `O` is only there so literals in the overrides keep their types (e.g. `channel: 'email'`).
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
function story<P extends PageId, const O extends DeepPartial<PageContext<P>>>(
  pageId: P,
  overrides?: () => O,
): () => PageContext<P> {
  return () => getKcContextMock({ pageId, overrides: overrides?.() });
}

const inSeconds = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();
const staff = { client: { clientId: 'console' } } as const;
const staffWithUrl = {
  client: { clientId: 'console', baseUrl: 'http://localhost:3010/' },
} as const;
const fieldError = (fields: string[], text: string) => ({
  messagesPerField: {
    existsError: (...names: string[]) => names.some((name) => fields.includes(name)),
    get: (name: string) => (fields.includes(name) ? text : ''),
    getFirstError: (...names: string[]) =>
      names.some((name) => fields.includes(name)) ? text : '',
  },
});

export const stories = {
  // Sign in, with the notices other pages send back to it
  login: story('login.ftl'),
  'login-timeout': story('login.ftl', () => ({
    message: { type: 'info', summary: en.expiredCodeMessage },
  })),
  'login-otp-locked': story('login.ftl', () => ({
    message: { type: 'warning', summary: en.adiliOtpTooManyAttempts },
  })),
  'login-otp-resends': story('login.ftl', () => ({
    message: { type: 'warning', summary: en.adiliOtpTooManyResends },
  })),
  'login-disabled': story('login.ftl', () => ({
    message: { type: 'error', summary: en.accountDisabledMessage },
  })),
  'reset-password': story('login-reset-password.ftl'),

  // OTP (login-adili-otp.ftl)
  otp: story('login-adili-otp.ftl', () => ({ resendAvailableAt: inSeconds(60) })),
  'otp-resend-ready': story('login-adili-otp.ftl', () => ({ resendsLeft: 2 })),
  'otp-email': story('login-adili-otp.ftl', () => ({
    channel: 'email',
    maskedDestination: 'j***@gmail.com',
    alternativeDestination: '07** *** 123',
    resendAvailableAt: inSeconds(60),
  })),
  'otp-no-email': story('login-adili-otp.ftl', () => ({
    alternativeDestination: undefined,
    resendAvailableAt: inSeconds(60),
  })),
  'otp-wrong': story('login-adili-otp.ftl', () => ({ otpError: 'invalid', attemptsLeft: 3 })),
  'otp-wrong-last': story('login-adili-otp.ftl', () => ({ otpError: 'invalid', attemptsLeft: 1 })),
  'otp-expired': story('login-adili-otp.ftl', () => ({ otpError: 'expired' })),
  'otp-last-resend': story('login-adili-otp.ftl', () => ({ resendsLeft: 0 })),
  'otp-sms-failed': story('login-adili-otp.ftl', () => ({ sendFailed: 'sms' })),
  'otp-sms-failed-no-email': story('login-adili-otp.ftl', () => ({
    sendFailed: 'sms',
    alternativeDestination: undefined,
  })),
  'otp-send-both-failed': story('login-adili-otp.ftl', () => ({ sendFailed: 'both' })),
  'otp-step-up': story('login-adili-otp.ftl', () => ({
    isStepUp: true,
    auth: { showUsername: false },
    resendAvailableAt: inSeconds(60),
  })),

  // Set your password
  'update-password': story('login-update-password.ftl'),
  'update-password-policy': story('login-update-password.ftl', () => ({
    passwordPolicies: { length: 10, digits: 1, upperCase: 1, notUsername: true },
  })),
  'update-password-rejected': story('login-update-password.ftl', () =>
    fieldError(['password'], 'Invalid password: must not be equal to any of last 3 passwords.'),
  ),
  'update-password-staff': story('login-update-password.ftl', () => ({
    ...staff,
    passwordPolicies: { length: 12, notEmail: true },
  })),

  // Set-password link (execute-actions)
  'actions-landing': story('info.ftl', () => ({
    messageHeader: 'confirmExecutionOfActions',
    requiredActions: ['UPDATE_PASSWORD'] as string[],
    actionUri: '#action',
    message: { type: 'info', summary: 'Perform the following action(s)' },
  })),
  'actions-landing-staff': story('info.ftl', () => ({
    ...staffWithUrl,
    messageHeader: 'confirmExecutionOfActions',
    requiredActions: ['VERIFY_EMAIL', 'UPDATE_PASSWORD', 'CONFIGURE_TOTP'] as string[],
    actionUri: '#action',
    message: { type: 'info', summary: 'Perform the following action(s)' },
  })),
  'actions-done': story('info.ftl', () => ({
    messageHeader: undefined,
    pageRedirectUri: 'http://localhost:3000/',
    message: { type: 'success', summary: en.accountUpdatedMessage },
  })),
  'actions-done-staff': story('info.ftl', () => ({
    ...staffWithUrl,
    messageHeader: undefined,
    message: { type: 'success', summary: en.accountUpdatedMessage },
  })),
  'link-expired': story('error.ftl', () => ({
    message: { type: 'error', summary: 'Action expired. Please start again.' },
  })),
  'link-expired-staff': story('error.ftl', () => ({
    ...staffWithUrl,
    message: { type: 'error', summary: 'Action expired.' },
  })),
  'link-invalid': story('error.ftl', () => ({
    message: {
      type: 'error',
      summary: 'An error occurred, please login again through your application.',
    },
  })),
  'account-disabled': story('error.ftl', () => ({
    message: { type: 'error', summary: en.accountDisabledMessage },
  })),
  'account-disabled-staff': story('error.ftl', () => ({
    ...staffWithUrl,
    message: { type: 'error', summary: en.accountDisabledMessage },
  })),
  error: story('error.ftl', () => ({
    message: {
      type: 'error',
      summary: 'Cookie not found. Please make sure cookies are enabled in your browser.',
    },
  })),

  // Session ends
  'page-expired': story('login-page-expired.ftl'),
  logout: story('logout-confirm.ftl'),
  'logout-staff': story('logout-confirm.ftl', () => staffWithUrl),
} satisfies Record<string, () => KcContext>;

export type StoryName = keyof typeof stories;
