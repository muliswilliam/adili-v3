import { Alert, AlertDescription, Card, Icon, LogoMark } from '@adili/ui';
import {
  Alert02Icon,
  AlertCircleIcon,
  CheckmarkCircle02Icon,
  InformationCircleIcon,
  RotateLeft01Icon,
} from '@hugeicons/core-free-icons';
import { kcSanitize } from 'keycloakify/lib/kcSanitize';
import { useInitialize } from 'keycloakify/login/Template.useInitialize';
import type { TemplateProps } from 'keycloakify/login/TemplateProps';
import { useEffect } from 'react';

import type { I18n } from './i18n';
import type { KcContext } from './KcContext';

const messageIcons = {
  success: CheckmarkCircle02Icon,
  warning: Alert02Icon,
  error: AlertCircleIcon,
  info: InformationCircleIcon,
} as const;

/** Page frame for every login flow: brand, card, messages and language switch. */
export default function Template(props: TemplateProps<KcContext, I18n>) {
  const {
    displayInfo = false,
    displayMessage = true,
    headerNode,
    socialProvidersNode = null,
    infoNode = null,
    documentTitle,
    kcContext,
    i18n,
    doUseDefaultCss,
    children,
  } = props;
  const { msg, msgStr, currentLanguage, enabledLanguages } = i18n;
  const { realm, auth, url, message, isAppInitiatedAction } = kcContext;

  useEffect(() => {
    document.title = documentTitle ?? msgStr('loginTitle', realm.displayName || realm.name);
  }, [documentTitle, msgStr, realm.displayName, realm.name]);

  const { isReadyToRender } = useInitialize({ kcContext, doUseDefaultCss });
  if (!isReadyToRender) return null;

  const showMessage =
    displayMessage &&
    message !== undefined &&
    (message.type !== 'warning' || !isAppInitiatedAction);
  const messageIcon = message ? messageIcons[message.type] : InformationCircleIcon;
  const showAttemptedUsername = auth?.showUsername === true && !auth.showResetCredentials;

  return (
    <div className="flex min-h-dvh flex-col bg-muted/40">
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-12">
        <div className="grid w-full max-w-[400px] gap-8">
          <div className="grid justify-items-center gap-3 text-center">
            <LogoMark className="size-11" />
            <p className="text-sm font-medium text-muted-foreground">
              {realm.displayName || 'Adili Online'}
            </p>
          </div>

          <Card className="gap-6">
            <header className="grid gap-5">
              {showAttemptedUsername ? (
                <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/50 px-3 py-2">
                  <span className="min-w-0 truncate text-sm font-medium">
                    {auth.attemptedUsername}
                  </span>
                  <a
                    href={url.loginRestartFlowUrl}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-sm text-sm font-medium whitespace-nowrap text-primary outline-none hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <Icon icon={RotateLeft01Icon} className="size-3.5" />
                    {msg('restartLoginTooltip')}
                  </a>
                </div>
              ) : null}
              <h1 id="kc-page-title" className="text-xl font-semibold tracking-tight">
                {headerNode}
              </h1>
            </header>

            <div id="kc-content" className="grid gap-5">
              {showMessage ? (
                <Alert
                  variant={
                    message.type === 'error'
                      ? 'destructive'
                      : message.type === 'warning'
                        ? 'warning'
                        : 'info'
                  }
                >
                  <Icon icon={messageIcon} />
                  <AlertDescription
                    dangerouslySetInnerHTML={{ __html: kcSanitize(message.summary) }}
                  />
                </Alert>
              ) : null}
              {children}
              {auth?.showTryAnotherWayLink ? (
                <form id="kc-select-try-another-way-form" action={url.loginAction} method="post">
                  <input type="hidden" name="tryAnotherWay" value="on" />
                  <button
                    type="submit"
                    className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                  >
                    {msg('doTryAnotherWay')}
                  </button>
                </form>
              ) : null}
              {socialProvidersNode}
            </div>
          </Card>

          {displayInfo ? (
            <div className="text-center text-sm text-muted-foreground">{infoNode}</div>
          ) : null}
        </div>
      </main>

      <footer className="flex flex-col items-center gap-3 px-4 pb-8 text-[13px] text-muted-foreground">
        {enabledLanguages.length > 1 ? (
          <nav
            aria-label={msgStr('languages')}
            className="flex max-w-md flex-wrap items-center justify-center gap-1"
          >
            {enabledLanguages.map(({ languageTag, label, href }) => (
              <a
                key={languageTag}
                href={href}
                lang={languageTag}
                aria-current={languageTag === currentLanguage.languageTag ? 'true' : undefined}
                className="rounded-md px-2 py-1 whitespace-nowrap outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-[current=true]:font-medium aria-[current=true]:text-foreground"
              >
                {label}
              </a>
            ))}
          </nav>
        ) : null}
        <p>Conflict of Interest Act, 2025 and Regulations, 2026.</p>
      </footer>
    </div>
  );
}
