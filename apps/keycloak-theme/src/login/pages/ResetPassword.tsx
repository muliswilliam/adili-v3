import { Button, Icon, Input, Label } from '@adili/ui';
import { AlertCircleIcon, ArrowLeft01Icon } from '@hugeicons/core-free-icons';
import { kcSanitize } from 'keycloakify/lib/kcSanitize';
import type { PageProps } from 'keycloakify/login/pages/PageProps';
import { useState } from 'react';

import { PageAlert } from '../components/PageAlert';
import type { I18n } from '../i18n';
import type { KcContext } from '../KcContext';
import { audienceCopy, audienceOf } from '../shared';
import Template from '../Template';

type ResetPasswordProps = PageProps<
  Extract<KcContext, { pageId: 'login-reset-password.ftl' }>,
  I18n
>;

/** login-reset-password.ftl: Forgot password asks for the identifier and emails a link. */
export default function ResetPassword({
  kcContext,
  i18n,
  doUseDefaultCss,
  classes,
}: ResetPasswordProps) {
  const { url, auth, messagesPerField } = kcContext;
  const { msg, msgStr } = i18n;
  const [sending, setSending] = useState(false);
  const audience = audienceOf(kcContext);
  const copy = audienceCopy(audience, i18n);
  const error = messagesPerField.existsError('username')
    ? messagesPerField.get('username')
    : undefined;

  return (
    <Template
      kcContext={kcContext}
      i18n={i18n}
      doUseDefaultCss={doUseDefaultCss}
      classes={classes}
      displayMessage={error === undefined}
      headerNode={msg('adiliResetTitle')}
      subtitleNode={msg('adiliResetText')}
    >
      {error ? (
        <PageAlert variant="destructive" icon={AlertCircleIcon}>
          <span dangerouslySetInnerHTML={{ __html: kcSanitize(error) }} />
        </PageAlert>
      ) : null}
      <form
        id="kc-reset-password-form"
        action={url.loginAction}
        method="post"
        className="grid gap-5"
        onSubmit={() => {
          setSending(true);
        }}
      >
        <div className="grid gap-2">
          <Label htmlFor="username">{copy.msg('identifier')}</Label>
          <Input
            id="username"
            name="username"
            type={audience === 'staff' ? 'email' : 'text'}
            autoComplete="username"
            autoCapitalize="off"
            spellCheck={false}
            autoFocus={error === undefined}
            defaultValue={auth.attemptedUsername ?? ''}
            aria-invalid={error ? true : undefined}
          />
        </div>
        <Button type="submit" className="w-full" disabled={sending}>
          {msgStr('adiliResetButton')}
        </Button>
        <p className="text-[13px] text-muted-foreground">{copy.msg('resetHelp')}</p>
      </form>
      <a
        href={url.loginUrl}
        className="inline-flex items-center gap-1.5 justify-self-start rounded-sm text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Icon icon={ArrowLeft01Icon} className="size-4" />
        {msg('adiliBackToSignIn')}
      </a>
    </Template>
  );
}
