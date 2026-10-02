import { Button, EmptyState, Icon } from '@adili/ui';
import { Search01Icon } from '@hugeicons/core-free-icons';
import { createFileRoute, Link, notFound } from '@tanstack/react-router';

import { LoadError } from '../../components/load-error';
import { Page, PageHead } from '../../components/page';
import { ClarificationDetailView } from '../../components/review/clarification-detail';
import { signInRedirect } from '../../components/sign-in-redirect';
import { clarificationCrumb } from '../../clarification/view';
import { getClarificationDetail } from '../../server/clarifications';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A clarification on a review case, with its response and actions (spec 07a FE-4, S15). */
export const Route = createFileRoute('/review/cases/$caseId/clarifications/$clarificationId')({
  loader: async ({ params, location, context }) => {
    if (!context.workspace) return null;
    if (!UUID.test(params.caseId) || !UUID.test(params.clarificationId)) throw notFound();
    const result = await getClarificationDetail({
      data: { caseId: params.caseId, clarificationId: params.clarificationId },
    });
    if (!result.ok && result.error.kind === 'unauthenticated') throw signInRedirect(location.href);
    if (!result.ok && result.error.kind === 'problem') {
      // Another Commission's case or clarification reads as missing.
      const { status } = result.error.problem;
      if (status === 404 || status === 403) throw notFound();
    }
    return result;
  },
  staticData: { crumb: ({ loaderData }) => clarificationCrumb(loaderData) },
  head: () => ({ meta: [{ title: 'Clarification · Adili Online Console' }] }),
  component: ClarificationRoute,
  notFoundComponent: () => (
    <Page narrow>
      <EmptyState
        icon={<Icon icon={Search01Icon} />}
        title="Clarification not found"
        description="The link may be wrong, or the case belongs to another Commission."
        action={
          <Button asChild variant="secondary" size="sm">
            <Link to="/">Back to overview</Link>
          </Button>
        }
      />
    </Page>
  ),
});

function ClarificationRoute() {
  const load = Route.useLoaderData();
  const { supervisor } = Route.useRouteContext();
  if (!load) return null;
  if (!load.ok) {
    return (
      <Page narrow>
        <PageHead title="Clarification" />
        <LoadError
          title="We could not load this clarification"
          detail="The review service did not answer. Try again in a moment."
          retryLabel="Try again"
        />
      </Page>
    );
  }
  return (
    <ClarificationDetailView
      key={`${load.data.clarification.id}:${load.data.clarification.status}`}
      detail={load.data}
      now={load.now}
      supervisor={supervisor}
    />
  );
}
