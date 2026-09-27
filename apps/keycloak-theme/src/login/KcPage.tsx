import DefaultPage from 'keycloakify/login/DefaultPage';
import { lazy, Suspense } from 'react';

import '../styles.css';
import { classes } from './classes';
import { useI18n } from './i18n';
import type { KcContext } from './KcContext';
import Template from './Template';

const Error = lazy(() => import('./pages/Error'));
const Info = lazy(() => import('./pages/Info'));
const Login = lazy(() => import('./pages/Login'));
const LoginConfigTotp = lazy(() => import('./pages/LoginConfigTotp'));
const LoginOtp = lazy(() => import('./pages/LoginOtp'));
const LoginUpdatePassword = lazy(() => import('./pages/LoginUpdatePassword'));
const UserProfileFormFields = lazy(() => import('keycloakify/login/UserProfileFormFields'));

export default function KcPage({ kcContext }: { kcContext: KcContext }) {
  const { i18n } = useI18n({ kcContext });

  const page = { i18n, classes, Template, doUseDefaultCss: false } as const;

  return (
    <Suspense>
      {(() => {
        switch (kcContext.pageId) {
          case 'login.ftl':
            return <Login kcContext={kcContext} {...page} />;
          case 'login-otp.ftl':
            return <LoginOtp kcContext={kcContext} {...page} />;
          case 'login-config-totp.ftl':
            return <LoginConfigTotp kcContext={kcContext} {...page} />;
          case 'login-update-password.ftl':
            return <LoginUpdatePassword kcContext={kcContext} {...page} />;
          case 'info.ftl':
            return <Info kcContext={kcContext} {...page} />;
          case 'error.ftl':
            return <Error kcContext={kcContext} {...page} />;
          default:
            return (
              <DefaultPage
                kcContext={kcContext}
                {...page}
                UserProfileFormFields={UserProfileFormFields}
                doMakeUserConfirmPassword
              />
            );
        }
      })()}
    </Suspense>
  );
}
