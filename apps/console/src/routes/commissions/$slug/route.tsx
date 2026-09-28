import { Button, Card, EmptyState, Icon, Skeleton } from '@adili/ui';
import { Search01Icon } from '@hugeicons/core-free-icons';
import { createFileRoute, Link, Outlet } from '@tanstack/react-router';

import { messages as m } from '../../../components/commissions/messages';
import { LoadError } from '../../../components/load-error';
import { Page } from '../../../components/page';
import { signInRedirect } from '../../../components/sign-in-redirect';
import { getCommission } from '../../../server/commissions';
import type { DirectoryResult } from '../../../server/directory/client';

/** Hidden: the directory answers 404 for other tenants too, so the two read the same. */
function isHidden(result: DirectoryResult<unknown>): boolean {
  return (
    !result.ok &&
    result.error.kind === 'problem' &&
    (result.error.problem.status === 404 || result.error.problem.status === 403)
  );
}

/** The breadcrumb for a Commission match, from loader data the router only knows as `unknown`. */
function commissionCrumb(loaderData: unknown): string | null {
  if (loaderData === undefined) return m.loading;
  // No workspace: the layout says so under the workspace's title, as on the list.
  if (loaderData === null) return m.title;
  if (typeof loaderData !== 'object' || !('ok' in loaderData)) return null;
  if (!loaderData.ok) {
    return isHidden(loaderData as DirectoryResult<unknown>) ? m.notFoundCrumb : m.detailErrorTitle;
  }
  const commission = 'data' in loaderData ? loaderData.data : null;
  return typeof commission === 'object' &&
    commission !== null &&
    'name' in commission &&
    typeof commission.name === 'string'
    ? commission.name
    : null;
}

/**
 * One Commission: its detail page and, for platform admins, its roster records. Loads the
 * Commission once for all of them and shows not found or a failed load in their place.
 */
export const Route = createFileRoute('/commissions/$slug')({
  loader: async ({ params, location, context }) => {
    // The layout shows no Commission without the workspace; do not fetch one.
    if (!context.workspace) return null;
    const result = await getCommission({ data: { slug: params.slug } });
    if (!result.ok && result.error.kind === 'unauthenticated') throw signInRedirect(location.href);
    return result;
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: `${loaderData?.ok ? loaderData.data.name : m.title} · Adili Online Console`,
      },
    ],
  }),
  staticData: {
    crumb: ({ loaderData }) => commissionCrumb(loaderData),
  },
  pendingComponent: CommissionSkeleton,
  component: CommissionLayout,
});

function CommissionLayout() {
  const result = Route.useLoaderData();
  if (!result) return null;
  if (result.ok) return <Outlet />;
  if (isHidden(result)) {
    return (
      <Page narrow>
        <Card className="p-2 sm:p-2">
          <EmptyState
            icon={<Icon icon={Search01Icon} />}
            title={m.notFoundTitle}
            description={m.notFoundText}
            action={
              <Button asChild variant="secondary" size="sm">
                <Link to="/commissions">{m.backToCommissions}</Link>
              </Button>
            }
          />
        </Card>
      </Page>
    );
  }
  const { error } = result;
  return (
    <Page narrow>
      <LoadError
        title={m.detailErrorTitle}
        detail={(error.kind === 'unavailable' ? error.detail : null) ?? m.errorDetail}
        retryLabel={m.tryAgain}
      />
    </Page>
  );
}

function CommissionSkeleton() {
  return (
    <Page aria-busy="true" aria-label={m.title}>
      <div className="mb-[22px]">
        <Skeleton className="h-6 w-[320px] max-w-[80%]" />
        <Skeleton className="mt-3 w-[140px]" />
      </div>
      <div className="grid items-start gap-4 min-[980px]:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Card className="gap-3.5">
          {Array.from({ length: 7 }, (_, line) => (
            <Skeleton key={line} />
          ))}
        </Card>
        <Card className="gap-3.5">
          {Array.from({ length: 4 }, (_, line) => (
            <Skeleton key={line} className="w-[70%]" />
          ))}
        </Card>
      </div>
    </Page>
  );
}
