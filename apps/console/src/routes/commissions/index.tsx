import { Badge, Button, Card, EmptyState, Input, Select, Skeleton } from '@adili/ui';
import { createFileRoute, useNavigate, useRouterState } from '@tanstack/react-router';
import { Building2, Eye, Search, SearchX, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  CommissionsTable,
  CommissionsTableSkeleton,
} from '../../components/commissions/commissions-table';
import {
  type CommissionListSearch,
  commissionListSearch,
  hasFilters,
  SEARCH_DEBOUNCE_MS,
} from '../../components/commissions/list-search';
import { messages as m } from '../../components/commissions/messages';
import { LoadError, NoAccess } from '../../components/load-error';
import { signInRedirect } from '../../components/sign-in-redirect';
import { workspaceFor } from '../../components/workspaces';
import { listCommissions } from '../../server/commissions';
import type { Commission, CommissionPage, DirectoryResult } from '../../server/directory/client';

export const Route = createFileRoute('/commissions/')({
  validateSearch: commissionListSearch,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps, location }) => {
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
  const { viewer } = Route.useRouteContext();
  const roles = viewer.directory.ok ? viewer.directory.principal.roles : [];
  const readOnly = workspaceFor(roles, 'commissions')?.readOnly ?? true;
  // Filter changes keep this page mounted (and the search box focused) while the loader runs;
  // the toolbar shows the filters being loaded rather than the previous ones.
  const pending = useRouterState({
    select: (state) =>
      state.status === 'pending' && state.location.pathname === '/commissions'
        ? state.location.search
        : null,
  });
  const refetching = pending !== null;
  const search = pending ? commissionListSearch.parse(pending) : committed;
  const loading = result === null || refetching;
  const forbidden = result?.ok === false && isForbidden(result);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{m.title}</h1>
          <p className="h-5 text-sm text-muted-foreground" aria-live="polite">
            {loading ? (
              <Skeleton className="mt-0.5 w-28" />
            ) : result.ok ? (
              hasFilters(search) ? (
                m.matches(result.data.total)
              ) : (
                m.count(result.data.total)
              )
            ) : null}
          </p>
        </div>
        {readOnly ? (
          <Badge variant="neutral">
            <Eye aria-hidden="true" />
            {m.readOnly}
          </Badge>
        ) : null}
      </div>
      <Card className="overflow-hidden">
        <Toolbar search={search} disabled={forbidden} />
        {loading ? <CommissionsTableSkeleton /> : <Results result={result} search={search} />}
      </Card>
    </div>
  );
}

function isForbidden(result: DirectoryResult<unknown>): boolean {
  return !result.ok && result.error.kind === 'problem' && result.error.problem.status === 403;
}

function Toolbar({ search, disabled }: { search: CommissionListSearch; disabled: boolean }) {
  const navigate = useNavigate({ from: '/commissions/' });
  const setFilter = (patch: Partial<CommissionListSearch>) => {
    void navigate({ search: (previous) => ({ ...previous, ...patch }) });
  };

  return (
    <div role="search" className="flex flex-wrap items-center gap-3 border-b bg-card p-4">
      <SearchBox
        applied={search.search ?? ''}
        disabled={disabled}
        onSearch={(value) => {
          void navigate({
            search: (previous) => ({ ...previous, search: value || undefined }),
            replace: true,
          });
        }}
      />
      <Select
        aria-label={m.typeLabel}
        value={search.type ?? ''}
        disabled={disabled}
        onChange={(event) => {
          setFilter({ type: (event.target.value || undefined) as CommissionListSearch['type'] });
        }}
        className="sm:w-40"
      >
        <option value="">{m.typeAll}</option>
        <option value="hosted">{m.typeHosted}</option>
        <option value="federated">{m.typeFederated}</option>
      </Select>
      <Select
        aria-label={m.officerLabel}
        value={search.reportingOfficer ?? ''}
        disabled={disabled}
        onChange={(event) => {
          setFilter({
            reportingOfficer: (event.target.value ||
              undefined) as CommissionListSearch['reportingOfficer'],
          });
        }}
        className="sm:w-56"
      >
        <option value="">{m.officerAny}</option>
        <option value="none">{m.officerNone}</option>
        <option value="invited">{m.officerInvited}</option>
        <option value="activated">{m.officerActivated}</option>
      </Select>
      {hasFilters(search) ? (
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            void navigate({ search: {} });
          }}
        >
          <X aria-hidden="true" />
          {m.clear}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Search input that applies its text 300 ms after the last keystroke, or at once on Enter or
 * blur. Follows `applied` (the URL) when that changes from elsewhere, e.g. "Clear filters".
 */
function SearchBox({
  applied,
  disabled,
  onSearch,
}: {
  applied: string;
  disabled: boolean;
  onSearch: (value: string) => void;
}) {
  const [text, setText] = useState(applied);
  const [seen, setSeen] = useState(applied);
  if (applied !== seen) {
    setSeen(applied);
    if (applied !== text.trim()) setText(applied);
  }

  const apply = (value: string) => {
    if (value.trim() !== applied) onSearch(value.trim());
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      apply(text);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
    // Restart the timer on keystrokes only; `apply` changes with every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return (
    <form
      className="relative w-full sm:w-auto sm:min-w-60 sm:flex-1"
      onSubmit={(event) => {
        event.preventDefault();
        apply(text);
      }}
    >
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        type="search"
        aria-label={m.searchLabel}
        placeholder={m.searchPlaceholder}
        value={text}
        maxLength={100}
        disabled={disabled}
        onChange={(event) => {
          setText(event.target.value);
        }}
        onBlur={() => {
          apply(text);
        }}
        className="pl-9"
      />
    </form>
  );
}

function Results({
  result,
  search,
}: {
  result: DirectoryResult<CommissionPage>;
  search: CommissionListSearch;
}) {
  const navigate = useNavigate({ from: '/commissions/' });
  if (!result.ok) {
    const { error } = result;
    if (isForbidden(result)) {
      return (
        <div className="p-4">
          <NoAccess text={m.forbidden} />
        </div>
      );
    }
    const detail =
      (error.kind === 'unavailable' ? error.detail : null) ??
      (error.kind === 'problem' ? error.problem.detail : undefined) ??
      m.errorDetail;
    return (
      <div className="p-4">
        <LoadError title={m.errorTitle} detail={detail} retryLabel={m.tryAgain} />
      </div>
    );
  }
  if (result.data.items.length === 0) {
    return hasFilters(search) ? (
      <EmptyState
        icon={<SearchX />}
        title={m.noMatchesTitle}
        text={m.noMatchesText}
        action={
          <Button
            variant="outline"
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
      <EmptyState icon={<Building2 />} title={m.emptyTitle} text={m.emptyText} />
    );
  }
  // Keyed by the filters so "Load more" state resets when they change.
  return <Pages key={JSON.stringify(search)} first={result.data} search={search} />;
}

/** The first page plus any pages appended with "Load more". */
function Pages({ first, search }: { first: CommissionPage; search: CommissionListSearch }) {
  const [more, setMore] = useState<{ items: Commission[]; nextCursor: string | null }>({
    items: [],
    nextCursor: first.nextCursor,
  });
  const [state, setState] = useState<'idle' | 'loading' | 'failed'>('idle');
  const items = [...first.items, ...more.items];

  const loadMore = async () => {
    if (!more.nextCursor) return;
    setState('loading');
    const result = await listCommissions({ data: { ...search, cursor: more.nextCursor } });
    if (!result.ok) {
      setState('failed');
      return;
    }
    setMore((previous) => ({
      items: [...previous.items, ...result.data.items],
      nextCursor: result.data.nextCursor,
    }));
    setState('idle');
  };

  return (
    <>
      <CommissionsTable items={items} />
      {/* When one page holds everything, the header count says it all. */}
      {first.nextCursor === null ? null : (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {state === 'failed' ? m.loadMoreFailed : m.showing(items.length, first.total)}
          </p>
          {more.nextCursor ? (
            <Button
              variant="outline"
              size="sm"
              disabled={state === 'loading'}
              onClick={() => {
                void loadMore();
              }}
            >
              {state === 'loading' ? m.loadingMore : m.loadMore}
            </Button>
          ) : null}
        </div>
      )}
    </>
  );
}
