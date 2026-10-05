import {
  Badge,
  Button,
  Card,
  calendarDaysUntil,
  cn,
  formatLongDate,
  formatDate,
  NewDataTable,
  NewDataTableToolbar,
  useToday,
  EmptyState,
  FilterChip,
  Icon,
  TableRowLink,
} from '@adili/ui';
import { Search01Icon, SquareLock02Icon } from '@hugeicons/core-free-icons';
import { type ReactNode, useId } from 'react';

import type { AccessResult } from '../../server/access-requests.server';
import type { QueueItem, QueuePage } from '../../server/access/types';
import { LoadError } from '../load-error';
import { SearchBox } from '../search-box';
import { shortDate } from './format';
import { messages as m, STATUS } from './messages';
import {
  CLOSED,
  DECIDED,
  filtersFor,
  hasQueueFilters,
  type QueueFilter,
  type QueueSearch,
  type QueueTab,
} from './queue-query';
import { lastInstantOf } from './request-view';

export interface QueueListProps {
  /** The page for `search`; null while it loads. */
  result: AccessResult<QueuePage> | null;
  /** The filters on show (those being loaded while a change is pending). */
  search: QueueSearch;
  onSearchChange: (next: QueueSearch, options?: { replace?: boolean }) => void;
  /** The request's reference as a link to its page. */
  requestLink: (item: QueueItem) => ReactNode;
  /** Previous and Next, under the rows. */
  pager?: ReactNode;
}

/**
 * The Commission's access requests queue (spec 10 FE-5, FE-6), of every kind or the kind the
 * tabs above chose (Form K, law enforcement): search and one filter on top, then the requests
 * earliest deadline first with who asked (the applicant, or the agency), the officer sought (or
 * identified), the status and the deadline that runs: the decision (30 days for Form K, 14 for
 * law enforcement), or the declarant's window for representations while it is open. Late
 * requests show red.
 */
export function QueueList(props: QueueListProps) {
  const { result, search } = props;
  // The tab bar above (`AccessTabs`) sets the kind in the URL.
  const tab: QueueTab = search.kind ?? 'all';
  return (
    <Card className="min-w-0 overflow-hidden p-4 sm:p-5">
      <Toolbar {...props} tab={tab} />
      {result === null ? (
        <QueueTableSkeleton tab={tab} />
      ) : !result.ok ? (
        <div className="p-5">
          <LoadError
            title={m.queueErrorTitle}
            detail={m.queueErrorDetail}
            retryLabel={m.tryAgain}
          />
        </div>
      ) : (
        <Results {...props} tab={tab} page={result.data} />
      )}
    </Card>
  );
}

function Toolbar({ search, onSearchChange, tab }: QueueListProps & { tab: QueueTab }) {
  const id = useId();
  const active: QueueFilter = search.filter ?? 'all';
  return (
    <NewDataTableToolbar
      filters={
        <div role="group" aria-label={m.filtersLabel} className="flex flex-wrap gap-1.5">
          {filtersFor(tab).map((filter) => (
            <FilterChip
              key={filter}
              className={cn(
                'h-7 px-2 text-sm shadow-none',
                active === filter
                  ? 'bg-muted text-foreground'
                  : 'bg-transparent text-muted-foreground',
              )}
              pressed={active === filter}
              onPressedChange={() => {
                onSearchChange({
                  kind: search.kind,
                  filter: filter === 'all' ? undefined : filter,
                  search: search.search,
                });
              }}
            >
              {filter === 'late' ? (
                <span aria-hidden="true" className="size-1.5 rounded-full bg-destructive" />
              ) : null}
              {m.filters[filter]}
            </FilterChip>
          ))}
        </div>
      }
      search={
        <SearchBox
          id={`${id}-search`}
          label={m.searchLabel}
          placeholder={m.searchPlaceholder}
          maxLength={200}
          applied={search.search ?? ''}
          className="max-w-none min-w-0 [&_input]:h-8 [&_input]:text-sm"
          onSearch={(value) => {
            onSearchChange(
              { kind: search.kind, filter: search.filter, search: value || undefined },
              { replace: true },
            );
          }}
        />
      }
    />
  );
}

function Results({
  page,
  search,
  onSearchChange,
  requestLink,
  pager,
  tab,
}: QueueListProps & { page: QueuePage; tab: QueueTab }) {
  if (page.items.length === 0 && !search.cursor) {
    return hasQueueFilters(search) ? (
      <EmptyState
        icon={<Icon icon={Search01Icon} />}
        title={m.noMatchesTitle}
        description={m.noMatchesText}
        action={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              onSearchChange({ kind: search.kind });
            }}
          >
            {m.clearFilters}
          </Button>
        }
      />
    ) : (
      <EmptyState
        icon={<Icon icon={SquareLock02Icon} />}
        title={m.emptyTitle}
        description={m.emptyText[tab]}
      />
    );
  }
  return (
    <>
      <div className="hidden min-[760px]:block">
        <QueueTable items={page.items} requestLink={requestLink} tab={tab} />
      </div>
      <div className="min-[760px]:hidden">
        <QueueCards items={page.items} requestLink={requestLink} />
      </div>
      {pager}
    </>
  );
}

function Sub({ children }: { children: ReactNode }) {
  return <div className="mt-1 text-sm text-muted-foreground">{children}</div>;
}

export function StatusBadge({ status }: { status: QueueItem['status'] }) {
  const { label, tone } = STATUS[status];
  return (
    <Badge variant={tone} className="text-sm">
      {label}
    </Badge>
  );
}

const sameName = (a: string, b: string) =>
  a.trim().replace(/\s+/g, ' ').toLowerCase() === b.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * The officer: once identified, the roster's name and file number, and the name the request
 * sought when it differs (spec 10 "officer sought / resolved"); before that, the name sought.
 */
function Officer({ item }: { item: QueueItem }) {
  if (item.resolvedName) {
    return (
      <>
        <div className="font-medium">{item.resolvedName}</div>
        {item.resolvedFileNumber ? <Sub>{m.fileNumber(item.resolvedFileNumber)}</Sub> : null}
        {sameName(item.officerSought, item.resolvedName) ? null : (
          <Sub>{m.soughtAs(item.officerSought)}</Sub>
        )}
      </>
    );
  }
  return (
    <>
      <div className="font-medium">{item.officerSought}</div>
      <Sub>
        {CLOSED.includes(item.status) || DECIDED.includes(item.status)
          ? m.notIdentified
          : m.notIdentifiedYet}
      </Sub>
    </>
  );
}

/** The deadline that runs, or when the request was decided or closed. */
export function QueueDeadline({ item }: { item: QueueItem }) {
  const today = useToday();
  if (DECIDED.includes(item.status) || CLOSED.includes(item.status)) {
    const text = DECIDED.includes(item.status) ? m.decidedOn : m.closedOn;
    return (
      <span className="text-sm text-muted-foreground">
        {item.closedAt ? text(shortDate(item.closedAt)) : STATUS[item.status].label}
      </span>
    );
  }
  const window = item.status === 'awaiting-representations' ? item.windowEndsAt : null;
  const due = window && !item.late ? window : item.deadlineAt;
  const date = window && !item.late ? lastInstantOf(window) : due;
  const days = calendarDaysUntil(date, today);
  const late = item.late || days < 0;
  const count = `${String(Math.abs(days))} ${Math.abs(days) === 1 ? 'day' : 'days'}`;
  const text = late
    ? days < 0
      ? `${count} overdue`
      : 'Overdue'
    : days === 0
      ? window
        ? 'Closes today'
        : 'Due today'
      : `${window ? 'Closes' : 'Due'} in ${count}`;
  return (
    <>
      <time dateTime={date} data-state={late ? 'late' : 'due'}>
        {formatLongDate(date)}
      </time>
      <div
        className={cn(
          'mt-1 text-sm',
          late ? 'text-destructive' : window ? 'text-warning' : 'text-muted-foreground',
        )}
      >
        {text}
        {window && item.late ? (
          <span className="text-muted-foreground">
            {' · '}
            {m.closesOn(shortDate(lastInstantOf(window)))}
          </span>
        ) : null}
      </div>
    </>
  );
}

function QueueTable({
  items,
  requestLink,
  tab,
}: {
  items: readonly QueueItem[];
  requestLink: QueueListProps['requestLink'];
  tab: QueueTab;
}) {
  return (
    <NewDataTable
      caption={m.queueCaption}
      rows={items}
      getRowId={(item) => item.id}
      columns={queueColumns(tab, requestLink)}
    />
  );
}

function queueColumns(tab: QueueTab, requestLink: QueueListProps['requestLink']) {
  return [
    {
      id: 'reference',
      header: m.columnReference,
      rowHeader: true,
      cell: (item: QueueItem) => (
        <>
          <TableRowLink asChild>{requestLink(item)}</TableRowLink>
          <Sub>
            {tab === 'all' ? `${m.kinds[item.kind]} · ` : ''}
            {tab === 'all' ? formatDate(item.submittedAt) : formatLongDate(item.submittedAt)}
          </Sub>
        </>
      ),
    },
    {
      id: 'applicant',
      header: m.columnWho[tab],
      cell: (item: QueueItem) => (
        <>
          <div className="font-medium">{item.applicantOrAgency}</div>
          {item.applicantOccupation ? <Sub>{item.applicantOccupation}</Sub> : null}
        </>
      ),
    },
    { id: 'officer', header: m.columnOfficer, cell: (item: QueueItem) => <Officer item={item} /> },
    {
      id: 'deadline',
      header: m.columnDeadline,
      cell: (item: QueueItem) => <QueueDeadline item={item} />,
    },
    {
      id: 'status',
      header: m.columnStatus,
      cell: (item: QueueItem) => <StatusBadge status={item.status} />,
    },
  ];
}

/** Below 760px the table becomes a list of cards (the prototype's `.table.cards`). */
function QueueCards({
  items,
  requestLink,
}: {
  items: readonly QueueItem[];
  requestLink: QueueListProps['requestLink'];
}) {
  return (
    <ul aria-label={m.queueCaption}>
      {items.map((item) => (
        <li
          key={item.id}
          className="relative grid gap-1.5 border-b px-4 py-3.5 transition-colors last:border-b-0 hover:bg-muted/50"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <TableRowLink asChild className="text-sm font-medium">
              {requestLink(item)}
            </TableRowLink>
            <StatusBadge status={item.status} />
          </div>
          <p className="text-sm">
            {item.applicantOrAgency}
            {item.applicantOccupation ? (
              <span className="text-muted-foreground"> · {item.applicantOccupation}</span>
            ) : null}
            <span className="text-muted-foreground"> · </span>
            {item.resolvedName ?? item.officerSought}
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <QueueDeadline item={item} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Loading uses the same column widths and row spacing as the results. */
export function QueueTableSkeleton({ tab }: { tab: QueueTab }) {
  return (
    <NewDataTable
      caption={m.queueLoadingCaption}
      rows={[]}
      loading
      getRowId={(item: QueueItem) => item.id}
      columns={queueColumns(tab, () => null)}
    />
  );
}
