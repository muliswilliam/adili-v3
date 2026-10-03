import { createFileRoute, notFound } from '@tanstack/react-router';

import { NoticePage } from '../../../components/access-notices/notice-page';
import {
  NoticeNotFound,
  NoticesShell,
  NoticeUnavailable,
} from '../../../components/access-notices/notices-shell';
import { signInRedirect } from '../../../components/declaration/route-helpers';
import { isUuid } from '../../../declaration/section-key';
import { getMyAccessNotice } from '../../../server/access-notices';

/**
 * A request someone made to see the declarant's declaration (spec 10 FE-4), with the form for
 * their representations while the window is open and the outcome after the decision.
 */
export const Route = createFileRoute('/access/notices/$id')({
  loader: async ({ params, location }) => {
    if (!isUuid(params.id)) throw notFound();
    const result = await getMyAccessNotice({ data: { requestId: params.id } });
    if (result.status === 'unauthenticated') throw signInRedirect(location.href);
    return result;
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title:
          loaderData?.status === 'ok'
            ? `${loaderData.notice.reference} · Adili Online`
            : 'Access request · Adili Online',
      },
    ],
  }),
  notFoundComponent: () => (
    <NoticesShell>
      <NoticeNotFound />
    </NoticesShell>
  ),
  component: NoticeRoute,
});

function NoticeRoute() {
  const result = Route.useLoaderData();
  return (
    <NoticesShell>
      {result.status === 'ok' ? (
        <NoticePage
          // A reload brings the latest state (a decision, a change from another device).
          key={`${result.notice.requestId}:${result.notice.status}:${result.notice.kind === 'form-k' ? (result.notice.representations?.updatedAt ?? '') : ''}`}
          notice={result.notice}
          now={result.now}
        />
      ) : result.status === 'not-found' ? (
        <NoticeNotFound />
      ) : (
        <NoticeUnavailable />
      )}
    </NoticesShell>
  );
}
