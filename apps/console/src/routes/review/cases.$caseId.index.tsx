import { Button, EmptyState, Icon } from '@adili/ui';
import { Search01Icon } from '@hugeicons/core-free-icons';
import { createFileRoute, Link, notFound } from '@tanstack/react-router';

import { LoadError } from '../../components/load-error';
import { Page, PageHead } from '../../components/page';
import { CaseView } from '../../components/review/case/case-view';
import { CaseViewSkeleton } from '../../components/review/case/case-view-skeleton';
import { messages as t } from '../../components/review/case/messages';
import { signInRedirect } from '../../components/sign-in-redirect';
import { getCommission } from '../../server/commissions';
import { getCaseView } from '../../server/review-case';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The crumb: the case's reference, or "Case" while it cannot be named. */
function crumbOf(loaderData: unknown): string | null {
  if (typeof loaderData !== 'object' || loaderData === null || !('ok' in loaderData)) return null;
  if (!loaderData.ok || !('data' in loaderData)) return t.title;
  const data = loaderData.data as { detail?: { case?: { reference?: string } } };
  return data.detail?.case?.reference ?? t.title;
}

/**
 * A review case (spec 07a FE-3): every load is a read of the declaration, audited by the
 * services. Another Commission's case, and any case for a role outside review, reads as missing.
 */
export const Route = createFileRoute('/review/cases/$caseId/')({
  loader: async ({ params, location, context }) => {
    // A case is missing to anyone outside review (S18); the layout explains a failed access read.
    if (!context.viewer.directory.ok) return null;
    if (!context.workspace) throw notFound();
    if (!UUID.test(params.caseId)) throw notFound();
    const { tenant } = context.viewer.directory.principal;
    const [result, commission] = await Promise.all([
      getCaseView({ data: { caseId: params.caseId } }),
      // The clarification letter's letterhead; the issuer code stands in when the directory
      // does not answer.
      tenant ? getCommission({ data: { slug: tenant } }).catch(() => null) : null,
    ]);
    if (!result.ok && result.error.kind === 'unauthenticated') throw signInRedirect(location.href);
    if (!result.ok && result.error.kind === 'problem') {
      const { status } = result.error.problem;
      if (status === 404 || status === 403) throw notFound();
    }
    const letterhead = {
      name: commission?.ok ? commission.data.name : (tenant ?? '').toUpperCase(),
      issuerCode: commission?.ok ? commission.data.issuerCode : (tenant ?? '').toUpperCase(),
    };
    return { ...result, commission: letterhead };
  },
  staticData: { crumb: ({ loaderData }) => crumbOf(loaderData) },
  head: ({ loaderData }) => {
    const reference = loaderData?.ok ? loaderData.data.detail.case.reference : null;
    return {
      meta: [{ title: `${reference ?? 'Review case'} · Adili Online Console` }],
    };
  },
  component: CaseRoute,
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

function CaseRoute() {
  const load = Route.useLoaderData();
  const { viewer, supervisor } = Route.useRouteContext();
  if (!load) return null;
  if (!load.ok) {
    return (
      <Page narrow>
        <PageHead title={t.title} />
        <LoadError
          title={t.loadFailed.title}
          detail={t.loadFailed.body}
          retryLabel={t.loadFailed.retry}
        />
      </Page>
    );
  }
  return (
    <CaseView
      key={load.data.detail.case.id}
      load={load.data}
      now={load.now}
      supervisor={supervisor}
      slug={viewer.directory.ok ? viewer.directory.principal.tenant : null}
      commission={load.commission}
    />
  );
}
