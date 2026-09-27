import { Button, Input, Label } from '@adili/ui';
import type { PageProps } from 'keycloakify/login/pages/PageProps';
import { Clock } from 'lucide-react';
import { useState } from 'react';

import { FieldError, Lead } from '../components';
import type { I18n } from '../i18n';
import type { KcContext } from '../KcContext';

type LoginOtpProps = PageProps<Extract<KcContext, { pageId: 'login-otp.ftl' }>, I18n>;

/** The authenticator code step of staff sign-in (login-otp.ftl). */
export default function LoginOtp({
  kcContext,
  i18n,
  doUseDefaultCss,
  Template,
  classes,
}: LoginOtpProps) {
  const { otpLogin, url, messagesPerField } = kcContext;
  const { msg, msgStr } = i18n;
  const [submitting, setSubmitting] = useState(false);
  const hasError = messagesPerField.existsError('totp');
  const devices = otpLogin.userOtpCredentials;

  return (
    <Template
      kcContext={kcContext}
      i18n={i18n}
      doUseDefaultCss={doUseDefaultCss}
      classes={classes}
      displayMessage={!hasError}
      headerNode={msg('adiliOtpTitle')}
      displayInfo
      infoNode={msg('adiliOtpLostPhone')}
    >
      <Lead>{msg('adiliOtpLead')}</Lead>
      <form
        id="kc-otp-login-form"
        action={url.loginAction}
        method="post"
        className="grid gap-5"
        onSubmit={() => {
          setSubmitting(true);
        }}
      >
        {devices.length > 1 ? (
          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium">{msg('adiliOtpDevice')}</legend>
            {devices.map((device) => (
              <label
                key={device.id}
                className="flex items-center gap-3 rounded-md border px-3 py-2.5 text-sm has-checked:border-primary has-checked:bg-primary-subtle"
              >
                <input
                  type="radio"
                  name="selectedCredentialId"
                  value={device.id}
                  defaultChecked={device.id === otpLogin.selectedCredentialId}
                  className="size-4 accent-primary"
                />
                {device.userLabel}
              </label>
            ))}
          </fieldset>
        ) : null}
        <div className="grid gap-2">
          <Label htmlFor="otp">{msg('loginOtpOneTime')}</Label>
          <Input
            id="otp"
            name="otp"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            autoFocus
            className="font-mono tracking-[0.3em]"
            aria-invalid={hasError || undefined}
            aria-describedby={hasError ? 'input-error-otp-code' : 'otp-hint'}
          />
          {hasError ? (
            <FieldError id="input-error-otp-code" html={messagesPerField.get('totp')} />
          ) : (
            <p id="otp-hint" className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Clock className="size-3.5" aria-hidden="true" />
              {msg('adiliOtpNewCode')}
            </p>
          )}
        </div>
        <Button
          type="submit"
          name="login"
          id="kc-login"
          size="lg"
          className="w-full"
          disabled={submitting}
        >
          {msgStr('doLogIn')}
        </Button>
      </form>
    </Template>
  );
}
