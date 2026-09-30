import {
  Button,
  Card,
  cn,
  EmptyState,
  formatDate,
  hasCountdown,
  Icon,
  ObligationCountdown,
  ObligationStatusBadge,
  obligationStatusMeta,
  obligationTypeNames,
  obligationTypeShortLabel,
  reminderOffsetLabel,
  reminderOutcomeLabel,
  remindersSentLabel,
  Select,
  SelectItem,
  SegmentedChoice,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableRowLink,
  Tooltip,
  focusRing,
} from '@adili/ui';
import {
  Calendar03Icon,
  Cancel01Icon,
  Notification01Icon,
  Search01Icon,
} from '@hugeicons/core-free-icons';
import { type ReactNode, useId, useState } from 'react';

import type {
  DeclarationsResult,
  ObligationListItem,
  ObligationPage,
} from '../../server/declarations/client';
import { LoadError } from '../load-error';
import { appendPage, type LoadedPages } from '../roster/records-query';
import { SearchBox } from '../search-box';
import { goToSignIn } from '../sign-in-redirect';
import { OnboardedBadge } from './obligation-badges';
import { messages as m } from './messages';
import {
  type CycleOption,
  hasObligationFilters,
  OBLIGATION_FILTER_STATUSES,
  OBLIGATION_TYPES,
  type ObligationsSearch,
  withFilter,
} from './obligations-query';
import { SERVICE_UNAVAILABLE } from '../../server/service-call';

/** Radix Select items cannot have an empty value, so "all" is this sentinel. */
const ALL = 'all';

export interface ObligationsListProps {
  /** The first page for `search`; null while it loads. */
  result: DeclarationsResult<ObligationPage> | null;
  /** The filters on show (those being loaded while a change is pending). */
  search: ObligationsSearch;
  onSearchChange: (next: ObligationsSearch, options?: { replace?: boolean }) => void;
  /** The page after `cursor` for the same filters, for "Load more". */
  loadPage: (cursor: string) => Promise<DeclarationsResult<ObligationPage>>;
  /** Cycles to filter by. */
  cycles: readonly CycleOption[];
  /** Opens the obligation's drawer. */
  onOpen: (obligation: ObligationListItem) => void;
  /** Offered when there are no obligations at all, e.g. "Import roster" while the roster is empty. */
  emptyAction?: ReactNode;
}

/**
 * The Commission's declarants and their obligations (spec 04 FE-3): search, type, status,
 * onboarded and cycle on top, then the obligations overdue first and by due date, and "Load
 * more" for the next page. A row opens the obligation's drawer.
 */
export function ObligationsList(props: ObligationsListProps) {
  const { result } = props;
  return (
    <Card className="@container overflow-hidden p-0 sm:p-0">
      <Toolbar {...props} />
      {result === null ? (
        <ObligationsTableSkeleton />
      ) : (
        // A new first page (other filters, or a reload) starts the list again.
        <Results key={pageKey(result)} {...props} result={result} />
      )}
    </Card>
  );
}

/** Identifies a first page, so "Load more" state resets when it changes. */
function pageKey(result: DeclarationsResult<ObligationPage>): string {
  if (!result.ok) return 'error';
  return `${result.data.items.map((item) => item.id).join(',')}|${result.data.nextCursor ?? ''}`;
}

const ONBOARDED_CHOICES = [
  { value: ALL, label: m.onboardedAny, onboarded: undefined },
  { value: 'yes', label: m.onboardedYes, onboarded: true },
  { value: 'no', label: m.onboardedNo, onboarded: false },
] as const;

function Toolbar({ search, onSearchChange, cycles, result }: ObligationsListProps) {
  const id = useId();
  const disabled = result?.ok === false && result.error.kind !== 'unavailable';
  const onboarded = search.onboarded === undefined ? ALL : search.onboarded ? 'yes' : 'no';
  return (
    <div role="search" className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
      <SearchBox
        id={`${id}-search`}
        label={m.searchLabel}
        placeholder={m.searchPlaceholder}
        maxLength={100}
        applied={search.search ?? ''}
        disabled={disabled}
        className="max-w-80 min-w-55 flex-1"
        onSearch={(value) => {
          onSearchChange(withFilter(search, 'search', value || undefined), { replace: true });
        }}
      />
      <label htmlFor={`${id}-type`} className="sr-only">
        {m.typeLabel}
      </label>
      <Select
        id={`${id}-type`}
        value={search.type ?? ALL}
        disabled={disabled}
        className="h-9 w-auto min-w-32.5 text-sm"
        onValueChange={(value) => {
          onSearchChange(
            withFilter(
              search,
              'type',
              OBLIGATION_TYPES.find((type) => type === value),
            ),
          );
        }}
      >
        <SelectItem value={ALL}>{m.typeAll}</SelectItem>
        {OBLIGATION_TYPES.map((type) => (
          <SelectItem key={type} value={type}>
            {obligationTypeNames[type]}
          </SelectItem>
        ))}
      </Select>
      <label htmlFor={`${id}-status`} className="sr-only">
        {m.statusLabel}
      </label>
      <Select
        id={`${id}-status`}
        value={search.status ?? ALL}
        disabled={disabled}
        className="h-9 w-auto min-w-35 text-sm"
        onValueChange={(value) => {
          onSearchChange(
            withFilter(
              search,
              'status',
              OBLIGATION_FILTER_STATUSES.find((status) => status === value),
            ),
          );
        }}
      >
        <SelectItem value={ALL}>{m.statusAll}</SelectItem>
        {OBLIGATION_FILTER_STATUSES.map((status) => (
          <SelectItem key={status} value={status}>
            {obligationStatusMeta[status].label}
          </SelectItem>
        ))}
      </Select>
      <SegmentedChoice
        variant="track"
        name={`${id}-onboarded`}
        legend={m.onboardedLabel}
        value={onboarded}
        disabled={disabled}
        options={ONBOARDED_CHOICES}
        onValueChange={(value) => {
          const choice = ONBOARDED_CHOICES.find((entry) => entry.value === value);
          onSearchChange(withFilter(search, 'onboarded', choice?.onboarded));
        }}
      />
      <label htmlFor={`${id}-cycle`} className="sr-only">
        {m.cycleLabel}
      </label>
      <Select
        id={`${id}-cycle`}
        value={search.cycle ?? ALL}
        disabled={disabled}
        className="h-9 w-auto min-w-35 text-sm"
        onValueChange={(value) => {
          onSearchChange(withFilter(search, 'cycle', value === ALL ? undefined : value));
        }}
      >
        <SelectItem value={ALL}>{m.cycleAll}</SelectItem>
        {cycles.map((cycle) => (
          <SelectItem key={cycle.key} value={cycle.key} disabled={!cycle.opened}>
            {cycle.opened ? cycle.label : m.cycleNotOpenOption(cycle.label)}
          </SelectItem>
        ))}
      </Select>
      {hasObligationFilters(search) ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            onSearchChange({});
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
  onSearchChange,
  loadPage,
  onOpen,
  emptyAction,
}: ObligationsListProps & { result: DeclarationsResult<ObligationPage> }) {
  const [loaded, setLoaded] = useState<LoadedPages<ObligationListItem> | null>(
    result.ok ? result.data : null,
  );
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);

  if (!result.ok || loaded === null) {
    const error = result.ok ? null : result.error;
    const detail =
      (error?.kind === 'unavailable' ? error.detail : null) ??
      (error?.kind === 'problem' ? error.problem.detail : undefined) ??
      m.errorDetail;
    return (
      <div className="p-5">
        <LoadError title={m.errorTitle} detail={detail} retryLabel={m.tryAgain} />
      </div>
    );
  }

  if (loaded.items.length === 0) {
    return hasObligationFilters(search) ? (
      <EmptyState
        icon={<Icon icon={Search01Icon} />}
        title={m.noMatchesTitle}
        description={m.noMatchesText}
        action={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              onSearchChange({});
            }}
          >
            {m.clearFilters}
          </Button>
        }
      />
    ) : (
      <EmptyState
        icon={<Icon icon={Calendar03Icon} />}
        title={m.emptyTitle}
        description={m.emptyText}
        action={emptyAction}
      />
    );
  }

  const more = async () => {
    if (!loaded.nextCursor || loadingMore) return;
    setLoadingMore(true);
    setMoreFailed(false);
    const page: DeclarationsResult<ObligationPage> = await loadPage(loaded.nextCursor).catch(
      () => SERVICE_UNAVAILABLE,
    );
    setLoadingMore(false);
    if (!page.ok && page.error.kind === 'unauthenticated') {
      goToSignIn();
      return;
    }
    if (page.ok) setLoaded((current) => (current ? appendPage(current, page.data) : page.data));
    else setMoreFailed(true);
  };

  return (
    <>
      <div className="hidden @[900px]:block">
        <ObligationsTable items={loaded.items} onOpen={onOpen} />
      </div>
      <div className="@[900px]:hidden">
        <ObligationsCards items={loaded.items} onOpen={onOpen} />
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t px-4 py-2.5 text-[13.5px] text-muted-foreground">
        <span aria-live="polite" className="mr-auto">
          {loaded.nextCursor ? m.shown(loaded.items.length) : m.allShown(loaded.items.length)}
        </span>
        {moreFailed ? (
          <span role="alert" className="text-destructive">
            {m.loadMoreError}
          </span>
        ) : null}
        {loaded.nextCursor ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={loadingMore}
            aria-busy={loadingMore || undefined}
            onClick={() => void more()}
          >
            {loadingMore ? m.loadingMore : m.loadMore}
          </Button>
        ) : null}
      </div>
    </>
  );
}

function Header() {
  return (
    <TableHeader>
      <TableRow>
        <TableHead>{m.columnDeclarant}</TableHead>
        <TableHead>{m.columnType}</TableHead>
        <TableHead>{m.columnStatementDate}</TableHead>
        <TableHead>{m.columnDueDate}</TableHead>
        <TableHead>{m.columnStatus}</TableHead>
        <TableHead>{m.columnOnboarded}</TableHead>
        <TableHead>{m.columnReminders}</TableHead>
      </TableRow>
    </TableHeader>
  );
}

function FileNumber({ value }: { value: string }) {
  return (
    <span className="block font-mono text-[12.5px] whitespace-nowrap text-muted-foreground">
      {value}
    </span>
  );
}

/** The declarant's name as the row's one control: it opens the obligation's drawer. */
function OpenButton({
  obligation,
  onOpen,
}: {
  obligation: ObligationListItem;
  onOpen: ObligationsListProps['onOpen'];
}) {
  return (
    <TableRowLink asChild>
      <button
        type="button"
        className="cursor-pointer text-left"
        aria-haspopup="dialog"
        onClick={() => {
          onOpen(obligation);
        }}
      >
        {obligation.declarant.fullName}
      </button>
    </TableRowLink>
  );
}

/** When it is due, with days left or overdue under it (upcoming ones say when they open). */
function DueDate({ obligation }: { obligation: ObligationListItem }) {
  return (
    <>
      <span className="block whitespace-nowrap">{formatDate(obligation.dueDate)}</span>
      <span className="block text-[12.5px] whitespace-nowrap text-muted-foreground">
        <ObligationCountdown obligation={obligation} />
      </span>
    </>
  );
}

/**
 * What the reminders say on hover and focus: the count sent and the last reminder's outcome; the
 * drawer lists every one.
 */
function remindersTip(obligation: ObligationListItem): ReactNode {
  const { lastReminder } = obligation;
  if (!obligation.declarant.onboarded) return m.remindersNoneNotOnboarded;
  return (
    <>
      <span className="block">{remindersSentLabel(obligation.remindersSent)}</span>
      {lastReminder ? (
        <span className="block">
          {m.remindersLast(
            reminderOffsetLabel(lastReminder.offsetDays),
            reminderOutcomeLabel(lastReminder.outcome, lastReminder.channels),
          )}
        </span>
      ) : null}
      <span className="block">{m.remindersSeeHistory}</span>
    </>
  );
}

/** Reminders sent, as a count with a tooltip; above the row's link so it takes hover and focus. */
function Reminders({ obligation }: { obligation: ObligationListItem }) {
  return (
    <Tooltip content={remindersTip(obligation)}>
      <span
        tabIndex={0}
        aria-label={remindersSentLabel(obligation.remindersSent)}
        className={cn(
          'relative z-10 inline-flex items-center gap-1.5 rounded-sm tabular-nums',
          focusRing,
        )}
      >
        <Icon icon={Notification01Icon} className="size-3.5 text-muted-foreground" />
        {obligation.remindersSent}
      </span>
    </Tooltip>
  );
}

function ObligationsTable({
  items,
  onOpen,
}: {
  items: readonly ObligationListItem[];
  onOpen: ObligationsListProps['onOpen'];
}) {
  return (
    <Table caption={m.caption}>
      <Header />
      <TableBody>
        {items.map((obligation) => (
          <TableRow key={obligation.id}>
            <TableHead scope="row" className="min-w-47.5 font-normal">
              <OpenButton obligation={obligation} onOpen={onOpen} />
              <FileNumber value={obligation.declarant.personnelFileNumber} />
            </TableHead>
            <TableCell className="whitespace-nowrap">
              {obligationTypeShortLabel(obligation.type, obligation.statementDate)}
            </TableCell>
            <TableCell className="whitespace-nowrap">
              {formatDate(obligation.statementDate)}
            </TableCell>
            <TableCell>
              <DueDate obligation={obligation} />
            </TableCell>
            <TableCell>
              <ObligationStatusBadge status={obligation.status} />
            </TableCell>
            <TableCell>
              <OnboardedBadge onboarded={obligation.declarant.onboarded} />
            </TableCell>
            <TableCell>
              <Reminders obligation={obligation} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/**
 * Where the seven columns do not fit (under 900px of list, with or without the sidebar), the
 * table becomes a list of cards (the prototype's `.mlist`).
 */
function ObligationsCards({
  items,
  onOpen,
}: {
  items: readonly ObligationListItem[];
  onOpen: ObligationsListProps['onOpen'];
}) {
  return (
    <ul aria-label={m.caption}>
      {items.map((obligation) => (
        <li
          key={obligation.id}
          className="relative flex flex-col gap-1.5 border-b px-4 py-3.5 transition-colors last:border-b-0 hover:bg-muted/50"
        >
          <div className="flex items-start justify-between gap-2.5">
            <div className="min-w-0 leading-snug">
              <OpenButton obligation={obligation} onOpen={onOpen} />
              <FileNumber value={obligation.declarant.personnelFileNumber} />
            </div>
            <ObligationStatusBadge status={obligation.status} />
          </div>
          <p className="flex flex-wrap items-center gap-x-1.5 text-[13px] text-muted-foreground">
            <span>{obligationTypeShortLabel(obligation.type, obligation.statementDate)}</span>
            <span aria-hidden="true">·</span>
            <span>{formatDate(obligation.dueDate)}</span>
            {!hasCountdown(obligation.status) ? null : (
              <>
                <span aria-hidden="true">·</span>
                <ObligationCountdown obligation={obligation} />
              </>
            )}
          </p>
          <p className="flex flex-wrap items-center gap-x-1.5 text-[13px] text-muted-foreground">
            <span>{obligation.declarant.onboarded ? m.onboardedShort : m.notOnboardedShort}</span>
            <span aria-hidden="true">·</span>
            <span>{remindersSentLabel(obligation.remindersSent)}</span>
          </p>
        </li>
      ))}
    </ul>
  );
}

const SKELETON_WIDTHS = ['w-37.5', 'w-17.5', 'w-22.5', 'w-22.5', 'w-20', 'w-10', 'w-7.5'];

/** Placeholder rows under the real header while the first page loads; the table is marked busy. */
export function ObligationsTableSkeleton() {
  return (
    <Table caption={m.loadingCaption} aria-busy="true">
      <Header />
      <TableBody>
        {Array.from({ length: 6 }, (_, row) => (
          <TableRow key={row}>
            {SKELETON_WIDTHS.map((width, column) => (
              <TableCell key={column}>
                <Skeleton className={width} />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
