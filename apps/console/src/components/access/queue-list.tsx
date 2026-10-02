import {
  Badge,
  Button,
  Card,
  DeadlineChip,
  deadlineSoonDays,
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
    <Card className="overflow-hidden p-0 sm:p-0">
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
    <div role="search" className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
      <SearchBox
        id={`${id}-search`}
        label={m.searchLabel}
        placeholder={m.searchPlaceholder}
        maxLength={200}
        applied={search.search ?? ''}
        className="max-w-[360px] min-w-[240px]"
        onSearch={(value) => {
          onSearchChange(
            { kind: search.kind, filter: search.filter, search: value || undefined },
            { replace: true },
          );
        }}
      />
      <div role="group" aria-label={m.filtersLabel} className="flex flex-wrap gap-1.5">
        {filtersFor(tab).map((filter) => (
          <FilterChip
            key={filter}
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
    </div>
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

function Header({ tab }: { tab: QueueTab }) {
  return (
    <TableHeader>
      <TableRow>
        <TableHead>{m.columnReference}</TableHead>
        <TableHead>{m.columnWho[tab]}</TableHead>
        <TableHead>{m.columnOfficer}</TableHead>
        <TableHead>{m.columnStatus}</TableHead>
        <TableHead>{m.columnDeadline}</TableHead>
      </TableRow>
    </TableHeader>
  );
}

function Sub({ children }: { children: ReactNode }) {
  return (
    <div className="mt-0.5 text-[13px] whitespace-nowrap text-muted-foreground">{children}</div>
  );
}

export function StatusBadge({ status }: { status: QueueItem['status'] }) {
  const { label, tone } = STATUS[status];
  return <Badge variant={tone}>{label}</Badge>;
}

function Officer({ item }: { item: QueueItem }) {
  if (item.resolvedName) {
    return (
      <>
        <div className="font-medium">{item.resolvedName}</div>
        {item.resolvedFileNumber ? <Sub>{m.fileNumber(item.resolvedFileNumber)}</Sub> : null}
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
  if (DECIDED.includes(item.status) || CLOSED.includes(item.status)) {
    const text = DECIDED.includes(item.status) ? m.decidedOn : m.closedOn;
    return (
      <span className="text-[13px] text-muted-foreground">
        {item.closedAt ? text(shortDate(item.closedAt)) : STATUS[item.status].label}
      </span>
    );
  }
  const window = item.status === 'awaiting-representations' && item.windowEndsAt !== null;
  const due = window && item.windowEndsAt ? item.windowEndsAt : item.deadlineAt;
  const soonDays = window
    ? deadlineSoonDays.representations
    : item.kind === 'lea'
      ? deadlineSoonDays.lawEnforcement
      : deadlineSoonDays.decision;
  return (
    <>
      <DeadlineChip
        due={due}
        soonDays={soonDays}
        label={window ? m.representationsClose : m.decisionDue}
        late={window ? false : item.late}
      />
      <Sub>{window ? m.closesOn(shortDate(due)) : m.dueOn(shortDate(due))}</Sub>
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
    <Table caption={m.queueCaption}>
      <Header tab={tab} />
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.id}>
            <TableHead scope="row" className="font-normal">
              <TableRowLink asChild className="font-mono text-[13.5px] font-semibold">
                {requestLink(item)}
              </TableRowLink>
              <Sub>{`${m.kinds[item.kind]} · ${shortDate(item.submittedAt)}`}</Sub>
            </TableHead>
            <TableCell className="min-w-[160px]">
              <div className="font-medium">{item.applicantOrAgency}</div>
            </TableCell>
            <TableCell className="min-w-[180px]">
              <Officer item={item} />
            </TableCell>
            <TableCell>
              <StatusBadge status={item.status} />
            </TableCell>
            <TableCell className="whitespace-nowrap">
              <QueueDeadline item={item} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
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
            <TableRowLink asChild className="font-mono text-[13.5px] font-semibold">
              {requestLink(item)}
            </TableRowLink>
            <StatusBadge status={item.status} />
          </div>
          <p className="text-sm">
            {item.applicantOrAgency}
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

const SKELETON_WIDTHS = ['w-[190px]', 'w-[150px]', 'w-[160px]', 'w-[120px]', 'w-[90px]'];

/** Placeholder rows under the real header while the page loads; the table is marked busy. */
export function QueueTableSkeleton({ tab }: { tab: QueueTab }) {
  return (
    <Table caption={m.queueLoadingCaption} aria-busy="true">
      <Header tab={tab} />
      <TableBody>
        {Array.from({ length: 6 }, (_, row) => (
          <TableRow key={row}>
            {SKELETON_WIDTHS.map((width) => (
              <TableCell key={width} className="py-4">
                <Skeleton className={width} />
                <Skeleton className="mt-2 h-3 w-[70px]" />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
