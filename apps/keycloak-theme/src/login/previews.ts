import type { KcContext } from './KcContext';
import { getKcContextMock } from './mock';

/** A staff activation link's query string (unsigned token; only its claims matter here). */
function activationLinkSearch(issuedAt: number): string {
  const claims = {
    typ: 'execute-actions',
    iat: issuedAt,
    exp: issuedAt + 72 * 3600,
    reduri: 'http://localhost:3020/auth/login',
  };
  const payload = btoa(JSON.stringify(claims)).replace(/=+$/, '');
  return `?key=eyJhbGciOiJub25lIn0.${payload}.sig&client_id=console`;
}

/** An activation link that expired in September 2026. */
export const EXPIRED_ACTIVATION_SEARCH = activationLinkSearch(1_790_000_000);
/** An activation link that expires in 2100: Keycloak refusing it means it was used. */
export const USED_ACTIVATION_SEARCH = activationLinkSearch(4_102_444_800);

/**
 * Keycloak pages as the staff activation flow shows them, for the dev preview
 * (`/?preview=activation-landing`) and tests. Messages are Keycloak's English defaults.
 */
export const previews = {
  'activation-landing': () =>
    getKcContextMock({
      pageId: 'info.ftl',
      overrides: {
        messageHeader: undefined,
        message: { type: 'success', summary: 'Perform the following action(s)' },
        requiredActions: ['VERIFY_EMAIL', 'UPDATE_PASSWORD', 'CONFIGURE_TOTP'],
        actionUri: '#continue',
        client: { clientId: 'console', baseUrl: undefined },
      },
    }),
  'account-ready': () =>
    getKcContextMock({
      pageId: 'info.ftl',
      overrides: {
        messageHeader: undefined,
        message: { type: 'success', summary: 'Your account has been updated.' },
        pageRedirectUri: 'http://localhost:3020/auth/login',
        actionUri: undefined,
        client: { clientId: 'console', baseUrl: undefined },
      },
    }),
  'link-expired': () =>
    getKcContextMock({
      pageId: 'error.ftl',
      overrides: { message: { type: 'error', summary: 'Action expired.' }, client: undefined },
    }),
  error: () =>
    getKcContextMock({
      pageId: 'error.ftl',
      overrides: { message: { type: 'error', summary: 'Invalid parameter: redirect_uri' } },
    }),
  'configure-totp': () =>
    getKcContextMock({
      pageId: 'login-config-totp.ftl',
      overrides: {
        message: {
          type: 'warning',
          summary: 'You need to set up Mobile Authenticator to activate your account.',
        },
      },
    }),
  'configure-totp-manual': () =>
    getKcContextMock({ pageId: 'login-config-totp.ftl', overrides: { mode: 'manual' } }),
  'update-password': () =>
    getKcContextMock({
      pageId: 'login-update-password.ftl',
      overrides: {
        message: {
          type: 'warning',
          summary: 'You need to change your password to activate your account.',
        },
      },
    }),
  'sign-in-code': () => getKcContextMock({ pageId: 'login-otp.ftl', overrides: {} }),
} satisfies Record<string, () => KcContext>;

export type PreviewName = keyof typeof previews;
