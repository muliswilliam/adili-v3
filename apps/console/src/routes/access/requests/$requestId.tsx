import { Button, EmptyState, Icon } from '@adili/ui';
import { Search01Icon } from '@hugeicons/core-free-icons';
import { createFileRoute, Link, notFound } from '@tanstack/react-router';

import { messages as m } from '../../../components/access/messages';
import { RequestDetailView } from '../../../components/access/request-detail';
import { LoadError } from '../../../components/load-error';
import { Page, PageHead } from '../../../components/page';
import { signInRedirect } from '../../../components/sign-in-redirect';
import { getAccessRequest } from '../../../server/access-requests';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The crumb: the request's reference, once it is known. */
function crumbOf(loaderData: unknown): string | null {
  if (typeof loaderData !== 'object' || loaderData === null || !('ok' in loaderData)) return null;
  if (!loaderData.ok || !('data' in loaderData)) return m.formK;
  const data = loaderData.data as { view?: { reference?: string } };
  return data.view?.reference ?? m.formK;
}

/**
 * One Form K request (spec 10 FE-5), where the access officer's reminders link
 * (`<CONSOLE_URL>/access/requests/<id>`, #253). Another Commission's request, or one that does
 * not exist, reads as not found.
 */
export const Route = createFileRoute('/access/requests/$requestId')({
  loader: async ({ params, location, context }) => {
    if (!context.workspace) return null;
    if (!UUID.test(params.requestId)) throw notFound();
    const result = await getAccessRequest({ data: { requestId: params.requestId } });
    if (!result.ok && result.error.kind === 'unauthenticated') throw signInRedirect(location.href);
    if (!result.ok && result.error.kind === 'problem') {
      const { status } = result.error.problem;
      if (status === 404 || status === 403 || status === 400) throw notFound();
    }
    const now = new Date().toISOString();
    return result.ok ? { ok: true as const, data: { view: result.data, now } } : result;
  },
  staticData: { crumb: ({ loaderData }) => crumbOf(loaderData) },
  head: ({ loaderData }) => ({
    meta: [{ title: `${crumbOf(loaderData) ?? m.title} · Adili Online Console` }],
  }),
  component: RequestRoute,
  notFoundComponent: () => (
    <Page narrow>
      <EmptyState
        icon={<Icon icon={Search01Icon} />}
        title={m.notFoundTitle}
        description={m.notFoundText}
        action={
          <Button asChild variant="secondary" size="sm">
            <Link to="/access/requests">{m.backToRequests}</Link>
          </Button>
        }
      />
    </Page>
  ),
});

function RequestRoute() {
  const load = Route.useLoaderData();
  const { workspace } = Route.useRouteContext();
  if (!load || !workspace) return null;
  if (!load.ok) {
    return (
      <Page narrow>
        <PageHead title={m.formK} />
        <LoadError
          title={m.requestErrorTitle}
          detail={m.requestErrorDetail}
          retryLabel={m.tryAgain}
        />
      </Page>
    );
  }
  const { view, now } = load.data;
  return (
    <RequestDetailView
      // A new status starts the step's forms again (a verified request opens Identify officer).
      key={`${view.id}:${view.status}:${view.resolvedRosterRecordId ?? ''}`}
      view={view}
      readOnly={workspace.readOnly}
      now={now}
    />
  );
}
