import { Button, Input, Label } from '@adili/ui';
import type { PageProps } from 'keycloakify/login/pages/PageProps';
import { useIsPasswordRevealed } from 'keycloakify/tools/useIsPasswordRevealed';
import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';

import { CheckboxRow, FieldError, Lead } from '../components';
import type { I18n } from '../i18n';
import type { KcContext } from '../KcContext';

type LoginUpdatePasswordProps = PageProps<
  Extract<KcContext, { pageId: 'login-update-password.ftl' }>,
  I18n
>;

/** Set or change the password (login-update-password.ftl), on activation and when required. */
export default function LoginUpdatePassword({
  kcContext,
  i18n,
  doUseDefaultCss,
  Template,
  classes,
}: LoginUpdatePasswordProps) {
  const { url, messagesPerField, isAppInitiatedAction } = kcContext;
  const { msg, msgStr } = i18n;
  const [submitting, setSubmitting] = useState(false);
  const newError = messagesPerField.existsError('password');
  const confirmError = messagesPerField.existsError('password-confirm');

  return (
    <Template
      kcContext={kcContext}
      i18n={i18n}
      doUseDefaultCss={doUseDefaultCss}
      classes={classes}
      // Keycloak's "You need to change your password" warning repeats the title.
      displayMessage={kcContext.message?.type === 'error' && !newError && !confirmError}
      headerNode={msg('adiliPasswordTitle')}
    >
      <Lead>{msg('adiliPasswordLead')}</Lead>
      <form
        id="kc-passwd-update-form"
        action={url.loginAction}
        method="post"
        className="grid gap-5"
        onSubmit={() => {
          setSubmitting(true);
        }}
      >
        <div className="grid gap-2">
          <Label htmlFor="password-new">{msg('adiliPasswordNew')}</Label>
          <PasswordInput
            id="password-new"
            i18n={i18n}
            invalid={newError || confirmError}
            describedBy={newError ? 'input-error-password' : undefined}
            autoFocus
          />
          {newError ? (
            <FieldError id="input-error-password" html={messagesPerField.get('password')} />
          ) : null}
        </div>
        <div className="grid gap-2">
          <Label htmlFor="password-confirm">{msg('adiliPasswordConfirm')}</Label>
          <PasswordInput
            id="password-confirm"
            i18n={i18n}
            invalid={confirmError}
            describedBy={confirmError ? 'input-error-password-confirm' : undefined}
          />
          {confirmError ? (
            <FieldError
              id="input-error-password-confirm"
              html={messagesPerField.get('password-confirm')}
            />
          ) : null}
        </div>
        {isAppInitiatedAction ? (
          <CheckboxRow
            id="logout-sessions"
            name="logout-sessions"
            label={msg('adiliSignOutOtherDevices')}
          />
        ) : null}
        <div className="grid gap-3">
          <Button type="submit" size="lg" className="w-full" disabled={submitting}>
            {msgStr('adiliPasswordSubmit')}
          </Button>
          {isAppInitiatedAction ? (
            <Button
              type="submit"
              name="cancel-aia"
              value="true"
              variant="outline"
              size="lg"
              className="w-full"
            >
              {msg('doCancel')}
            </Button>
          ) : null}
        </div>
      </form>
    </Template>
  );
}

/** Rendered inside Template, so the input exists when the reveal hook looks it up. */
function PasswordInput({
  id,
  i18n,
  invalid,
  describedBy,
  autoFocus = false,
}: {
  id: string;
  i18n: I18n;
  invalid: boolean;
  describedBy?: string;
  autoFocus?: boolean;
}) {
  const { msgStr } = i18n;
  const { isPasswordRevealed, toggleIsPasswordRevealed } = useIsPasswordRevealed({
    passwordInputId: id,
  });

  return (
    <div className="relative">
      <Input
        id={id}
        name={id}
        type="password"
        autoComplete="new-password"
        autoFocus={autoFocus}
        className="pr-10"
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
      />
      <button
        type="button"
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={msgStr(isPasswordRevealed ? 'hidePassword' : 'showPassword')}
        aria-controls={id}
        onClick={toggleIsPasswordRevealed}
      >
        {isPasswordRevealed ? (
          <EyeOff className="size-4" aria-hidden="true" />
        ) : (
          <Eye className="size-4" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
