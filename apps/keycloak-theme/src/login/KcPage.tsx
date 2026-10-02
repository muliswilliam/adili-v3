import DefaultPage from 'keycloakify/login/DefaultPage';
import { lazy, Suspense } from 'react';

import '../styles.css';
import { classes } from './classes';
import { useI18n } from './i18n';
import type { KcContext } from './KcContext';
import AdiliOtp from './pages/AdiliOtp';
import ErrorPage from './pages/Error';
import Info from './pages/Info';
import Login from './pages/Login';
import LoginConfigTotp from './pages/LoginConfigTotp';
import LoginOtp from './pages/LoginOtp';
import LogoutConfirm from './pages/LogoutConfirm';
import PageExpired from './pages/PageExpired';
import ResetPassword from './pages/ResetPassword';
import UpdatePassword from './pages/UpdatePassword';
import Template from './Template';

// The Adili pages ship in the entry bundle. Loaded on demand, each was one more request a sign-in
// needed after the page itself, and a request that failed or hung left the page blank. Only
// Keycloakify's unstyled fallback pages still load on demand.
const UserProfileFormFields = lazy(() => import('keycloakify/login/UserProfileFormFields'));

export default function KcPage({ kcContext }: { kcContext: KcContext }) {
  const { i18n } = useI18n({ kcContext });
  const common = { i18n, classes, Template, doUseDefaultCss: false } as const;

  return (
    <Suspense>
      {(() => {
        switch (kcContext.pageId) {
          case 'login.ftl':
            return <Login kcContext={kcContext} {...common} />;
          case 'login-adili-otp.ftl':
            return <AdiliOtp kcContext={kcContext} {...common} />;
          case 'login-otp.ftl':
            return <LoginOtp kcContext={kcContext} {...common} />;
          case 'login-config-totp.ftl':
            return <LoginConfigTotp kcContext={kcContext} {...common} />;
          case 'login-update-password.ftl':
            return <UpdatePassword kcContext={kcContext} {...common} />;
          case 'info.ftl':
            return <Info kcContext={kcContext} {...common} />;
          case 'error.ftl':
            return <ErrorPage kcContext={kcContext} {...common} />;
          case 'login-page-expired.ftl':
            return <PageExpired kcContext={kcContext} {...common} />;
          case 'login-reset-password.ftl':
            return <ResetPassword kcContext={kcContext} {...common} />;
          case 'logout-confirm.ftl':
            return <LogoutConfirm kcContext={kcContext} {...common} />;
          default:
            return (
              <DefaultPage
                kcContext={kcContext}
                {...common}
                UserProfileFormFields={UserProfileFormFields}
                doMakeUserConfirmPassword
              />
            );
        }
      })()}
    </Suspense>
  );
}
