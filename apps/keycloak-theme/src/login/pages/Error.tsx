import { Button } from '@adili/ui';
import { kcSanitize } from 'keycloakify/lib/kcSanitize';
import type { PageProps } from 'keycloakify/login/pages/PageProps';
import { CircleAlert, CircleCheck, Clock } from 'lucide-react';
import { useState } from 'react';

import { actionTokenOf } from '../action-token';
import { Lead, StateTitle } from '../components';
import type { I18n } from '../i18n';
import type { KcContext } from '../KcContext';

type ErrorProps = PageProps<Extract<KcContext, { pageId: 'error.ftl' }>, I18n>;

/** Keycloak messages that mean an emailed link (action token) has expired. */
const EXPIRED_MESSAGES = [
  'expiredActionTokenNoSessionMessage',
  'expiredActionTokenSessionExistsMessage',
  'expiredActionMessage',
] as const;

/**
 * error.ftl. An expired activation link says how to get a new one (ask EACC, spec 01 story 25),
 * and a used one leads to sign-in; other errors keep Keycloak's explanation under a plain title.
 */
export default function Error({ kcContext, i18n, doUseDefaultCss, Template, classes }: ErrorProps) {
  const { message, skipLink } = kcContext;
  // Absent at runtime on some errors (an expired link has no client), whatever the type says.
  const client = kcContext.client as { baseUrl?: string } | undefined;
  const { msg, msgStr } = i18n;
  const frame = { kcContext, i18n, doUseDefaultCss, classes, displayMessage: false } as const;
  const back = skipLink ? undefined : client?.baseUrl;
  // The token is still in the address bar: it tells an activation link apart, and whether it
  // really expired or was already used (Keycloak reports both as "Action expired.").
  const [token] = useState(() => actionTokenOf(window.location.search, Date.now()));

  if (EXPIRED_MESSAGES.some((key) => message.summary === msgStr(key))) {
    if (token?.typ === 'execute-actions') {
      return !token.expired ? (
        <Template
          {...frame}
          headerNode={
            <StateTitle icon={CircleCheck} tone="success">
              {msg('adiliLinkUsedTitle')}
            </StateTitle>
          }
        >
          <Lead>{msg('adiliLinkUsedLead')}</Lead>
          {token.reduri ? (
            <Button asChild size="lg" className="w-full">
              <a href={token.reduri}>{msg('adiliSignIn')}</a>
            </Button>
          ) : null}
        </Template>
      ) : (
        <Template
          {...frame}
          headerNode={
            <StateTitle icon={Clock} tone="warning">
              {msg('adiliLinkExpiredTitle')}
            </StateTitle>
          }
        >
          <Lead>
            {[
              token.lifespanHours > 0
                ? msgStr('adiliActivationLifespan', String(token.lifespanHours))
                : '',
              msgStr('adiliActivationAskResend'),
            ]
              .filter(Boolean)
              .join(' ')}
          </Lead>
          {token.reduri ? (
            <Button asChild variant="outline" size="lg" className="w-full">
              <a href={token.reduri}>{msg('adiliAlreadyActivated')}</a>
            </Button>
          ) : null}
        </Template>
      );
    }
    return (
      <Template
        {...frame}
        headerNode={
          <StateTitle icon={Clock} tone="warning">
            {msg('adiliLinkExpiredTitle')}
          </StateTitle>
        }
      >
        <Lead>{msg('adiliLinkExpiredLead')}</Lead>
        {back ? (
          <Button asChild variant="outline" size="lg" className="w-full">
            <a href={back}>{msg('adiliBackToAdili')}</a>
          </Button>
        ) : null}
      </Template>
    );
  }

  return (
    <Template
      {...frame}
      headerNode={
        <StateTitle icon={CircleAlert} tone="neutral">
          {msg('adiliErrorTitle')}
        </StateTitle>
      }
    >
      <p
        className="-mt-2 text-sm leading-6 text-muted-foreground"
        dangerouslySetInnerHTML={{ __html: kcSanitize(message.summary) }}
      />
      <p className="text-sm leading-6 text-muted-foreground">{msg('adiliErrorHelp')}</p>
      {back ? (
        <Button asChild size="lg" className="w-full">
          <a id="backToApplication" href={back}>
            {msg('adiliBackToAdili')}
          </a>
        </Button>
      ) : null}
    </Template>
  );
}
