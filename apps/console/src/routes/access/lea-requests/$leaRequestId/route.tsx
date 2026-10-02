import { Button, EmptyState, Icon } from '@adili/ui';
import { Search01Icon } from '@hugeicons/core-free-icons';
import { createFileRoute, Link, notFound, Outlet } from '@tanstack/react-router';

import { messages as m } from '../../../../components/access/lea/messages';
import { LoadError } from '../../../../components/load-error';
import { Page, PageHead } from '../../../../components/page';
import { signInRedirect } from '../../../../components/sign-in-redirect';
import { getLeaRequest } from '../../../../server/lea-requests';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The crumb: the request's reference, once it is known. */
function crumbOf(loaderData: unknown): string | null {
  if (typeof loaderData !== 'object' || loaderData === null || !('ok' in loaderData)) return null;
  if (!loaderData.ok || !('data' in loaderData)) return m.title;
  const data = loaderData.data as { request?: { reference?: string } };
  return data.request?.reference ?? m.title;
}

/**
 * One law enforcement request of the viewer's Commission (spec 10 FE-6), where the access
 * officer's reminders link (`<CONSOLE_URL>/access/lea-requests/<id>`, #264): the request page
 * and its Decide page share this load. Another Commission's request, or one that does not exist,
 * reads as not found.
 */
export const Route = createFileRoute('/access/lea-requests/$leaRequestId')({
  loader: async ({ params, location, context }) => {
    if (!context.workspace) return null;
    if (!UUID.test(params.leaRequestId)) throw notFound();
    const result = await getLeaRequest({ data: { requestId: params.leaRequestId } });
    if (!result.ok && result.error.kind === 'unauthenticated') throw signInRedirect(location.href);
    if (!result.ok && result.error.kind === 'problem') {
      const { status } = result.error.problem;
      if (status === 404 || status === 403 || status === 400) throw notFound();
    }
    const now = new Date().toISOString();
    return result.ok ? { ok: true as const, data: { request: result.data, now } } : result;
  },
  staticData: { crumb: ({ loaderData }) => crumbOf(loaderData) },
  head: ({ loaderData }) => ({
    meta: [{ title: `${crumbOf(loaderData) ?? m.title} · Adili Online Console` }],
  }),
  component: LeaRequestLayout,
  notFoundComponent: () => (
    <Page narrow>
      <EmptyState
        icon={<Icon icon={Search01Icon} />}
        title={m.notFoundTitle}
        description={m.notFoundText}
        action={
          <Button asChild variant="secondary" size="sm">
            <Link to="/access/requests" search={{ kind: 'lea' }}>
              {m.backToRequests}
            </Link>
          </Button>
        }
      />
    </Page>
  ),
});

function LeaRequestLayout() {
  const load = Route.useLoaderData();
  const { workspace } = Route.useRouteContext();
  if (!load || !workspace) return null;
  if (!load.ok) {
    return (
      <Page narrow>
        <PageHead title={m.title} />
        <LoadError
          title={m.requestErrorTitle}
          detail={m.requestErrorDetail}
          retryLabel={m.tryAgain}
        />
      </Page>
    );
  }
  return <Outlet />;
}
