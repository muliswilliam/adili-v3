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
import type { ReactNode } from 'react';

import { Callout } from '../components/PageAlert';
import type { I18n } from '../i18n';
import type { KcContext } from '../KcContext';
import { audienceCopy, audienceOf, clientUrl, messageIsOneOf } from '../shared';
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

/** How each error page reads: its mark, copy, help callout and sign-in button. */
interface ErrorPageCopy {
  mark: PageMark;
  title: ReactNode;
  text: ReactNode;
  help?: ReactNode;
  signIn: { label: 'adiliGoToSignIn' | 'adiliBackToSignIn'; primary: boolean };
}

/**
 * error.ftl: an expired or unusable set-password link, a disabled account, or anything else
 * Keycloak could not complete. Declarant and staff copy differ by client (portal or console).
 */
export default function ErrorPage({ kcContext, i18n, doUseDefaultCss, classes }: ErrorProps) {
  const { client, url, message } = kcContext;
  const { msg } = i18n;
  const state = errorState(kcContext, i18n);
  const audience = audienceOf(kcContext);
  const copy = audienceCopy(audience, i18n);
  const signInUrl = client.baseUrl ?? url.loginUrl;
  const newLinkUrl = clientUrl(client.baseUrl, PORTAL_NEW_LINK_PATH);

  const pages: Record<ErrorState, ErrorPageCopy> = {
    'link-expired': {
      mark: { icon: Clock01Icon, tone: 'warning' },
      title: msg('adiliLinkExpiredTitle'),
      text: copy.msg('linkExpiredText'),
      signIn: { label: 'adiliBackToSignIn', primary: false },
    },
    'link-invalid': {
      mark: { icon: Unlink01Icon, tone: 'destructive' },
      title: msg('adiliLinkInvalidTitle'),
      text: msg('adiliLinkInvalidText'),
      help: copy.msg('linkInvalidHelp'),
      signIn: { label: 'adiliGoToSignIn', primary: true },
    },
    'account-disabled': {
      mark: { icon: UnavailableIcon, tone: 'destructive' },
      title: copy.msg('disabledTitle'),
      text: copy.msg('disabledText'),
      help: copy.msg('disabledHelp'),
      signIn: { label: 'adiliBackToSignIn', primary: false },
    },
    other: {
      mark: { icon: Alert01Icon, tone: 'neutral' },
      title: msg('adiliErrorTitle'),
      text: msg('adiliErrorText'),
      signIn: { label: 'adiliBackToSignIn', primary: true },
    },
  };
  const page = pages[state];
  // A declarant with an expired link gets a new one from the portal instead of signing in.
  const offerNewLink = state === 'link-expired' && audience === 'declarant' && newLinkUrl;

  return (
    <Template
      kcContext={kcContext}
      i18n={i18n}
      doUseDefaultCss={doUseDefaultCss}
      classes={classes}
      displayMessage={false}
      mark={page.mark}
      headerNode={page.title}
      subtitleNode={page.text}
    >
      <div className="grid gap-3">
        {offerNewLink ? (
          <>
            <Button asChild className="w-full">
              <a href={newLinkUrl}>{msg('adiliGetNewLink')}</a>
            </Button>
            <Callout>{msg('adiliLinkExpiredOtherDevice')}</Callout>
          </>
        ) : (
          <>
            {page.help ? <Callout>{page.help}</Callout> : null}
            <Button
              asChild
              variant={page.signIn.primary ? 'default' : 'secondary'}
              className="w-full"
            >
              <a href={signInUrl}>{msg(page.signIn.label)}</a>
            </Button>
          </>
        )}

        {state === 'other' ? (
          <>
            <p className="text-[13px] text-muted-foreground">
              {msg('adiliErrorHelp', copy.msgStr('helpContact'))}
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
