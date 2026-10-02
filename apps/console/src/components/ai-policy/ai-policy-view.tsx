import {
  AI_PROVIDER_NAMES,
  Button,
  Card,
  EmptyState,
  FilterChip,
  Icon,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableRowLink,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  UsageMeter,
} from '@adili/ui';
import {
  Add01Icon,
  ArrowRight01Icon,
  Building03Icon,
  Search01Icon,
} from '@hugeicons/core-free-icons';
import { type ReactNode, useId, useState } from 'react';

import type { DataClass } from '../../server/ai-gateway/types';
import type {
  AiPolicyOverview,
  AiTenantRow,
  RouteRow as Route,
} from '../../server/ai-policy.server';
import type { ServiceResult } from '../../server/service-call';
import { CursorPager } from '../cursor-pager';
import { LoadError, NoAccess } from '../load-error';
import { Page, PageHead } from '../page';
import { SearchBox } from '../search-box';
import { BudgetDialog, type SaveBudget } from './budget-dialog';
import { CommissionDrawer } from './commission-drawer';
import { GateDialog, type SaveGate } from './gate-dialog';
import { messages as m } from './messages';
import { DataClassesTip, GateCell } from './parts';
import { type RemoveRoute, RouteDialog, type SaveRoute } from './route-dialog';
import {
  AI_FILTERS,
  type AiFilter,
  type AiPolicySearch,
  DATA_CLASSES,
  filterCounts,
  filterRows,
  isEnabled,
  pageOf,
  routeParams,
  searchRows,
  shortMonth,
  usageMonth,
} from './model';

export interface AiPolicyViewProps {
  /** The page's read; null while it loads. */
  result: ServiceResult<AiPolicyOverview> | null;
  search: AiPolicySearch;
  onSearchChange: (next: AiPolicySearch) => void;
  saveGate: SaveGate;
  saveBudget: SaveBudget;
  saveRoute: SaveRoute;
  removeRoute: RemoveRoute;
  onUnauthenticated: () => void;
  /** Offered when the gateway refuses the viewer (403). */
  forbiddenAction?: ReactNode;
}

/** Which Commission is open, and in what: its drawer, or one of the drawer's dialogs. */
type Open = { slug: string; view: 'drawer' | 'gate' | 'budget' } | null;

/** The route being edited (with its scope as the table names it), or a new one; null: none. */
type OpenRoute = { route: Route | null; scope: string | null } | null;

const FILTER_LABELS: Record<AiFilter, string> = {
  all: m.filterAll,
  enabled: m.filterEnabled,
  'not-enabled': m.filterNotEnabled,
  budget: m.filterBudget,
};

const isForbidden = (result: ServiceResult<unknown> | null) =>
  result?.ok === false && result.error.kind === 'problem' && result.error.problem.status === 403;

/**
 * The AI policy page for platform admins (spec 07c FE-4, S16): per Commission the classification
 * gate (provider classes allowed per data class), this month's usage against the budget and the
 * rate limit, each Commission's detail in a drawer with its policy and budget dialogs; and the
 * routing table, each route editable and a Commission's own route removable (story 17). Search, filter and page apply in the browser: the page reads every
 * Commission once per visit.
 */
export function AiPolicyView(props: AiPolicyViewProps) {
  const { result, search, onSearchChange } = props;
  const [open, setOpen] = useState<Open>(null);
  const [openRoute, setOpenRoute] = useState<OpenRoute>(null);
  if (isForbidden(result)) {
    return (
      <Page narrow>
        <PageHead title={m.title} />
        <NoAccess text={m.forbiddenText} action={props.forbiddenAction} />
      </Page>
    );
  }
  const overview = result?.ok ? result.data : null;
  const tenants = overview?.tenants ?? [];
  const row = open ? (tenants.find((tenant) => tenant.slug === open.slug) ?? null) : null;
  const tab = search.tab ?? 'commissions';
  const back = () => {
    setOpen((current) => (current ? { ...current, view: 'drawer' } : null));
  };

  return (
    <Page>
      <PageHead title={m.title}>
        {/* A div: the skeleton is a block, which a paragraph cannot hold. */}
        <div className="mt-1 h-[21px] text-sm text-muted-foreground" aria-live="polite">
          {result === null ? (
            <Skeleton className="my-1 inline-block w-[180px] align-middle" />
          ) : overview ? (
            m.enabledCount(tenants.filter((tenant) => isEnabled(tenant)).length, tenants.length)
          ) : null}
        </div>
      </PageHead>
      <Tabs
        value={tab}
        onValueChange={(value) => {
          onSearchChange({ ...search, tab: value === 'routing' ? 'routing' : undefined });
        }}
      >
        <TabsList aria-label={m.tabsLabel}>
          <TabsTrigger value="commissions">{m.tabCommissions}</TabsTrigger>
          <TabsTrigger value="routing">{m.tabRouting}</TabsTrigger>
        </TabsList>
        <TabsContent value="commissions">
          {result && !result.ok ? (
            <LoadError
              title={m.loadErrorTitle}
              detail={
                result.error.kind === 'unavailable' && result.error.detail
                  ? result.error.detail
                  : m.loadErrorDetail
              }
              retryLabel={m.tryAgain}
            />
          ) : (
            <CommissionsCard
              overview={overview}
              search={search}
              onSearchChange={onSearchChange}
              onOpen={(slug) => {
                setOpen({ slug, view: 'drawer' });
              }}
            />
          )}
        </TabsContent>
        <TabsContent value="routing">
          <RoutingCard
            overview={overview}
            failed={result?.ok === false}
            onEdit={(route, scope) => {
              setOpenRoute({ route, scope });
            }}
            onAdd={() => {
              setOpenRoute({ route: null, scope: null });
            }}
          />
        </TabsContent>
      </Tabs>
      <CommissionDrawer
        row={open?.view === 'drawer' ? row : null}
        onClose={() => {
          setOpen(null);
        }}
        onEditPolicy={() => {
          setOpen((current) => (current ? { ...current, view: 'gate' } : null));
        }}
        onEditBudget={() => {
          setOpen((current) => (current ? { ...current, view: 'budget' } : null));
        }}
      />
      {row && open?.view === 'gate' ? (
        <GateDialog
          row={row}
          save={props.saveGate}
          onClose={back}
          onUnauthenticated={props.onUnauthenticated}
        />
      ) : null}
      {openRoute ? (
        <RouteDialog
          route={openRoute.route}
          scope={openRoute.scope}
          commissions={tenants}
          save={props.saveRoute}
          remove={props.removeRoute}
          onClose={() => {
            setOpenRoute(null);
          }}
          onUnauthenticated={props.onUnauthenticated}
        />
      ) : null}
      {row?.usage && open?.view === 'budget' ? (
        <BudgetDialog
          row={row}
          usage={row.usage}
          save={props.saveBudget}
          onClose={back}
          onUnauthenticated={props.onUnauthenticated}
        />
      ) : null}
    </Page>
  );
}

function CommissionsCard({
  overview,
  search,
  onSearchChange,
  onOpen,
}: {
  overview: AiPolicyOverview | null;
  search: AiPolicySearch;
  onSearchChange: (next: AiPolicySearch) => void;
  onOpen: (slug: string) => void;
}) {
  const id = useId();
  const filter = search.show ?? 'all';
  const searched = overview ? searchRows(overview.tenants, search.q) : [];
  const counts = filterCounts(searched);
  const shown = filterRows(searched, filter);
  const page = pageOf(shown, search.page);
  const month = overview ? usageMonth(overview.tenants) : null;
  // A search or filter change starts again from the first page.
  const setFilters = (patch: Pick<AiPolicySearch, 'q' | 'show'>) => {
    onSearchChange({ ...search, ...patch, page: undefined });
  };
  const filtered = Boolean(search.q) || filter !== 'all';

  return (
    <Card className="overflow-hidden p-0 sm:p-0">
      <div role="search" className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <SearchBox
          id={`${id}-search`}
          label={m.searchLabel}
          placeholder={m.searchPlaceholder}
          maxLength={100}
          applied={search.q ?? ''}
          disabled={overview === null}
          onSearch={(value) => {
            setFilters({ q: value || undefined });
          }}
        />
        <div role="group" aria-label={m.filterLabel} className="flex flex-wrap gap-2">
          {AI_FILTERS.map((each) => (
            <FilterChip
              key={each}
              pressed={filter === each}
              disabled={overview === null}
              count={overview ? counts[each] : undefined}
              countLabel={m.filterCountLabel}
              onPressedChange={() => {
                setFilters({ show: each === 'all' ? undefined : each });
              }}
            >
              {FILTER_LABELS[each]}
            </FilterChip>
          ))}
        </div>
      </div>
      {overview === null ? (
        <CommissionsSkeleton />
      ) : shown.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={<Icon icon={Search01Icon} />}
            title={m.noMatchesTitle}
            description={m.noMatchesText}
            action={
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  onSearchChange({ tab: search.tab });
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
          />
        )
      ) : (
        <>
          <Table caption={m.caption}>
            <TableHeader>
              <TableRow>
                <TableHead>{m.columnCommission}</TableHead>
                {DATA_CLASSES.map((dataClass) => (
                  <TableHead key={dataClass}>
                    <DataClassHead dataClass={dataClass} />
                  </TableHead>
                ))}
                <TableHead>
                  {month ? m.columnUsage(shortMonth(month)) : m.columnUsageThisMonth}
                </TableHead>
                <TableHead className="text-right">{m.columnRateLimit}</TableHead>
                <TableHead>
                  <span className="sr-only">{m.columnCommission}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {page.rows.map((row) => (
                <CommissionRow key={row.slug} row={row} onOpen={onOpen} />
              ))}
            </TableBody>
          </Table>
          {page.pages > 1 ? (
            <CursorPager
              labels={{
                pagination: m.pagination,
                pageRange: (from, to) => m.pageRange(from, to, shown.length),
                pageRows: m.pageRows,
                previousPage: m.previousPage,
                nextPage: m.nextPage,
              }}
              range={{ from: page.from, to: page.to }}
              rows={page.rows.length}
              hasPrevious={page.page > 1}
              hasNext={page.page < page.pages}
              onPrevious={() => {
                onSearchChange({ ...search, page: page.page > 2 ? page.page - 1 : undefined });
              }}
              onNext={() => {
                onSearchChange({ ...search, page: page.page + 1 });
              }}
            />
          ) : null}
        </>
      )}
    </Card>
  );
}

/** "Highly confidential" carries the tip that says what each data class is. */
function DataClassHead({ dataClass }: { dataClass: DataClass }) {
  if (dataClass !== 'highly-confidential') return m.dataClass[dataClass];
  return (
    <span className="inline-flex items-center gap-1">
      {m.dataClass[dataClass]}
      <DataClassesTip />
    </span>
  );
}

function CommissionRow({ row, onOpen }: { row: AiTenantRow; onOpen: (slug: string) => void }) {
  const enabled = isEnabled(row);
  return (
    <TableRow>
      <TableHead scope="row" className="min-w-[220px] py-3 font-normal">
        <TableRowLink asChild>
          <button
            type="button"
            className="cursor-pointer text-left"
            aria-haspopup="dialog"
            onClick={() => {
              onOpen(row.slug);
            }}
          >
            {row.name}
          </button>
        </TableRowLink>
        <span className="mt-0.5 block font-mono text-[12.5px] text-muted-foreground">
          {row.slug}
        </span>
      </TableHead>
      {DATA_CLASSES.map((dataClass) => (
        <TableCell key={dataClass} className="whitespace-nowrap">
          <GateCell row={row} dataClass={dataClass} />
        </TableCell>
      ))}
      <TableCell className="min-w-[190px]">
        {row.usage === null ? (
          <span className="text-[13px] text-muted-foreground">{m.usageUnavailable}</span>
        ) : enabled ? (
          <UsageMeter tokensUsed={row.usage.tokensUsed} monthlyTokens={row.usage.monthlyTokens} />
        ) : (
          <span className="text-[13px] whitespace-nowrap text-muted-foreground">
            {row.usage.blocked > 0 ? m.notEnabledBlocked(row.usage.blocked) : m.notEnabled}
          </span>
        )}
      </TableCell>
      <TableCell className="text-right whitespace-nowrap tabular-nums">
        {row.usage ? m.perMinuteShort(row.usage.perMinute) : null}
      </TableCell>
      <TableCell className="w-10 text-muted-foreground">
        <Icon icon={ArrowRight01Icon} className="size-4" aria-hidden="true" />
      </TableCell>
    </TableRow>
  );
}

function CommissionsSkeleton() {
  return (
    <Table caption={m.caption} aria-busy="true">
      <TableBody>
        {Array.from({ length: 8 }, (_, row) => (
          <TableRow key={row}>
            <TableCell>
              <Skeleton className="w-55 max-w-full" />
              <Skeleton className="mt-1.5 w-12" />
            </TableCell>
            {Array.from({ length: 3 }, (_, column) => (
              <TableCell key={column}>
                <Skeleton className="w-16" />
              </TableCell>
            ))}
            <TableCell>
              <Skeleton className="w-40" />
            </TableCell>
            <TableCell>
              <Skeleton className="ml-auto w-12" />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function RoutingCard({
  overview,
  failed,
  onEdit,
  onAdd,
}: {
  overview: AiPolicyOverview | null;
  failed: boolean;
  onEdit: (route: Route, scope: string | null) => void;
  onAdd: () => void;
}) {
  if (failed) {
    return (
      <LoadError title={m.loadErrorTitle} detail={m.loadErrorDetail} retryLabel={m.tryAgain} />
    );
  }
  const routing = overview?.routing ?? null;
  if (routing && !routing.ok) {
    return (
      <LoadError title={m.routingErrorTitle} detail={m.loadErrorDetail} retryLabel={m.tryAgain} />
    );
  }
  const names = new Map(overview?.tenants.map((tenant) => [tenant.slug, tenant.name]));
  return (
    <Card className="overflow-hidden p-0 sm:p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <p className="text-[13px] text-muted-foreground">{m.routingAudited}</p>
        <Button
          variant="secondary"
          size="sm"
          disabled={routing === null || !overview?.tenants.length}
          aria-haspopup="dialog"
          onClick={onAdd}
        >
          <Icon icon={Add01Icon} />
          {m.addRoute}
        </Button>
      </div>
      {routing === null ? (
        <CommissionsSkeleton />
      ) : routing.data.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">{m.routingEmpty}</p>
      ) : (
        <Table caption={m.routingCaption}>
          <TableHeader>
            <TableRow>
              <TableHead>{m.columnTask}</TableHead>
              <TableHead>{m.columnScope}</TableHead>
              <TableHead>{m.columnProvider}</TableHead>
              <TableHead>{m.columnModel}</TableHead>
              <TableHead>{m.columnParameters}</TableHead>
              <TableHead>
                <span className="sr-only">{m.editRoute}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {routing.data.map((route) => (
              <RouteRow
                key={`${route.task}|${route.tenant ?? ''}`}
                route={route}
                scope={route.tenant ? (names.get(route.tenant) ?? route.tenant) : null}
                onEdit={onEdit}
              />
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

function RouteRow({
  route,
  scope,
  onEdit,
}: {
  route: Route;
  scope: string | null;
  onEdit: (route: Route, scope: string | null) => void;
}) {
  const params = routeParams(route.params);
  return (
    <TableRow>
      <TableCell className="font-mono text-[12.5px] whitespace-nowrap">{route.task}</TableCell>
      <TableCell className="min-w-[150px]">
        {scope ?? <span className="text-muted-foreground">{m.allCommissions}</span>}
      </TableCell>
      <TableCell>{AI_PROVIDER_NAMES[route.provider] ?? route.provider}</TableCell>
      <TableCell className="font-mono text-[12.5px] whitespace-nowrap">{route.model}</TableCell>
      <TableCell className="min-w-[220px]">
        {params.length === 0 ? (
          <span className="text-[12.5px] text-muted-foreground">{m.taskDefaults}</span>
        ) : (
          <dl className="flex flex-wrap gap-x-3 gap-y-1 text-[12.5px] text-secondary-foreground">
            {params.map(({ label, value }) => (
              <div key={label} className="flex gap-1">
                <dt className="font-medium text-muted-foreground">{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </TableCell>
      <TableCell className="w-16 text-right">
        <Button
          variant="ghost"
          size="sm"
          aria-haspopup="dialog"
          aria-label={m.editRouteLabel(route.task, scope ?? m.allCommissions)}
          onClick={() => {
            onEdit(route, scope);
          }}
        >
          {m.editRoute}
        </Button>
      </TableCell>
    </TableRow>
  );
}
