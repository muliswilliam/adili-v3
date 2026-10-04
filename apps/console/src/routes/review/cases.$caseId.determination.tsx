import { Button, EmptyState, Icon } from '@adili/ui';
import { Search01Icon } from '@hugeicons/core-free-icons';
import { createFileRoute, Link, notFound } from '@tanstack/react-router';

import { DeterminationPage } from '../../components/determination/determination-page';
import { messages as t } from '../../components/determination/messages';
import { LoadError } from '../../components/load-error';
import { Page, PageHead } from '../../components/page';
import type { CrumbTrail } from '../../components/shell/breadcrumbs';
import { CaseViewSkeleton } from '../../components/review/case/case-view-skeleton';
import { signInRedirect } from '../../components/sign-in-redirect';
import { getCaseView } from '../../server/review-case';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** "Determination", after a link to the case by its reference once the case is loaded. */
function determinationCrumb(loaderData: unknown): CrumbTrail | string | null {
  if (typeof loaderData !== 'object' || loaderData === null || !('ok' in loaderData)) return null;
  if (!loaderData.ok || !('data' in loaderData)) return t.crumb;
  const data = loaderData.data as { detail?: { case?: { id?: string; reference?: string } } };
  const { id, reference } = data.detail?.case ?? {};
  return id && reference
    ? { before: [{ label: reference, to: `/review/cases/${id}` }], label: t.crumb }
    : t.crumb;
}

/**
 * A review case's compliance determination (spec 08 FE-2; S1, S2): propose, withdraw, revise a
 * returned proposal, and the approved decision with its letter. The case is read as on its own
 * page (an audited read of the declaration); another Commission's case reads as missing.
 */
export const Route = createFileRoute('/review/cases/$caseId/determination')({
  loader: async ({ params, location, context }) => {
    if (!context.viewer.directory.ok) return null;
    if (!context.workspace) throw notFound();
    if (!UUID.test(params.caseId)) throw notFound();
    const result = await getCaseView({ data: { caseId: params.caseId } });
    if (!result.ok && result.error.kind === 'unauthenticated') throw signInRedirect(location.href);
    if (!result.ok && result.error.kind === 'problem') {
      const { status } = result.error.problem;
      if (status === 404 || status === 403) throw notFound();
    }
    return result;
  },
  staticData: { crumb: ({ loaderData }) => determinationCrumb(loaderData) },
  head: ({ loaderData }) => {
    const reference = loaderData?.ok ? loaderData.data.detail.case.reference : null;
    return {
      meta: [{ title: `Determination · ${reference ?? 'Review case'} · Adili Online Console` }],
    };
  },
  component: DeterminationRoute,
  pendingComponent: CaseViewSkeleton,
  notFoundComponent: () => (
    <Page narrow>
      <EmptyState
        icon={<Icon icon={Search01Icon} />}
        title={t.notFound.title}
        description={t.notFound.body}
        action={
          <Button asChild variant="secondary" size="sm">
            <Link to="/">{t.notFound.back}</Link>
          </Button>
        }
      />
    </Page>
  ),
});

function DeterminationRoute() {
  const load = Route.useLoaderData();
  const { supervisor } = Route.useRouteContext();
  if (!load) return null;
  if (!load.ok) {
    return (
      <Page narrow>
        <PageHead title={t.crumb} />
        <LoadError
          title={t.loadFailed.title}
          detail={t.loadFailed.body}
          retryLabel={t.loadFailed.retry}
        />
      </Page>
    );
  }
  return (
    <DeterminationPage
      key={`${load.data.detail.case.id}:${String(load.data.detail.determinations.length)}`}
      load={load.data}
      supervisor={supervisor}
    />
  );
}
