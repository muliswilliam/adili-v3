import { Badge, Button, Card, EmptyState, Icon, Skeleton } from '@adili/ui';
import { Search01Icon } from '@hugeicons/core-free-icons';
import { createFileRoute, Link, notFound, useRouter } from '@tanstack/react-router';

import { ForbiddenAlert, LoadErrorAlert } from '../../components/commissions/alerts';
import { CommissionTypeBadge, ReadOnlyBadge } from '../../components/commissions/badges';
import { DetailsCard, RosterCard } from '../../components/commissions/commission-cards';
import { messages } from '../../components/commissions/messages';
import { loginRedirect } from '../../components/login-redirect';
import { Page, PageHead } from '../../components/page';
import { getCommission } from '../../server/commissions';

/** The breadcrumb for a detail match, from loader data the router only knows as `unknown`. */
function detailCrumb(loaderData: unknown): string | null {
  if (loaderData === undefined) return messages.detail.loading;
  if (typeof loaderData !== 'object' || loaderData === null || !('ok' in loaderData)) return null;
  if (!loaderData.ok) return messages.detail.loadError;
  const commission = 'data' in loaderData ? loaderData.data : null;
  return typeof commission === 'object' &&
    commission !== null &&
    'name' in commission &&
    typeof commission.name === 'string'
    ? commission.name
    : null;
}

export const Route = createFileRoute('/commissions/$slug')({
  loader: async ({ params, context, location }) => {
    // Users without the workspace get "No staff roles" from the layout.
    if (!context.access) return null;
    const result = await getCommission({ data: { slug: params.slug } });
    if (!result.ok && result.failure.kind === 'unauthenticated') {
      throw loginRedirect(location.href);
    }
    if (!result.ok && result.failure.kind === 'not-found') throw notFound();
    return result;
  },
  head: ({ loaderData }) => ({
    meta: loaderData?.ok ? [{ title: `${loaderData.data.name} · Adili Online Console` }] : [],
  }),
  staticData: {
    crumb: ({ status, loaderData }) =>
      status === 'notFound' ? messages.detail.notFoundCrumb : detailCrumb(loaderData),
  },
  pendingComponent: CommissionDetailPending,
  notFoundComponent: CommissionNotFound,
  component: CommissionDetail,
});

function CommissionDetail() {
  const result = Route.useLoaderData();
  const { access } = Route.useRouteContext();
  const router = useRouter();

  if (!result) return null;

  if (!result.ok) {
    return (
      <Page narrow>
        {result.failure.kind === 'forbidden' ? (
          <ForbiddenAlert />
        ) : (
          <LoadErrorAlert
            title={messages.detail.loadError}
            failure={result.failure}
            onRetry={() => {
              void router.invalidate();
            }}
          />
        )}
      </Page>
    );
  }

  const commission = result.data;
  return (
    <Page>
      <PageHead title={commission.name}>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge className="rounded-sm font-mono tracking-[0.04em]">{commission.issuerCode}</Badge>
          <CommissionTypeBadge type={commission.type} />
          {access === 'read' ? <ReadOnlyBadge /> : null}
        </div>
      </PageHead>
      {/* The right-hand column holds the reporting officer card (#18). */}
      <div className="grid items-start gap-4 min-[980px]:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <DetailsCard commission={commission} />
        <RosterCard className="min-[980px]:col-span-2" />
      </div>
    </Page>
  );
}

function CommissionDetailPending() {
  return (
    <Page aria-busy="true">
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

function CommissionNotFound() {
  const { access } = Route.useRouteContext();
  return (
    <Page narrow>
      <Card className="p-2 sm:p-2">
        <EmptyState
          icon={<Icon icon={Search01Icon} />}
          title={messages.detail.notFoundTitle}
          text={messages.detail.notFoundText}
          action={
            access ? (
              <Button asChild variant="secondary" size="sm">
                <Link to="/commissions">{messages.detail.back}</Link>
              </Button>
            ) : null
          }
        />
      </Card>
    </Page>
  );
}
