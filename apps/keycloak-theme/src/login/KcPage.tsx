import DefaultPage from 'keycloakify/login/DefaultPage';
import { lazy, Suspense } from 'react';

import '../styles.css';
import { classes } from './classes';
import { useI18n } from './i18n';
import type { KcContext } from './KcContext';
import Template from './Template';

const Login = lazy(() => import('./pages/Login'));
const UserProfileFormFields = lazy(() => import('keycloakify/login/UserProfileFormFields'));

export default function KcPage({ kcContext }: { kcContext: KcContext }) {
  const { i18n } = useI18n({ kcContext });

  return (
    <Suspense>
      {kcContext.pageId === 'login.ftl' ? (
        <Login
          kcContext={kcContext}
          i18n={i18n}
          classes={classes}
          Template={Template}
          doUseDefaultCss={false}
        />
      ) : (
        <DefaultPage
          kcContext={kcContext}
          i18n={i18n}
          classes={classes}
          Template={Template}
          doUseDefaultCss={false}
          UserProfileFormFields={UserProfileFormFields}
          doMakeUserConfirmPassword
        />
      )}
    </Suspense>
  );
}
