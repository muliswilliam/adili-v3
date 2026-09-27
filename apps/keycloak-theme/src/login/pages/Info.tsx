import { Button } from '@adili/ui';
import { kcSanitize } from 'keycloakify/lib/kcSanitize';
import type { PageProps } from 'keycloakify/login/pages/PageProps';
import { CircleCheck } from 'lucide-react';

import { Lead, StateTitle, type Step, Steps } from '../components';
import type { I18n } from '../i18n';
import type { KcContext } from '../KcContext';

type InfoProps = PageProps<Extract<KcContext, { pageId: 'info.ftl' }>, I18n>;

/** The order Keycloak runs the staff required actions in (by their realm priority). */
const KNOWN_ACTIONS = ['VERIFY_EMAIL', 'CONFIGURE_TOTP', 'UPDATE_PASSWORD'];

/**
 * info.ftl. Three cases get their own design: the page an emailed execute-actions link opens
 * (what the link will ask for, and Continue), the page after those actions ("account ready",
 * with the way into sign-in), and any other information Keycloak shows.
 */
export default function Info({ kcContext, i18n, doUseDefaultCss, Template, classes }: InfoProps) {
  const { messageHeader, message, requiredActions, skipLink, pageRedirectUri, actionUri, client } =
    kcContext;
  const { msg, msgStr, advancedMsgStr } = i18n;
  const frame = { kcContext, i18n, doUseDefaultCss, classes, displayMessage: false } as const;

  if (requiredActions?.length && actionUri) {
    const activation = requiredActions.includes('VERIFY_EMAIL');
    const ordered = [
      ...KNOWN_ACTIONS.filter((action) => requiredActions.includes(action)),
      ...requiredActions.filter((action) => !KNOWN_ACTIONS.includes(action)),
    ];
    return (
      <Template {...frame} headerNode={msg(activation ? 'adiliActivateTitle' : 'adiliSetupTitle')}>
        <Lead>{msg(activation ? 'adiliActivateLead' : 'adiliSetupLead')}</Lead>
        <Steps steps={ordered.map((action) => stepFor(action, i18n))} />
        <Button asChild size="lg" className="w-full">
          <a href={actionUri}>{msg('adiliContinue')}</a>
        </Button>
      </Template>
    );
  }

  if (message.summary === msgStr('accountUpdatedMessage')) {
    const next = skipLink ? undefined : (pageRedirectUri ?? client.baseUrl);
    return (
      <Template
        {...frame}
        headerNode={
          <StateTitle icon={CircleCheck} tone="success">
            {msg('adiliAccountReadyTitle')}
          </StateTitle>
        }
      >
        <Lead>{msg('adiliAccountReadyLead')}</Lead>
        {next ? (
          <Button asChild size="lg" className="w-full">
            <a href={next}>{msg('adiliSignIn')}</a>
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">{msg('adiliCloseWindow')}</p>
        )}
      </Template>
    );
  }

  const next = skipLink ? undefined : (pageRedirectUri ?? actionUri ?? client.baseUrl);
  return (
    <Template
      {...frame}
      headerNode={
        <span
          dangerouslySetInnerHTML={{
            __html: kcSanitize(messageHeader ? advancedMsgStr(messageHeader) : message.summary),
          }}
        />
      }
    >
      {messageHeader ? (
        <p
          className="-mt-2 text-sm leading-6 text-muted-foreground"
          dangerouslySetInnerHTML={{ __html: kcSanitize(message.summary) }}
        />
      ) : null}
      {next ? (
        <Button asChild size="lg" className="w-full">
          <a href={next}>
            {msg(actionUri && !pageRedirectUri ? 'adiliContinue' : 'adiliBackToAdili')}
          </a>
        </Button>
      ) : null}
    </Template>
  );
}

function stepFor(action: string, i18n: I18n): Step {
  const { msg, advancedMsgStr } = i18n;
  switch (action) {
    case 'VERIFY_EMAIL':
      return { title: msg('adiliStepVerifyEmail'), detail: msg('adiliStepVerifyEmailDetail') };
    case 'CONFIGURE_TOTP':
      return { title: msg('adiliStepTotp'), detail: msg('adiliStepTotpDetail') };
    case 'UPDATE_PASSWORD':
      return { title: msg('adiliStepPassword'), detail: msg('adiliStepPasswordDetail') };
    default:
      return { title: advancedMsgStr(`requiredAction.${action}`) };
  }
}
