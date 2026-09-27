import { Button } from '@adili/ui';
import { Timer01Icon } from '@hugeicons/core-free-icons';
import type { PageProps } from 'keycloakify/login/pages/PageProps';

import type { I18n } from '../i18n';
import type { KcContext } from '../KcContext';
import Template from '../Template';

type PageExpiredProps = PageProps<Extract<KcContext, { pageId: 'login-page-expired.ftl' }>, I18n>;

/** login-page-expired.ftl: the sign-in page was left too long or opened in another tab. */
export default function PageExpired({
  kcContext,
  i18n,
  doUseDefaultCss,
  classes,
}: PageExpiredProps) {
  const { url } = kcContext;
  const { msg } = i18n;

  return (
    <Template
      kcContext={kcContext}
      i18n={i18n}
      doUseDefaultCss={doUseDefaultCss}
      classes={classes}
      mark={{ icon: Timer01Icon, tone: 'warning' }}
      headerNode={msg('adiliPageExpiredTitle')}
      subtitleNode={msg('adiliPageExpiredText')}
    >
      <div className="grid gap-3">
        <Button asChild className="w-full">
          <a id="loginRestartLink" href={url.loginRestartFlowUrl}>
            {msg('adiliStartAgain')}
          </a>
        </Button>
        <Button asChild variant="secondary" className="w-full">
          <a id="loginContinueLink" href={url.loginAction}>
            {msg('adiliContinue')}
          </a>
        </Button>
      </div>
    </Template>
  );
}
