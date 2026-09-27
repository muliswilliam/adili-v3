import { Button } from '@adili/ui';
import { CheckmarkCircle02Icon } from '@hugeicons/core-free-icons';
import { kcSanitize } from 'keycloakify/lib/kcSanitize';
import type { PageProps } from 'keycloakify/login/pages/PageProps';

import { type Step, Steps } from '../components/Steps';
import type { I18n } from '../i18n';
import type { KcContext } from '../KcContext';
import { audienceCopy, audienceOf, messageIsOneOf } from '../shared';
import Template from '../Template';

type InfoKcContext = Extract<KcContext, { pageId: 'info.ftl' }>;
type InfoProps = PageProps<InfoKcContext, I18n>;

export type InfoState = 'actions-landing' | 'actions-done' | 'other';

/** The order Keycloak runs the staff required actions in (by their realm priority). */
const STAFF_ACTION_ORDER = ['VERIFY_EMAIL', 'CONFIGURE_TOTP', 'UPDATE_PASSWORD'];

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
  const { msg } = i18n;
  const audience = audienceOf(kcContext);
  const copy = audienceCopy(audience, i18n);

  return (
    <Template
      kcContext={kcContext}
      i18n={i18n}
      doUseDefaultCss={doUseDefaultCss}
      classes={classes}
      displayMessage={false}
      headerNode={copy.msg('activateTitle')}
      subtitleNode={copy.msg('activateText')}
    >
      {audience === 'staff' ? (
        <Steps
          steps={[
            ...STAFF_ACTION_ORDER.filter((action) => requiredActions.includes(action)),
            ...requiredActions.filter((action) => !STAFF_ACTION_ORDER.includes(action)),
          ].map((action) => stepFor(action, i18n))}
        />
      ) : null}
      <div className="grid gap-3">
        <Button asChild className="w-full">
          <a href={actionUri}>{copy.msg('activateButton')}</a>
        </Button>
        <p className="text-[13px] text-muted-foreground">{msg('adiliLinkWorksOnce')}</p>
      </div>
    </Template>
  );
}

function ActionsDone({ kcContext, i18n, doUseDefaultCss, classes }: InfoProps) {
  const { pageRedirectUri, client, skipLink } = kcContext;
  const copy = audienceCopy(audienceOf(kcContext), i18n);
  const next = pageRedirectUri ?? client.baseUrl;

  return (
    <Template
      kcContext={kcContext}
      i18n={i18n}
      doUseDefaultCss={doUseDefaultCss}
      classes={classes}
      displayMessage={false}
      mark={{ icon: CheckmarkCircle02Icon, tone: 'success' }}
      headerNode={copy.msg('activeTitle')}
      subtitleNode={copy.msg('activeText')}
    >
      {!skipLink && next ? (
        <Button asChild className="w-full">
          <a href={next}>{copy.msg('goToApp')}</a>
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

/** A staff required action as a step: what it is and what it asks of them. */
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
