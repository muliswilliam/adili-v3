import { Button } from '@adili/ui';
import {
  Alert01Icon,
  Clock01Icon,
  UnavailableIcon,
  Unlink01Icon,
} from '@hugeicons/core-free-icons';
import { kcSanitize } from 'keycloakify/lib/kcSanitize';
import type { MessageKey_defaultSet } from 'keycloakify/login';
import type { PageProps } from 'keycloakify/login/pages/PageProps';

import { Callout } from '../components/PageAlert';
import type { I18n } from '../i18n';
import type { KcContext } from '../KcContext';
import { audienceOf, clientUrl, messageIsOneOf } from '../shared';
import Template, { type PageMark } from '../Template';

type ErrorKcContext = Extract<KcContext, { pageId: 'error.ftl' }>;
type ErrorProps = PageProps<ErrorKcContext, I18n>;

export type ErrorState = 'link-expired' | 'link-invalid' | 'account-disabled' | 'other';

/** Where the portal explains how to get a new set-password link (spec 03, Check your email). */
export const PORTAL_NEW_LINK_PATH = 'get-started/check-email';

/** The Keycloak messages behind each designed error page. */
const ERROR_MESSAGES: Record<Exclude<ErrorState, 'other'>, readonly MessageKey_defaultSet[]> = {
  'link-expired': [
    'expiredActionMessage',
    'expiredActionTokenNoSessionMessage',
    'expiredActionTokenSessionExistsMessage',
  ],
  'link-invalid': [
    'invalidCodeMessage',
    'invalidTokenRequiredActions',
    'staleEmailVerificationLink',
  ],
  'account-disabled': ['accountDisabledMessage'],
};

export function errorState(kcContext: ErrorKcContext, i18n: I18n): ErrorState {
  for (const [state, keys] of Object.entries(ERROR_MESSAGES)) {
    if (messageIsOneOf(kcContext, i18n, keys)) return state as ErrorState;
  }
  return 'other';
}

const MARKS: Record<ErrorState, PageMark> = {
  'link-expired': { icon: Clock01Icon, tone: 'warning' },
  'link-invalid': { icon: Unlink01Icon, tone: 'destructive' },
  'account-disabled': { icon: UnavailableIcon, tone: 'destructive' },
  other: { icon: Alert01Icon, tone: 'neutral' },
};

/**
 * error.ftl: an expired or unusable set-password link, a disabled account, or anything else
 * Keycloak could not complete. Declarant and staff copy differ by client (portal or console).
 */
export default function ErrorPage({ kcContext, i18n, doUseDefaultCss, classes }: ErrorProps) {
  const { client, url, message } = kcContext;
  const { msg, msgStr } = i18n;
  const state = errorState(kcContext, i18n);
  const staff = audienceOf(kcContext) === 'staff';
  const signInUrl = client.baseUrl ?? url.loginUrl;
  const newLinkUrl = clientUrl(client.baseUrl, PORTAL_NEW_LINK_PATH);

  const copy = {
    'link-expired': {
      title: msg('adiliLinkExpiredTitle'),
      text: msg(staff ? 'adiliLinkExpiredTextStaff' : 'adiliLinkExpiredText'),
    },
    'link-invalid': { title: msg('adiliLinkInvalidTitle'), text: msg('adiliLinkInvalidText') },
    'account-disabled': {
      title: msg(staff ? 'adiliDisabledTitleStaff' : 'adiliDisabledTitle'),
      text: msg(staff ? 'adiliDisabledTextStaff' : 'adiliDisabledText'),
    },
    other: { title: msg('adiliErrorTitle'), text: msg('adiliErrorText') },
  }[state];

  const signIn = (
    <Button
      asChild
      variant={state === 'link-invalid' || state === 'other' ? 'default' : 'secondary'}
      className="w-full"
    >
      <a href={signInUrl}>
        {msg(state === 'link-invalid' ? 'adiliGoToSignIn' : 'adiliBackToSignIn')}
      </a>
    </Button>
  );

  return (
    <Template
      kcContext={kcContext}
      i18n={i18n}
      doUseDefaultCss={doUseDefaultCss}
      classes={classes}
      displayMessage={false}
      mark={MARKS[state]}
      headerNode={copy.title}
      subtitleNode={copy.text}
    >
      <div className="grid gap-3">
        {state === 'link-expired' ? (
          staff || !newLinkUrl ? (
            signIn
          ) : (
            <>
              <Button asChild className="w-full">
                <a href={newLinkUrl}>{msg('adiliGetNewLink')}</a>
              </Button>
              <Callout>{msg('adiliLinkExpiredOtherDevice')}</Callout>
            </>
          )
        ) : null}

        {state === 'link-invalid' ? (
          <>
            <Callout>{msg(staff ? 'adiliLinkInvalidHelpStaff' : 'adiliLinkInvalidHelp')}</Callout>
            {signIn}
          </>
        ) : null}

        {state === 'account-disabled' ? (
          <>
            <Callout>{msg(staff ? 'adiliDisabledHelpStaff' : 'adiliDisabledHelp')}</Callout>
            {signIn}
          </>
        ) : null}

        {state === 'other' ? (
          <>
            {signIn}
            <p className="text-[13px] text-muted-foreground">
              {msg('adiliErrorHelp', msgStr(staff ? 'adiliHelpStaff' : 'adiliHelpDeclarant'))}
            </p>
            {/* Keycloak's own wording, for whoever helps them. */}
            <p
              className="text-[13px] text-muted-foreground"
              dangerouslySetInnerHTML={{ __html: kcSanitize(message.summary) }}
            />
          </>
        ) : null}
      </div>
    </Template>
  );
}
