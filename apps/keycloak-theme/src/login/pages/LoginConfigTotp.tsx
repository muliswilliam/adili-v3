import { Button, Input, Label } from '@adili/ui';
import type { PageProps } from 'keycloakify/login/pages/PageProps';
import { useState } from 'react';

import { CheckboxRow, FieldError, Steps } from '../components';
import type { I18n } from '../i18n';
import type { KcContext } from '../KcContext';

type LoginConfigTotpProps = PageProps<
  Extract<KcContext, { pageId: 'login-config-totp.ftl' }>,
  I18n
>;

/** OTP enrolment (login-config-totp.ftl): install, scan (or type the key), enter a code. */
export default function LoginConfigTotp({
  kcContext,
  i18n,
  doUseDefaultCss,
  Template,
  classes,
}: LoginConfigTotpProps) {
  const { url, isAppInitiatedAction, totp, mode, messagesPerField } = kcContext;
  const { msg, msgStr, advancedMsgStr } = i18n;
  const [submitting, setSubmitting] = useState(false);
  const codeError = messagesPerField.existsError('totp');
  const labelError = messagesPerField.existsError('userLabel');
  const labelRequired = totp.otpCredentials.length >= 1;
  const apps = totp.supportedApplications.map((app) => advancedMsgStr(app));
  const appList = new Intl.ListFormat(i18n.currentLanguage.languageTag, {
    type: 'disjunction',
  }).format(apps);

  return (
    <Template
      kcContext={kcContext}
      i18n={i18n}
      doUseDefaultCss={doUseDefaultCss}
      classes={classes}
      // Keycloak's "You need to set up Mobile Authenticator" warning repeats the title.
      displayMessage={kcContext.message?.type === 'error' && !codeError && !labelError}
      headerNode={msg('adiliTotpTitle')}
    >
      <form
        id="kc-totp-settings-form"
        action={url.loginAction}
        method="post"
        className="grid gap-5"
        onSubmit={() => {
          setSubmitting(true);
        }}
      >
        <Steps
          steps={[
            { title: msg('adiliTotpInstall'), detail: msgStr('adiliTotpInstallApps', appList) },
            mode === 'manual'
              ? {
                  title: msg('adiliTotpEnterKey'),
                  children: (
                    <div className="grid gap-2">
                      <code
                        id="kc-totp-secret-key"
                        className="rounded-md border bg-muted px-3 py-2 font-mono text-sm tracking-wider break-all"
                      >
                        {totp.totpSecretEncoded}
                      </code>
                      <p className="text-sm text-muted-foreground">
                        {totp.policy.type === 'totp'
                          ? msgStr(
                              'adiliTotpKeyDetails',
                              String(totp.policy.digits),
                              String(totp.policy.period),
                            )
                          : null}
                      </p>
                      <a
                        id="mode-barcode"
                        href={totp.qrUrl}
                        className="w-fit rounded-sm text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {msg('adiliTotpScanInstead')}
                      </a>
                    </div>
                  ),
                }
              : {
                  title: msg('adiliTotpScan'),
                  children: (
                    <div className="grid justify-items-start gap-3">
                      <img
                        id="kc-totp-secret-qr-code"
                        src={`data:image/png;base64, ${totp.totpSecretQrCode}`}
                        alt={msgStr('adiliTotpScan')}
                        width={148}
                        height={148}
                        className="size-37 rounded-md border bg-white p-1.5"
                      />
                      <a
                        id="mode-manual"
                        href={totp.manualUrl}
                        className="rounded-sm text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {msg('adiliTotpCantScan')}
                      </a>
                    </div>
                  ),
                },
            {
              title: <label htmlFor="totp">{msg('adiliTotpEnterCode')}</label>,
              children: (
                <div className="grid gap-1.5">
                  <Input
                    id="totp"
                    name="totp"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={totp.policy.digits}
                    autoFocus
                    aria-invalid={codeError || undefined}
                    aria-describedby={codeError ? 'input-error-otp-code' : undefined}
                    className="max-w-48 font-mono tracking-[0.3em]"
                  />
                  {codeError ? (
                    <FieldError id="input-error-otp-code" html={messagesPerField.get('totp')} />
                  ) : null}
                </div>
              ),
            },
          ]}
        />
        <input type="hidden" id="totpSecret" name="totpSecret" value={totp.totpSecret} />
        {mode ? <input type="hidden" id="mode" value={mode} /> : null}

        <div className="grid gap-2">
          <Label htmlFor="userLabel">
            {msg('adiliTotpDeviceLabel')}
            {labelRequired ? null : (
              <span className="font-normal text-muted-foreground"> ({msg('adiliOptional')})</span>
            )}
          </Label>
          <Input
            id="userLabel"
            name="userLabel"
            autoComplete="off"
            required={labelRequired}
            aria-invalid={labelError || undefined}
            aria-describedby={labelError ? 'input-error-otp-label' : 'userLabel-hint'}
          />
          {labelError ? (
            <FieldError id="input-error-otp-label" html={messagesPerField.get('userLabel')} />
          ) : (
            <p id="userLabel-hint" className="text-sm text-muted-foreground">
              {msg('adiliTotpDeviceHint')}
            </p>
          )}
        </div>

        {labelRequired ? (
          <CheckboxRow
            id="logout-sessions"
            name="logout-sessions"
            label={msg('adiliSignOutOtherDevices')}
          />
        ) : null}

        <div className="grid gap-3">
          <Button type="submit" id="saveTOTPBtn" size="lg" className="w-full" disabled={submitting}>
            {msgStr('adiliTotpSubmit')}
          </Button>
          {isAppInitiatedAction ? (
            <Button
              type="submit"
              id="cancelTOTPBtn"
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
