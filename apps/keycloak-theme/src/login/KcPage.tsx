import DefaultPage from 'keycloakify/login/DefaultPage';
import { lazy, Suspense } from 'react';

import '../styles.css';
import { classes } from './classes';
import { useI18n } from './i18n';
import type { KcContext } from './KcContext';
import Template from './Template';

const Login = lazy(() => import('./pages/Login'));
const AdiliOtp = lazy(() => import('./pages/AdiliOtp'));
const UpdatePassword = lazy(() => import('./pages/UpdatePassword'));
const Info = lazy(() => import('./pages/Info'));
const ErrorPage = lazy(() => import('./pages/Error'));
const PageExpired = lazy(() => import('./pages/PageExpired'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const LogoutConfirm = lazy(() => import('./pages/LogoutConfirm'));
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
