import { Button } from '@adili/ui';
import { CheckmarkCircle02Icon } from '@hugeicons/core-free-icons';
import { kcSanitize } from 'keycloakify/lib/kcSanitize';
import type { PageProps } from 'keycloakify/login/pages/PageProps';

import type { I18n } from '../i18n';
import type { KcContext } from '../KcContext';
import { audienceOf, messageIsOneOf } from '../shared';
import Template from '../Template';

type InfoKcContext = Extract<KcContext, { pageId: 'info.ftl' }>;
type InfoProps = PageProps<InfoKcContext, I18n>;

export type InfoState = 'actions-landing' | 'actions-done' | 'other';

/** Which of the designed info pages this is. */
export function infoState(kcContext: InfoKcContext, i18n: I18n): InfoState {
  if (kcContext.requiredActions?.length && kcContext.actionUri) return 'actions-landing';
  if (messageIsOneOf(kcContext, i18n, ['accountUpdatedMessage'])) return 'actions-done';
  return 'other';
}

/**
 * info.ftl: the landing page of the set-password (execute-actions) link, the page after the
 * password is set, and any other notice Keycloak shows.
 */
export default function Info(props: InfoProps) {
  switch (infoState(props.kcContext, props.i18n)) {
    case 'actions-landing':
      return <ActionsLanding {...props} />;
    case 'actions-done':
      return <ActionsDone {...props} />;
    case 'other':
      return <OtherInfo {...props} />;
  }
}

function ActionsLanding({ kcContext, i18n, doUseDefaultCss, classes }: InfoProps) {
  const { requiredActions = [], actionUri } = kcContext;
  const { msg, advancedMsgStr } = i18n;
  const staff = audienceOf(kcContext) === 'staff';

  return (
    <Template
      kcContext={kcContext}
      i18n={i18n}
      doUseDefaultCss={doUseDefaultCss}
      classes={classes}
      displayMessage={false}
      headerNode={msg(staff ? 'adiliStaffActivateTitle' : 'adiliActivateTitle')}
      subtitleNode={msg(staff ? 'adiliStaffActivateText' : 'adiliActivateText')}
    >
      {staff ? (
        <ol className="grid list-inside list-decimal gap-2 rounded-lg border p-4 text-sm">
          {requiredActions.map((action) => (
            <li key={action}>{advancedMsgStr(`requiredAction.${action}`)}</li>
          ))}
        </ol>
      ) : null}
      <div className="grid gap-3">
        <Button asChild className="w-full">
          <a href={actionUri}>{msg(staff ? 'adiliStaffActivateButton' : 'adiliActivateButton')}</a>
        </Button>
        <p className="text-[13px] text-muted-foreground">{msg('adiliLinkWorksOnce')}</p>
      </div>
    </Template>
  );
}

function ActionsDone({ kcContext, i18n, doUseDefaultCss, classes }: InfoProps) {
  const { pageRedirectUri, client, skipLink } = kcContext;
  const { msg } = i18n;
  const staff = audienceOf(kcContext) === 'staff';
  const next = pageRedirectUri ?? client.baseUrl;

  return (
    <Template
      kcContext={kcContext}
      i18n={i18n}
      doUseDefaultCss={doUseDefaultCss}
      classes={classes}
      displayMessage={false}
      mark={{ icon: CheckmarkCircle02Icon, tone: 'success' }}
      headerNode={msg(staff ? 'adiliStaffActiveTitle' : 'adiliPasswordSetTitle')}
      subtitleNode={msg(staff ? 'adiliStaffActiveText' : 'adiliPasswordSetText')}
    >
      {!skipLink && next ? (
        <Button asChild className="w-full">
          <a href={next}>{msg(staff ? 'adiliGoToConsole' : 'adiliSignIn')}</a>
        </Button>
      ) : null}
    </Template>
  );
}

function OtherInfo({ kcContext, i18n, doUseDefaultCss, classes }: InfoProps) {
  const { messageHeader, message, skipLink, pageRedirectUri, actionUri, client } = kcContext;
  const { msg, advancedMsgStr } = i18n;
  const next = pageRedirectUri ?? actionUri ?? client.baseUrl;

  return (
    <Template
      kcContext={kcContext}
      i18n={i18n}
      doUseDefaultCss={doUseDefaultCss}
      classes={classes}
      displayMessage={false}
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
          className="text-sm text-muted-foreground"
          dangerouslySetInnerHTML={{ __html: kcSanitize(message.summary) }}
        />
      ) : null}
      {!skipLink && next ? (
        <Button asChild className="w-full">
          <a href={next}>{msg('adiliContinue')}</a>
        </Button>
      ) : null}
    </Template>
  );
}
