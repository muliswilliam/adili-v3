import { Button, EmptyState, Icon } from '@adili/ui';
import { Search01Icon } from '@hugeicons/core-free-icons';
import { createFileRoute, Link, notFound } from '@tanstack/react-router';

import { LoadError } from '../../components/load-error';
import { Page, PageHead } from '../../components/page';
import { CaseSkeleton } from '../../components/review/case/case-skeleton';
import { CaseView } from '../../components/review/case/case-view';
import { signInRedirect } from '../../components/sign-in-redirect';
import { CASE_COPY } from '../../review-case/messages';
import { caseSearch } from '../../review-case/tabs';
import { getCaseView } from '../../server/review-case';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The crumb: the case's reference, or nothing while it cannot be named. */
function crumbOf(loaderData: unknown): string | null {
  if (typeof loaderData !== 'object' || loaderData === null || !('ok' in loaderData)) return null;
  if (!loaderData.ok || !('data' in loaderData)) return CASE_COPY.title;
  const data = loaderData.data as { detail?: { case?: { reference?: string } } };
  return data.detail?.case?.reference ?? CASE_COPY.title;
}

/** A review case: the declaration as filed beside its flags, notes and timeline (spec 07a FE-3). */
export const Route = createFileRoute('/review/cases/$caseId/')({
  validateSearch: caseSearch,
  // Each read of the case is an audited view of the declaration: switching tabs (the search)
  // does not read it again. Coming to the case, Try again and every action (invalidate) do.
  shouldReload: ({ cause }) => cause !== 'stay',
  loader: async ({ params, location, context }) => {
    if (!context.workspace) return null;
    if (!UUID.test(params.caseId)) throw notFound();
    const result = await getCaseView({ data: { caseId: params.caseId } });
    if (!result.ok && result.error.kind === 'unauthenticated') throw signInRedirect(location.href);
    // Another Commission's case reads as missing, as does one that is not there.
    if (!result.ok && result.error.kind === 'problem') {
      const { status } = result.error.problem;
      if (status === 404 || status === 403) throw notFound();
    }
    return result;
  },
  staticData: { crumb: ({ loaderData }) => crumbOf(loaderData) },
  head: () => ({ meta: [{ title: `${CASE_COPY.title} · Adili Online Console` }] }),
  pendingComponent: CaseSkeleton,
  component: CaseRoute,
  notFoundComponent: () => (
    <Page narrow>
      <EmptyState
        icon={<Icon icon={Search01Icon} />}
        title={CASE_COPY.notFoundTitle}
        description={CASE_COPY.notFoundBody}
        action={
          <Button asChild variant="secondary" size="sm">
            <Link to="/">{CASE_COPY.backToOverview}</Link>
          </Button>
        }
      />
    </Page>
  ),
});

function CaseRoute() {
  const load = Route.useLoaderData();
  const { tab = 'flags' } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { viewer, supervisor } = Route.useRouteContext();
  if (!load) return null;
  if (!load.ok || !load.subject) {
    return (
      <Page narrow>
        <PageHead title={CASE_COPY.title} />
        <LoadError
          title={CASE_COPY.loadFailedTitle}
          detail={CASE_COPY.loadFailedBody}
          retryLabel={CASE_COPY.retry}
        />
      </Page>
    );
  }
  const slug = viewer.directory.ok ? viewer.directory.principal.tenant : null;
  return (
    <CaseView
      // Another case is another view: its registry reads, polls and dialogs start afresh.
      key={load.data.detail.case.id}
      load={load.data}
      viewer={{ subject: load.subject, name: viewer.user.name, supervisor }}
      slug={slug}
      now={Date.parse(load.now)}
      tab={tab}
      onTab={(next) => {
        void navigate({
          search: (prev) => ({ ...prev, tab: next === 'flags' ? undefined : next }),
        });
      }}
    />
  );
}
