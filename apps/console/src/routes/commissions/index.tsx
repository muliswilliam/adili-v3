import { Button, Card, EmptyState, Icon, Select, SelectItem, Skeleton } from '@adili/ui';
import { Add01Icon, Building03Icon, Cancel01Icon, Search01Icon } from '@hugeicons/core-free-icons';
import {
  createFileRoute,
  Link,
  useLocation,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router';
import { useId } from 'react';

import { ReadOnlyBadge } from '../../components/commissions/badges';
import { CommissionsPager } from '../../components/commissions/commissions-pager';
import {
  CommissionsResults,
  CommissionsTableSkeleton,
} from '../../components/commissions/commissions-table';
import {
  type CommissionFilters,
  type CommissionListSearch,
  commissionListSearch,
  filtersOf,
  hasFilters,
} from '../../components/commissions/list-search';
import { messages as m } from '../../components/commissions/messages';
import {
  nextPage,
  type PageLocation,
  type PagingState,
  pagingFor,
  pagingView,
  previousPage,
} from '../../components/commissions/paging';
import { LoadError, NoAccess } from '../../components/load-error';
import { Page, PageHead } from '../../components/page';
import { SearchBox } from '../../components/search-box';
import { signInRedirect } from '../../components/sign-in-redirect';
import { listCommissions } from '../../server/commissions';
import type { CommissionPage, DirectoryResult } from '../../server/directory/client';

declare module '@tanstack/react-router' {
  interface HistoryState {
    /** The way back from a later page of the Commissions list (see `paging.ts`). */
    commissionsPaging?: PagingState;
  }
}

/** Radix Select items cannot have an empty value, so "any" is this sentinel. */
const ANY = 'any';

export const Route = createFileRoute('/commissions/')({
  validateSearch: commissionListSearch,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps, location, context }) => {
    // The layout shows no list without the workspace; do not fetch one.
    if (!context.workspace) return null;
    const result = await listCommissions({ data: deps });
    if (!result.ok && result.error.kind === 'unauthenticated') throw signInRedirect(location.href);
    return result;
  },
  head: () => ({ meta: [{ title: `${m.title} · Adili Online Console` }] }),
  pendingComponent: CommissionsLoading,
  component: CommissionsLoaded,
});

function CommissionsLoading() {
  return <CommissionsPage result={null} />;
}

function CommissionsLoaded() {
  return <CommissionsPage result={Route.useLoaderData()} />;
}

/** The list page; `result` is null while the first page loads. */
function CommissionsPage({ result }: { result: DirectoryResult<CommissionPage> | null }) {
  const committed = Route.useSearch();
  const { workspace } = Route.useRouteContext();
  const readOnly = workspace?.readOnly ?? true;
  // Filter and page changes keep this page mounted (and the search box focused) while the
  // loader runs; the toolbar shows the filters being loaded rather than the previous ones.
  const pending = useRouterState({
    select: (state) =>
      state.status === 'pending' && state.location.pathname === '/commissions'
        ? state.location.search
        : null,
  });
  const search = pending ? commissionListSearch.parse(pending) : committed;
  const loading = result === null || pending !== null;
  const forbidden = result?.ok === false && isForbidden(result);

  return (
    <Page>
      <PageHead
        title={m.title}
        actions={readOnly ? <ReadOnlyBadge /> : forbidden ? null : <NewCommissionButton />}
      >
        <p className="mt-1 h-[21px] text-sm text-muted-foreground" aria-live="polite">
          {loading ? (
            <Skeleton className="my-1 inline-block w-[110px] align-middle" />
          ) : result.ok ? (
            hasFilters(search) ? (
              m.matches(result.data.total)
            ) : (
              m.count(result.data.total)
            )
          ) : null}
        </p>
      </PageHead>
      <Card className="overflow-hidden p-0 sm:p-0">
        <Toolbar search={search} disabled={forbidden} />
        {loading ? (
          <CommissionsTableSkeleton />
        ) : (
          <Results result={result} search={search} readOnly={readOnly} />
        )}
      </Card>
    </Page>
  );
}

function NewCommissionButton({ size }: { size?: 'sm' }) {
  return (
    <Button asChild size={size}>
      <Link to="/commissions/new">
        <Icon icon={Add01Icon} />
        {m.newCommission}
      </Link>
    </Button>
  );
}

function isForbidden(result: DirectoryResult<unknown>): boolean {
  return !result.ok && result.error.kind === 'problem' && result.error.problem.status === 403;
}

/**
 * One row at the top of the list card: search (debounced, or on Enter or blur), type and
 * reporting-officer filters with visually hidden labels, and Clear while any filter is set.
 */
function Toolbar({ search, disabled }: { search: CommissionListSearch; disabled: boolean }) {
  const id = useId();
  const navigate = useNavigate({ from: '/commissions/' });
  // A filter change starts again from the first page: the cursor belongs to the old results.
  const setFilters = (patch: CommissionFilters, replace = false) => {
    void navigate({ search: { ...filtersOf(search), ...patch }, replace });
  };

  return (
    <div role="search" className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
      <SearchBox
        id={`${id}-search`}
        label={m.searchLabel}
        placeholder={m.searchPlaceholder}
        maxLength={100}
        applied={search.search ?? ''}
        disabled={disabled}
        onSearch={(value) => {
          setFilters({ search: value || undefined }, true);
        }}
      />
      <label htmlFor={`${id}-type`} className="sr-only">
        {m.typeLabel}
      </label>
      <Select
        id={`${id}-type`}
        value={search.type ?? ANY}
        disabled={disabled}
        className="h-9 w-auto min-w-[116px] text-sm"
        onValueChange={(value) => {
          setFilters({ type: value === 'hosted' || value === 'federated' ? value : undefined });
        }}
      >
        <SelectItem value={ANY}>{m.typeAll}</SelectItem>
        <SelectItem value="hosted">{m.typeHosted}</SelectItem>
        <SelectItem value="federated">{m.typeFederated}</SelectItem>
      </Select>
      <label htmlFor={`${id}-officer`} className="sr-only">
        {m.officerLabel}
      </label>
      <Select
        id={`${id}-officer`}
        value={search.reportingOfficer ?? ANY}
        disabled={disabled}
        className="h-9 w-auto min-w-[186px] text-sm"
        onValueChange={(value) => {
          setFilters({
            reportingOfficer:
              value === 'none' || value === 'invited' || value === 'activated' ? value : undefined,
          });
        }}
      >
        <SelectItem value={ANY}>{m.officerAny}</SelectItem>
        <SelectItem value="none">{m.officerNone}</SelectItem>
        <SelectItem value="invited">{m.officerInvited}</SelectItem>
        <SelectItem value="activated">{m.officerActivated}</SelectItem>
      </Select>
      {hasFilters(search) ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            void navigate({ search: {} });
          }}
        >
          <Icon icon={Cancel01Icon} />
          {m.clear}
        </Button>
      ) : null}
    </div>
  );
}

function Results({
  result,
  search,
  readOnly,
}: {
  result: DirectoryResult<CommissionPage>;
  search: CommissionListSearch;
  readOnly: boolean;
}) {
  const navigate = useNavigate({ from: '/commissions/' });
  const pagingState = useLocation({ select: (location) => location.state.commissionsPaging });

  if (!result.ok) {
    const { error } = result;
    if (isForbidden(result)) {
      return (
        <div className="p-5">
          <NoAccess text={m.forbidden} />
        </div>
      );
    }
    const detail =
      (error.kind === 'unavailable' ? error.detail : null) ??
      (error.kind === 'problem' ? error.problem.detail : undefined) ??
      m.errorDetail;
    return (
      <div className="p-5">
        <LoadError title={m.errorTitle} detail={detail} retryLabel={m.tryAgain} />
      </div>
    );
  }
  if (result.data.items.length === 0) {
    return hasFilters(search) ? (
      <EmptyState
        icon={<Icon icon={Search01Icon} />}
        title={m.noMatchesTitle}
        description={m.noMatchesText}
        action={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void navigate({ search: {} });
            }}
          >
            {m.clearFilters}
          </Button>
        }
      />
    ) : (
      <EmptyState
        icon={<Icon icon={Building03Icon} />}
        title={m.emptyTitle}
        description={m.emptyText}
        action={readOnly ? undefined : <NewCommissionButton size="sm" />}
      />
    );
  }

  const paging = pagingFor(search.cursor, pagingState);
  const view = pagingView(result.data, paging);
  const next = nextPage(search, result.data, paging);
  const go = ({ search: to, state }: PageLocation) => {
    void navigate({ search: to, state: { commissionsPaging: state } });
  };
  return (
    <>
      <CommissionsResults items={result.data.items} />
      <CommissionsPager
        range={view.range}
        rows={result.data.items.length}
        hasPrevious={view.hasPrevious}
        hasNext={next !== null}
        onPrevious={() => {
          go(previousPage(search, paging));
        }}
        onNext={() => {
          if (next) go(next);
        }}
      />
    </>
  );
}
