import { Button } from '@adili/ui';
import { Logout03Icon } from '@hugeicons/core-free-icons';
import type { PageProps } from 'keycloakify/login/pages/PageProps';

import type { I18n } from '../i18n';
import type { KcContext } from '../KcContext';
import { audienceCopy, audienceOf } from '../shared';
import Template from '../Template';

type LogoutConfirmProps = PageProps<Extract<KcContext, { pageId: 'logout-confirm.ftl' }>, I18n>;

/** logout-confirm.ftl: asks before ending the session. */
export default function LogoutConfirm({
  kcContext,
  i18n,
  doUseDefaultCss,
  classes,
}: LogoutConfirmProps) {
  const { url, client, logoutConfirm } = kcContext;
  const { msg, msgStr } = i18n;
  const copy = audienceCopy(audienceOf(kcContext), i18n);

  return (
    <Template
      kcContext={kcContext}
      i18n={i18n}
      doUseDefaultCss={doUseDefaultCss}
      classes={classes}
      mark={{ icon: Logout03Icon, tone: 'neutral' }}
      headerNode={msg('adiliLogoutTitle')}
      subtitleNode={copy.msg('logoutText')}
    >
      <form
        action={url.logoutConfirmAction}
        method="post"
        className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"
      >
        <input type="hidden" name="session_code" value={logoutConfirm.code} />
        {!logoutConfirm.skipLink && client.baseUrl ? (
          <Button asChild variant="secondary">
            <a href={client.baseUrl}>{msg('adiliCancel')}</a>
          </Button>
        ) : null}
        <Button type="submit" id="kc-logout" name="confirmLogout" value={msgStr('doLogout')}>
          {msg('adiliSignOut')}
        </Button>
      </form>
    </Template>
  );
}
