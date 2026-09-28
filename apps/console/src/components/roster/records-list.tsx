import {
  Button,
  Card,
  EmptyState,
  FilterChip,
  Icon,
  Select,
  SelectItem,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableRowLink,
} from '@adili/ui';
import { Cancel01Icon, Flag02Icon, Search01Icon, UserGroupIcon } from '@hugeicons/core-free-icons';
import { type ReactNode, useId, useState } from 'react';

import type {
  DirectoryResult,
  RosterRecordListItem,
  RosterRecordPage,
} from '../../server/directory/client';
import { LoadError, NoAccess } from '../load-error';
import { SearchBox } from '../search-box';
import { goToSignIn } from '../sign-in-redirect';
import { IdentityMismatchBadge } from './identity-mismatch';
import { messages as m } from './messages';
import { isFlagged } from './record-imports';
import { hasIdentityMismatch } from './record-onboarding';
import {
  appendPage,
  hasRecordFilters,
  type LoadedPages,
  noMatchesHint,
  RECORD_STATES,
  type RecordsSearch,
  toggleFlagged,
} from './records-query';
import { MaskedNationalId, NotInLatestImportBadge, RecordStateBadge } from './roster-badges';

/** Radix Select items cannot have an empty value, so "all states" is this sentinel. */
const ALL = 'all';

const STATE_LABELS = {
  not_onboarded: m.stateNotOnboarded,
  onboarded: m.stateOnboarded,
  exited: m.stateExited,
} as const;

export interface RecordsListProps {
  /** The first page for `search`; null while it loads. */
  result: DirectoryResult<RosterRecordPage> | null;
  /** The filters on show (those being loaded while a change is pending). */
  search: RecordsSearch;
  onSearchChange: (next: RecordsSearch, options?: { replace?: boolean }) => void;
  /** The page after `cursor` for the same filters, for "Load more". */
  loadPage: (cursor: string) => Promise<DirectoryResult<RosterRecordPage>>;
  /** The record's name as a link to its detail page. */
  recordLink: (record: RosterRecordListItem) => ReactNode;
  /** How many records are flagged, for the "Flagged only" chip, when known. */
  flaggedCount?: number;
  /** Offered when the roster is empty, e.g. "Import roster" for the reporting officer. */
  emptyAction?: ReactNode;
  readOnly: boolean;
}

/**
 * The roster records card (spec 02 FE-6): search, state filter and "Flagged only" on top, then
 * the records ordered by name with masked national IDs, and "Load more" for the next page.
 * The "Identity check failed" chip (spec 03 S25) joins "Flagged only" once the directory filters
 * on `identityMismatch` (#76); until then it would look on and filter nothing.
 */
export function RecordsList(props: RecordsListProps) {
  const { result, search } = props;
  const forbidden =
    result?.ok === false && result.error.kind === 'problem' && result.error.problem.status === 403;
  if (forbidden) {
    return (
      <NoAccess
        text={m.recordsForbidden}
        action={<p className="text-sm">{m.recordsForbiddenText}</p>}
      />
    );
  }
  return (
    <Card className="overflow-hidden p-0 sm:p-0">
      <Toolbar {...props} />
      {result === null ? (
        <RecordsTableSkeleton />
      ) : (
        // A new first page (other filters, or a reload) starts the list again.
        <Results key={pageKey(result)} {...props} result={result} search={search} />
      )}
    </Card>
  );
}

/** Identifies a first page, so "Load more" state resets when it changes. */
function pageKey(result: DirectoryResult<RosterRecordPage>): string {
  if (!result.ok) return 'error';
  return `${result.data.items.map((item) => item.id).join(',')}|${result.data.nextCursor ?? ''}`;
}

function Toolbar({ search, onSearchChange, flaggedCount, result }: RecordsListProps) {
  const id = useId();
  const disabled = result?.ok === false && result.error.kind !== 'unavailable';
  return (
    <div role="search" className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
      <SearchBox
        id={`${id}-search`}
        label={m.searchLabel}
        placeholder={m.searchPlaceholder}
        maxLength={200}
        applied={search.search ?? ''}
        disabled={disabled}
        className="max-w-[380px] min-w-[240px]"
        onSearch={(value) => {
          onSearchChange({ ...search, search: value || undefined }, { replace: true });
        }}
      />
      <label htmlFor={`${id}-state`} className="sr-only">
        {m.stateLabel}
      </label>
      <Select
        id={`${id}-state`}
        value={search.state ?? ALL}
        disabled={disabled}
        className="h-9 w-auto min-w-[150px] text-sm"
        onValueChange={(value) => {
          const state = RECORD_STATES.find((known) => known === value);
          onSearchChange({ ...search, state });
        }}
      >
        <SelectItem value={ALL}>{m.stateAll}</SelectItem>
        {RECORD_STATES.map((state) => (
          <SelectItem key={state} value={state}>
            {STATE_LABELS[state]}
          </SelectItem>
        ))}
      </Select>
      <FilterChip
        icon={Flag02Icon}
        pressed={search.flagged === true}
        disabled={disabled}
        count={flaggedCount}
        countLabel="flagged"
        onPressedChange={() => {
          onSearchChange(toggleFlagged(search));
        }}
      >
        {m.flaggedOnly}
      </FilterChip>
      {hasRecordFilters(search) ? (
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
  recordLink,
  emptyAction,
  readOnly,
}: RecordsListProps & { result: DirectoryResult<RosterRecordPage> }) {
  const [loaded, setLoaded] = useState<LoadedPages<RosterRecordListItem> | null>(
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
        <LoadError title={m.recordsErrorTitle} detail={detail} retryLabel={m.tryAgain} />
      </div>
    );
  }

  if (loaded.items.length === 0) {
    return hasRecordFilters(search) ? (
      <EmptyState
        icon={<Icon icon={Search01Icon} />}
        title={m.noMatchesTitle}
        description={
          noMatchesHint(search) === 'partial-national-id' ? m.noMatchesNationalId : m.noMatchesText
        }
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
        icon={<Icon icon={UserGroupIcon} />}
        title={m.recordsEmptyTitle}
        description={readOnly ? m.recordsEmptyTextReadOnly : m.recordsEmptyText}
        action={emptyAction}
      />
    );
  }

  const more = async () => {
    if (!loaded.nextCursor || loadingMore) return;
    setLoadingMore(true);
    setMoreFailed(false);
    const page = await loadPage(loaded.nextCursor).catch((): DirectoryResult<RosterRecordPage> => ({
      ok: false,
      error: { kind: 'unavailable', detail: null },
    }));
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
      <div className="hidden min-[760px]:block">
        <RecordsTable items={loaded.items} recordLink={recordLink} />
      </div>
      <div className="min-[760px]:hidden">
        <RecordsCards items={loaded.items} recordLink={recordLink} />
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
        <TableHead>{m.columnFileNumber}</TableHead>
        <TableHead>{m.columnFullName}</TableHead>
        <TableHead>{m.columnNationalId}</TableHead>
        <TableHead>{m.columnDesignation}</TableHead>
        <TableHead>{m.columnJobGroup}</TableHead>
        <TableHead>{m.columnReportingEntity}</TableHead>
        <TableHead>{m.columnState}</TableHead>
      </TableRow>
    </TableHeader>
  );
}

function Optional({ value }: { value: string | null | undefined }) {
  return value ? <>{value}</> : <span className="text-muted-foreground">{m.noValue}</span>;
}

function FileNumber({ value }: { value: string }) {
  return <span className="font-mono text-[13px] whitespace-nowrap">{value}</span>;
}

function StateBadges({ record }: { record: RosterRecordListItem }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <RecordStateBadge state={record.state} />
      {isFlagged(record) ? <NotInLatestImportBadge /> : null}
      {hasIdentityMismatch(record) ? <IdentityMismatchBadge /> : null}
    </span>
  );
}

function RecordsTable({
  items,
  recordLink,
}: {
  items: readonly RosterRecordListItem[];
  recordLink: RecordsListProps['recordLink'];
}) {
  return (
    <Table caption={m.recordsCaption}>
      <Header />
      <TableBody>
        {items.map((record) => (
          <TableRow key={record.id}>
            <TableCell>
              <FileNumber value={record.personnelFileNumber} />
            </TableCell>
            <TableHead scope="row" className="min-w-[180px] font-normal">
              <TableRowLink asChild>{recordLink(record)}</TableRowLink>
            </TableHead>
            <TableCell className="whitespace-nowrap">
              <MaskedNationalId value={record.nationalIdMasked} />
            </TableCell>
            <TableCell>
              <span
                className="block max-w-[180px] truncate"
                title={record.designation ?? undefined}
              >
                <Optional value={record.designation} />
              </span>
            </TableCell>
            <TableCell className="whitespace-nowrap">
              <Optional value={record.jobGroup} />
            </TableCell>
            <TableCell>
              <span
                className="block max-w-[200px] truncate"
                title={record.reportingEntity?.name ?? undefined}
              >
                <Optional value={record.reportingEntity?.name} />
              </span>
            </TableCell>
            <TableCell>
              <StateBadges record={record} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Below 760px the table becomes a list of cards (the prototype's `.table.cards`). */
function RecordsCards({
  items,
  recordLink,
}: {
  items: readonly RosterRecordListItem[];
  recordLink: RecordsListProps['recordLink'];
}) {
  return (
    <ul aria-label={m.recordsCaption}>
      {items.map((record) => (
        <li
          key={record.id}
          className="relative flex flex-col gap-1.5 border-b px-4 py-3.5 transition-colors last:border-b-0 hover:bg-muted/50"
        >
          <div className="leading-snug">
            <TableRowLink asChild>{recordLink(record)}</TableRowLink>
          </div>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
            <FileNumber value={record.personnelFileNumber} />
            <span>
              <MaskedNationalId value={record.nationalIdMasked} />
            </span>
            {record.jobGroup ? <span>{m.jobGroupShort(record.jobGroup)}</span> : null}
          </p>
          <StateBadges record={record} />
        </li>
      ))}
    </ul>
  );
}

const SKELETON_WIDTHS = [
  'w-[110px]',
  'w-[150px]',
  'w-[70px]',
  'w-[120px]',
  'w-[40px]',
  'w-[160px]',
  'w-[90px]',
];

/** Placeholder rows under the real header while the first page loads; the table is marked busy. */
export function RecordsTableSkeleton() {
  return (
    <Table caption={m.recordsLoadingCaption} aria-busy="true">
      <Header />
      <TableBody>
        {Array.from({ length: 8 }, (_, row) => (
          <TableRow key={row}>
            {SKELETON_WIDTHS.map((width) => (
              <TableCell key={width}>
                <Skeleton className={width} />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** The records page's heading line: expected declarants, when the summary is known. */
export function RecordsSubtitle({ expected }: { expected: number | null }) {
  return (
    <p className="mt-1 h-[21px] text-sm text-muted-foreground">
      {expected === null ? (
        <Skeleton className="my-1 inline-block w-[150px] align-middle" />
      ) : (
        m.recordsExpected(expected)
      )}
    </p>
  );
}
