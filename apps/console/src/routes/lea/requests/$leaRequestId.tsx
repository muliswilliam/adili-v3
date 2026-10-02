import { Button, EmptyState, Icon } from '@adili/ui';
import { Search01Icon } from '@hugeicons/core-free-icons';
import { createFileRoute, Link, notFound } from '@tanstack/react-router';

import { messages as m } from '../../../components/lea/messages';
import { MyRequest } from '../../../components/lea/my-request';
import { LoadError } from '../../../components/load-error';
import { Page, PageHead } from '../../../components/page';
import { signInRedirect } from '../../../components/sign-in-redirect';
import { getLeaRequest } from '../../../server/lea-requests';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function crumbOf(loaderData: unknown): string | null {
  if (typeof loaderData !== 'object' || loaderData === null || !('ok' in loaderData)) return null;
  if (!loaderData.ok || !('data' in loaderData)) return m.title;
  const data = loaderData.data as { request?: { reference?: string } };
  return data.request?.reference ?? m.title;
}

/**
 * One of the officer's requests (spec 10 FE-6), where the decision notice links
 * (`<CONSOLE_URL>/lea/requests/<id>`, #264). Another officer's request, or one that does not
 * exist, reads as not found.
 */
export const Route = createFileRoute('/lea/requests/$leaRequestId')({
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
  component: MyRequestRoute,
  notFoundComponent: () => (
    <Page narrow>
      <EmptyState
        icon={<Icon icon={Search01Icon} />}
        title={m.notFoundTitle}
        description={m.notFoundText}
        action={
          <Button asChild variant="secondary" size="sm">
            <Link to="/lea/requests">{m.backToRequests}</Link>
          </Button>
        }
      />
    </Page>
  ),
});

function MyRequestRoute() {
  const load = Route.useLoaderData();
  if (!load) return null;
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
  return <MyRequest request={load.data.request} now={load.data.now} />;
}
