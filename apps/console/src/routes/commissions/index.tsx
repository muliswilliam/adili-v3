import { Alert, AlertDescription, AlertTitle, Button, EmptyState, Icon } from '@adili/ui';
import { AlertCircleIcon, Building03Icon, SearchRemoveIcon } from '@hugeicons/core-free-icons';
import { createFileRoute, Link, useRouter } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { type ReactNode, useState } from 'react';

import {
  CommissionsTable,
  CommissionsTableSkeleton,
} from '../../components/commissions/commissions-table';
import { CommissionsToolbar } from '../../components/commissions/commissions-toolbar';
import {
  type CommissionFilters,
  commissionFiltersSchema,
  hasFilters,
} from '../../components/commissions/filters';
import { messages } from '../../components/commissions/messages';
import { loginRedirect } from '../../components/login-redirect';
import { listCommissions } from '../../server/commissions';
import type { DirectoryFailure } from '../../server/directory/result';
import type { CommissionPage } from '../../server/directory/types';

export const Route = createFileRoute('/commissions/')({
  validateSearch: commissionFiltersSchema,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps, context, location }) => {
    if (!context.access) return null;
    const result = await listCommissions({ data: deps });
    if (!result.ok && result.failure.kind === 'unauthenticated') {
      throw loginRedirect(location.href);
    }
    return result;
  },
  pendingComponent: CommissionsListPending,
  component: CommissionsList,
});

function useSetFilters() {
  const navigate = Route.useNavigate();
  return (next: CommissionFilters) => {
    void navigate({ search: next, replace: true });
  };
}

function PageLayout({ count, children }: { count?: string; children: ReactNode }) {
  const filters = Route.useSearch();
  const setFilters = useSetFilters();
  return (
    <div className="grid gap-6">
      <div className="grid gap-1.5">
        <h1 className="text-lg font-semibold tracking-tight">{messages.title}</h1>
        {count ? <p className="text-muted-foreground">{count}</p> : null}
      </div>
      <CommissionsToolbar filters={filters} onChange={setFilters} />
      {children}
    </div>
  );
}

function CommissionsListPending() {
  return (
    <PageLayout>
      <CommissionsTableSkeleton />
    </PageLayout>
  );
}

function CommissionsList() {
  const result = Route.useLoaderData();
  const filters = Route.useSearch();

  // Pages fetched with "Load more", dropped whenever the filters change.
  const filtersKey = JSON.stringify(filters);
  const [more, setMore] = useState<{ key: string; pages: CommissionPage[] }>({
    key: filtersKey,
    pages: [],
  });
  const extraPages = more.key === filtersKey ? more.pages : [];
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const fetchPage = useServerFn(listCommissions);

  if (!result) return null;
  if (!result.ok) {
    return (
      <PageLayout>
        <LoadFailure failure={result.failure} />
      </PageLayout>
    );
  }

  const pages = [result.data, ...extraPages];
  const commissions = pages.flatMap((page) => page.items);
  const nextCursor = pages.at(-1)?.nextCursor ?? null;

  async function loadMore(cursor: string) {
    setLoadingMore(true);
    setLoadMoreFailed(false);
    const page = await fetchPage({ data: { ...filters, cursor } });
    setLoadingMore(false);
    if (page.ok) setMore({ key: filtersKey, pages: [...extraPages, page.data] });
    else setLoadMoreFailed(true);
  }

  if (commissions.length === 0) {
    return (
      <PageLayout count={messages.count(0, false)}>
        {hasFilters(filters) ? (
          <EmptyState
            icon={<Icon icon={SearchRemoveIcon} />}
            title={messages.noMatches.title}
            text={messages.noMatches.text}
            action={
              <Button asChild variant="secondary">
                <Link to="/commissions" search={{}}>
                  {messages.filters.clear}
                </Link>
              </Button>
            }
          />
        ) : (
          // "New Commission" joins this empty state with the create screen (#15).
          <EmptyState
            icon={<Icon icon={Building03Icon} />}
            title={messages.empty.title}
            text={messages.empty.text}
          />
        )}
      </PageLayout>
    );
  }

  return (
    <PageLayout count={messages.count(commissions.length, nextCursor !== null)}>
      <div className="rounded-xl border bg-card">
        <CommissionsTable commissions={commissions} />
      </div>
      {loadMoreFailed ? (
        <Alert variant="destructive">
          <Icon icon={AlertCircleIcon} />
          <AlertDescription>{messages.table.loadMoreFailed}</AlertDescription>
        </Alert>
      ) : null}
      {nextCursor ? (
        <div className="flex justify-center">
          <Button
            variant="secondary"
            disabled={loadingMore}
            onClick={() => {
              void loadMore(nextCursor);
            }}
          >
            {loadingMore ? messages.table.loadingMore : messages.table.loadMore}
          </Button>
        </div>
      ) : null}
    </PageLayout>
  );
}

function LoadFailure({ failure }: { failure: DirectoryFailure }) {
  const router = useRouter();
  if (failure.kind === 'forbidden') {
    return (
      <Alert variant="warning">
        <Icon icon={AlertCircleIcon} />
        <AlertDescription>{messages.forbidden}</AlertDescription>
      </Alert>
    );
  }
  const detail = 'problem' in failure ? failure.problem?.detail : undefined;
  return (
    <Alert variant="destructive">
      <Icon icon={AlertCircleIcon} />
      <AlertTitle>{messages.error.title}</AlertTitle>
      <AlertDescription className="grid justify-items-start gap-3">
        <p>{detail ?? messages.error.detailFallback}</p>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            void router.invalidate();
          }}
        >
          {messages.error.retry}
        </Button>
      </AlertDescription>
    </Alert>
  );
}
