import { Button, EmptyState, Icon } from '@adili/ui';
import { Search01Icon } from '@hugeicons/core-free-icons';
import { createFileRoute, Link, notFound } from '@tanstack/react-router';

import { ApplicationDetailView } from '../../../components/access/self-access/application-detail';
import { messages as m } from '../../../components/access/self-access/messages';
import { LoadError } from '../../../components/load-error';
import { Page, PageHead } from '../../../components/page';
import { signInRedirect } from '../../../components/sign-in-redirect';
import { getSelfAccessApplication } from '../../../server/self-access';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The crumb: the declarant's name, once known. */
function crumbOf(loaderData: unknown): string | null {
  if (typeof loaderData !== 'object' || loaderData === null || !('ok' in loaderData)) return null;
  if (!loaderData.ok || !('data' in loaderData)) return m.applicationTitle;
  const data = loaderData.data as { declarant?: { fullName?: string } };
  return data.declarant?.fullName ?? m.applicationTitle;
}

/**
 * One written self-access application (spec 10 slice #302). Another Commission's, or one that
 * does not exist, reads as not found.
 */
export const Route = createFileRoute('/access/certified-copies/$applicationId')({
  loader: async ({ params, location, context }) => {
    if (!context.workspace) return null;
    if (!UUID.test(params.applicationId)) throw notFound();
    const result = await getSelfAccessApplication({
      data: { applicationId: params.applicationId },
    });
    if (!result.ok && result.error.kind === 'unauthenticated') throw signInRedirect(location.href);
    if (!result.ok && result.error.kind === 'problem') {
      const { status } = result.error.problem;
      if (status === 404 || status === 403 || status === 400) throw notFound();
    }
    return result;
  },
  staticData: { crumb: ({ loaderData }) => crumbOf(loaderData) },
  head: ({ loaderData }) => ({
    meta: [{ title: `${crumbOf(loaderData) ?? m.title} · Adili Online Console` }],
  }),
  component: ApplicationRoute,
  notFoundComponent: () => (
    <Page narrow>
      <EmptyState
        icon={<Icon icon={Search01Icon} />}
        title={m.notFoundTitle}
        description={m.notFoundText}
        action={
          <Button asChild variant="secondary" size="sm">
            <Link to="/access/certified-copies">{m.backToCopies}</Link>
          </Button>
        }
      />
    </Page>
  ),
});

function ApplicationRoute() {
  const load = Route.useLoaderData();
  const { workspace, tenant } = Route.useRouteContext();
  if (!load || !workspace) return null;
  if (!load.ok) {
    return (
      <Page narrow>
        <PageHead title={m.applicationTitle} />
        <LoadError
          title={m.applicationErrorTitle}
          detail={m.applicationErrorDetail}
          retryLabel={m.tryAgain}
        />
      </Page>
    );
  }
  return (
    <ApplicationDetailView
      key={`${load.data.id}:${load.data.status}`}
      application={load.data}
      readOnly={workspace.readOnly}
      commissionCode={(tenant ?? load.data.certifiedCopy.commission.slug).toUpperCase()}
    />
  );
}
