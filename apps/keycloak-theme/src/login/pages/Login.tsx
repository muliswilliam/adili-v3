import { Button, cn, focusRing, focusRingInset, Icon, Input, Label } from '@adili/ui';
import { kcSanitize } from 'keycloakify/lib/kcSanitize';
import { useScript } from 'keycloakify/login/pages/Login.useScript';
import type { PageProps } from 'keycloakify/login/pages/PageProps';
import { useIsPasswordRevealed } from 'keycloakify/tools/useIsPasswordRevealed';
import { Key01Icon, ViewIcon, ViewOffSlashIcon } from '@hugeicons/core-free-icons';
import { useState } from 'react';

import type { I18n } from '../i18n';
import type { KcContext } from '../KcContext';

type LoginProps = PageProps<Extract<KcContext, { pageId: 'login.ftl' }>, I18n>;

const WEBAUTHN_BUTTON_ID = 'authenticateWebAuthnButton';

/** Username and password sign-in (login.ftl), with passkeys when the realm enables them. */
export default function Login({ kcContext, i18n, doUseDefaultCss, Template, classes }: LoginProps) {
  const {
    social,
    realm,
    url,
    usernameHidden,
    login,
    auth,
    registrationDisabled,
    messagesPerField,
    enableWebAuthnConditionalUI,
    authenticators,
  } = kcContext;
  const { msg, msgStr } = i18n;
  const [submitting, setSubmitting] = useState(false);
  useScript({ webAuthnButtonId: WEBAUTHN_BUTTON_ID, kcContext, i18n });

  const hasError = messagesPerField.existsError('username', 'password');
  const error = hasError ? messagesPerField.getFirstError('username', 'password') : undefined;
  const usernameLabel = !realm.loginWithEmailAllowed
    ? msg('username')
    : !realm.registrationEmailAsUsername
      ? msg('usernameOrEmail')
      : msg('email');

  return (
    <Template
      kcContext={kcContext}
      i18n={i18n}
      doUseDefaultCss={doUseDefaultCss}
      classes={classes}
      displayMessage={!hasError}
      headerNode={msg('loginAccountTitle')}
      displayInfo={realm.password && realm.registrationAllowed && !registrationDisabled}
      infoNode={
        <span>
          {msg('noAccount')}{' '}
          <a href={url.registrationUrl} className="font-medium text-primary hover:underline">
            {msg('doRegister')}
          </a>
        </span>
      }
      socialProvidersNode={
        realm.password && social?.providers?.length ? (
          <div className="grid gap-3">
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              {msg('identity-provider-login-label')}
              <span className="h-px flex-1 bg-border" />
            </div>
            {social.providers.map((provider) => (
              <Button key={provider.alias} asChild variant="secondary">
                <a
                  id={`social-${provider.alias}`}
                  href={provider.loginUrl}
                  dangerouslySetInnerHTML={{ __html: kcSanitize(provider.displayName) }}
                />
              </Button>
            ))}
          </div>
        ) : null
      }
    >
      {realm.password ? (
        <form
          id="kc-form-login"
          className="grid gap-5"
          action={url.loginAction}
          method="post"
          onSubmit={() => {
            setSubmitting(true);
          }}
        >
          {!usernameHidden ? (
            <div className="grid gap-2">
              <Label htmlFor="username">{usernameLabel}</Label>
              <Input
                id="username"
                name="username"
                defaultValue={login.username ?? ''}
                autoFocus
                autoComplete={enableWebAuthnConditionalUI ? 'username webauthn' : 'username'}
                aria-invalid={hasError || undefined}
                aria-describedby={hasError ? 'input-error' : undefined}
              />
            </div>
          ) : null}

          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">{msg('password')}</Label>
              {realm.resetPasswordAllowed ? (
                <a
                  href={url.loginResetCredentialsUrl}
                  className={cn(
                    focusRing,
                    'rounded-sm text-sm font-medium text-primary hover:underline',
                  )}
                >
                  {msg('doForgotPassword')}
                </a>
              ) : null}
            </div>
            <PasswordInput i18n={i18n} hasError={hasError} />
            {error ? (
              <p
                id="input-error"
                className="text-sm text-destructive-subtle-foreground"
                aria-live="polite"
                dangerouslySetInnerHTML={{ __html: kcSanitize(error) }}
              />
            ) : null}
          </div>

          {realm.rememberMe && !usernameHidden ? (
            <label className="flex items-center gap-2 text-sm">
              <input
                id="rememberMe"
                name="rememberMe"
                type="checkbox"
                defaultChecked={login.rememberMe === 'on'}
                className="size-4 accent-primary"
              />
              {msg('rememberMe')}
            </label>
          ) : null}

          <input
            type="hidden"
            id="id-hidden-input"
            name="credentialId"
            value={auth.selectedCredential}
          />
          <Button type="submit" name="login" id="kc-login" className="w-full" disabled={submitting}>
            {msgStr('doLogIn')}
          </Button>
        </form>
      ) : null}

      {enableWebAuthnConditionalUI ? (
        <>
          <form id="webauth" action={url.loginAction} method="post" hidden>
            <input type="hidden" id="clientDataJSON" name="clientDataJSON" />
            <input type="hidden" id="authenticatorData" name="authenticatorData" />
            <input type="hidden" id="signature" name="signature" />
            <input type="hidden" id="credentialId" name="credentialId" />
            <input type="hidden" id="userHandle" name="userHandle" />
            <input type="hidden" id="error" name="error" />
          </form>
          {authenticators?.authenticators.length ? (
            <form id="authn_select" hidden>
              {authenticators.authenticators.map((authenticator) => (
                <input
                  key={authenticator.credentialId}
                  type="hidden"
                  name="authn_use_chk"
                  readOnly
                  value={authenticator.credentialId}
                />
              ))}
            </form>
          ) : null}
          <Button id={WEBAUTHN_BUTTON_ID} type="button" variant="secondary" className="w-full">
            <Icon icon={Key01Icon} />
            {msgStr('passkey-doAuthenticate')}
          </Button>
        </>
      ) : null}
    </Template>
  );
}

/** Rendered inside Template, so the input exists when the reveal hook looks it up. */
function PasswordInput({ i18n, hasError }: { i18n: I18n; hasError: boolean }) {
  const { msgStr } = i18n;
  const { isPasswordRevealed, toggleIsPasswordRevealed } = useIsPasswordRevealed({
    passwordInputId: 'password',
  });

  return (
    <div className="relative">
      <Input
        id="password"
        name="password"
        type="password"
        autoComplete="current-password"
        className="pr-10"
        aria-invalid={hasError || undefined}
        aria-describedby={hasError ? 'input-error' : undefined}
      />
      <button
        type="button"
        className={cn(
          focusRingInset,
          'absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground',
        )}
        aria-label={msgStr(isPasswordRevealed ? 'hidePassword' : 'showPassword')}
        aria-controls="password"
        onClick={toggleIsPasswordRevealed}
      >
        {isPasswordRevealed ? (
          <Icon icon={ViewOffSlashIcon} className="size-4" />
        ) : (
          <Icon icon={ViewIcon} className="size-4" />
        )}
      </button>
    </div>
  );
}
