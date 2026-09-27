import { Alert, AlertDescription, AlertTitle, Button, EmptyState, Icon, Skeleton } from '@adili/ui';
import {
  AlertCircleIcon,
  Building03Icon,
  RefreshIcon,
  Search01Icon,
  SquareLock02Icon,
} from '@hugeicons/core-free-icons';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { type ReactNode, useState } from 'react';

import { ReadOnlyBadge } from '../../components/commissions/badges';
import { CommissionsPager } from '../../components/commissions/commissions-pager';
import {
  CommissionsResults,
  CommissionsTableSkeleton,
} from '../../components/commissions/commissions-table';
import { CommissionsToolbar } from '../../components/commissions/commissions-toolbar';
import {
  type CommissionFilters,
  commissionFiltersSchema,
  hasFilters,
} from '../../components/commissions/filters';
import { messages } from '../../components/commissions/messages';
import { pagingView } from '../../components/commissions/paging';
import { loginRedirect } from '../../components/login-redirect';
import { Page, PageHead } from '../../components/page';
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

/** The page head and the list card, with the toolbar at the top of the card. */
function ListLayout({
  count,
  disabled,
  children,
}: {
  /** The count line; `null` keeps its space empty, `undefined` shows it loading. */
  count?: string | null;
  disabled?: boolean;
  children: ReactNode;
}) {
  const filters = Route.useSearch();
  const { access } = Route.useRouteContext();
  const navigate = Route.useNavigate();
  return (
    <Page>
      <PageHead title={messages.title} actions={access === 'read' ? <ReadOnlyBadge /> : null}>
        <div className="mt-1 text-sm text-muted-foreground">
          {count === undefined ? (
            <Skeleton className="my-1 inline-block w-[110px] align-middle" />
          ) : (
            (count ?? ' ')
          )}
        </div>
      </PageHead>
      <div className="rounded-2xl bg-card text-card-foreground shadow-card">
        <CommissionsToolbar
          filters={filters}
          disabled={disabled}
          onChange={(next: CommissionFilters) => {
            void navigate({ search: next, replace: true });
          }}
        />
        {children}
      </div>
    </Page>
  );
}

function CommissionsListPending() {
  return (
    <ListLayout>
      <CommissionsTableSkeleton />
    </ListLayout>
  );
}

function CommissionsList() {
  const result = Route.useLoaderData();
  const filters = Route.useSearch();

  // Staff outside the workspace (the directory would show them their own Commission only).
  if (!result) {
    return (
      <Page narrow>
        <PageHead title={messages.title} />
        <Alert role="status">
          <Icon icon={SquareLock02Icon} />
          <AlertTitle>{messages.forbidden}</AlertTitle>
        </Alert>
      </Page>
    );
  }

  if (!result.ok) {
    return (
      <ListLayout count={null} disabled={result.failure.kind === 'forbidden'}>
        <LoadFailure failure={result.failure} />
      </ListLayout>
    );
  }

  return <CommissionsPages first={result.data} filters={filters} />;
}

/**
 * The fetched pages and the one on show. The loader brings the first page; Next fetches the page
 * after with its cursor and Previous steps back through the pages already fetched.
 */
function CommissionsPages({
  first,
  filters,
}: {
  first: CommissionPage;
  filters: CommissionFilters;
}) {
  const [paging, setPaging] = useState({ first, more: [] as CommissionPage[], index: 0 });
  // New filters, or a reload, bring a new first page; paging starts over from it.
  const current = paging.first === first ? paging : { first, more: [], index: 0 };
  const [loadingNext, setLoadingNext] = useState(false);
  const [pageFailed, setPageFailed] = useState(false);
  const fetchPage = useServerFn(listCommissions);

  const pages = [first, ...current.more];
  const view = pagingView(pages, current.index);
  const count = messages.count(view.seen, { filtered: hasFilters(filters), more: view.more });

  async function next() {
    setPageFailed(false);
    if (current.index + 1 < pages.length) {
      setPaging({ ...current, index: current.index + 1 });
      return;
    }
    const cursor = view.page.nextCursor;
    if (!cursor) return;
    setLoadingNext(true);
    const result = await fetchPage({ data: { ...filters, cursor } });
    setLoadingNext(false);
    if (result.ok) {
      setPaging({ first, more: [...current.more, result.data], index: current.index + 1 });
    } else {
      setPageFailed(true);
    }
  }

  if (view.page.items.length === 0) {
    return (
      <ListLayout count={count}>
        {hasFilters(filters) ? <NoMatches /> : <NoCommissions />}
      </ListLayout>
    );
  }

  return (
    <ListLayout count={count}>
      <div aria-busy={loadingNext || undefined}>
        <CommissionsResults commissions={view.page.items} />
      </div>
      {pageFailed ? (
        <div className="border-t px-4 py-3">
          <Alert variant="destructive">
            <Icon icon={AlertCircleIcon} />
            <AlertDescription>{messages.table.pageFailed}</AlertDescription>
          </Alert>
        </div>
      ) : null}
      <CommissionsPager
        from={view.from}
        to={view.to}
        hasPrevious={view.hasPrevious}
        hasNext={view.hasNext}
        busy={loadingNext}
        onPrevious={() => {
          setPageFailed(false);
          setPaging({ ...current, index: current.index - 1 });
        }}
        onNext={() => {
          void next();
        }}
      />
    </ListLayout>
  );
}

function NoMatches() {
  const navigate = Route.useNavigate();
  return (
    <EmptyState
      icon={<Icon icon={Search01Icon} />}
      title={messages.noMatches.title}
      text={messages.noMatches.text}
      action={
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            void navigate({ search: {}, replace: true });
          }}
        >
          {messages.filters.clearAll}
        </Button>
      }
    />
  );
}

/** "New Commission" joins this empty state with the create screen (#15). */
function NoCommissions() {
  return (
    <EmptyState
      icon={<Icon icon={Building03Icon} />}
      title={messages.empty.title}
      text={messages.empty.text}
    />
  );
}

function LoadFailure({ failure }: { failure: DirectoryFailure }) {
  const router = useRouter();
  if (failure.kind === 'forbidden') {
    return (
      <div className="p-5">
        <Alert role="status">
          <Icon icon={SquareLock02Icon} />
          <AlertTitle>{messages.forbidden}</AlertTitle>
        </Alert>
      </div>
    );
  }
  return (
    <div className="p-5">
      <Alert variant="destructive">
        <Icon icon={AlertCircleIcon} />
        <AlertTitle>{messages.error.title}</AlertTitle>
        <AlertDescription className="grid justify-items-start gap-2.5">
          <p>{messages.error.text}</p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void router.invalidate();
            }}
          >
            <Icon icon={RefreshIcon} />
            {messages.error.retry}
          </Button>
        </AlertDescription>
      </Alert>
    </div>
  );
}
