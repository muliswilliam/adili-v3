import {
  Button,
  Card,
  Checkbox,
  DataTable,
  type DataTableColumn,
  Dialog,
  EmptyState,
  Icon,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useToast,
} from '@adili/ui';
import { Loading03Icon, Logout03Icon, UserCheck01Icon } from '@hugeicons/core-free-icons';
import { useRouter } from '@tanstack/react-router';
import { type ReactNode, useLayoutEffect, useReducer, useRef, useState } from 'react';

import type {
  DirectoryResult,
  RosterRecordListItem,
  RosterRecordPage,
} from '../../server/directory/client';
import { keepRosterRecords } from '../../server/roster-exits';
import { formatDate } from '../format';
import { LoadError, NoAccess } from '../load-error';
import { ConfirmExitsDialogContent } from './confirm-exits-dialog';
import { type ExitingOfficer, keepFailure, type Selection, selectionReducer } from './exits';
import { messages as m } from './messages';
import { appendPage, type LoadedPages } from './records-query';
import { MaskedNationalId, RecordStateBadge } from './roster-badges';

export interface FlaggedListProps {
  slug: string;
  /** The first page of flagged records; null while it loads. */
  result: DirectoryResult<RosterRecordPage> | null;
  /** The page after `cursor`, for "Load more". */
  loadPage: (cursor: string) => Promise<DirectoryResult<RosterRecordPage>>;
  /** The record's name as a link to its detail page. */
  recordLink: (record: RosterRecordListItem) => ReactNode;
  /** Offered when nobody is flagged, e.g. a link back to the overview. */
  emptyAction?: ReactNode;
  /** Commission admins see the list; only the reporting officer selects and acts. */
  readOnly: boolean;
}

const unavailable = { ok: false, error: { kind: 'unavailable', detail: null } } as const;

function signIn() {
  window.location.assign(
    `/auth/login?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`,
  );
}

/**
 * The flagged officers card (spec 02 FE-7): officers missing from the latest complete import,
 * with a checkbox each for the reporting officer, "Select all on page", and a bulk bar to
 * confirm exits or mark them as still employed. "Load more" appends the next page; select all
 * covers the officers on show.
 */
export function FlaggedList({
  slug,
  result,
  loadPage,
  recordLink,
  emptyAction,
  readOnly,
}: FlaggedListProps) {
  const router = useRouter();
  const { toast } = useToast();
  const regionRef = useRef<HTMLDivElement>(null);
  const [selection, dispatch] = useReducer(selectionReducer, []);
  const [loaded, setLoaded] = useState<LoadedPages<RosterRecordListItem> | null>(
    result?.ok ? result.data : null,
  );
  const [shownResult, setShownResult] = useState(result);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const [keeping, setKeeping] = useState(false);
  /** The officers in the open confirm exits dialog, as they were when it opened. */
  const [exiting, setExiting] = useState<readonly ExitingOfficer[] | null>(null);
  /** The dialog closed after its action: focus the list, since the bulk bar is gone. */
  const focusListOnClose = useRef(false);

  // A new first page (a reload after an action, or the route's loader): start the list again,
  // keeping the selection of officers who are still flagged.
  if (result !== shownResult) {
    setShownResult(result);
    setLoaded(result?.ok ? result.data : null);
    setMoreFailed(false);
    if (result?.ok) dispatch({ type: 'retain', ids: result.data.items.map((item) => item.id) });
  }

  const focusList = () => {
    requestAnimationFrame(() => regionRef.current?.focus());
  };

  /** The list changed on the directory: reload it and the summary, and put focus on the list. */
  const settled = () => {
    dispatch({ type: 'clear' });
    void router.invalidate();
    focusList();
  };

  const selected = loaded ? loaded.items.filter((item) => selection.includes(item.id)) : [];

  const keep = async () => {
    if (keeping || selected.length === 0) return;
    setKeeping(true);
    const outcome = await keepRosterRecords({
      data: {
        slug,
        idempotencyKey: crypto.randomUUID(),
        recordIds: selected.map((item) => item.id),
      },
    }).catch(() => unavailable);
    setKeeping(false);
    if (outcome.ok) {
      toast({ title: m.keptToast(outcome.data.count) });
      settled();
      return;
    }
    const failure = keepFailure(outcome.error);
    if (failure.kind === 'sign-in') signIn();
    else toast({ title: failure.message, urgency: 'assertive' });
  };

  const more = async () => {
    if (!loaded?.nextCursor || loadingMore) return;
    setLoadingMore(true);
    setMoreFailed(false);
    const page = await loadPage(loaded.nextCursor).catch(
      (): DirectoryResult<RosterRecordPage> => unavailable,
    );
    setLoadingMore(false);
    if (!page.ok && page.error.kind === 'unauthenticated') {
      signIn();
      return;
    }
    if (page.ok) setLoaded((current) => (current ? appendPage(current, page.data) : page.data));
    else setMoreFailed(true);
  };

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

  let body: ReactNode;
  if (result === null) {
    body = <FlaggedTableSkeleton readOnly={readOnly} />;
  } else if (!result.ok || loaded === null) {
    const error = result.ok ? null : result.error;
    const detail =
      (error?.kind === 'unavailable' ? error.detail : null) ??
      (error?.kind === 'problem' ? error.problem.detail : undefined) ??
      m.errorDetail;
    body = (
      <div className="p-5">
        <LoadError title={m.flaggedErrorTitle} detail={detail} retryLabel={m.tryAgain} />
      </div>
    );
  } else if (loaded.items.length === 0) {
    body = (
      <EmptyState
        icon={<Icon icon={UserCheck01Icon} />}
        title={m.flaggedEmptyTitle}
        description={m.flaggedEmptyText}
        action={emptyAction}
      />
    );
  } else {
    const names = new Map(loaded.items.map((item) => [item.id, item.fullName]));
    body = (
      <>
        {readOnly || selected.length === 0 ? null : (
          <BulkBar
            count={selected.length}
            keeping={keeping}
            onConfirmExits={() => {
              setExiting(
                selected.map(({ id, fullName, personnelFileNumber }) => ({
                  id,
                  fullName,
                  personnelFileNumber,
                })),
              );
            }}
            onKeep={() => void keep()}
            onClear={() => {
              dispatch({ type: 'clear' });
            }}
          />
        )}
        <div className="hidden min-[760px]:block">
          <DataTable
            caption={m.flaggedCaption}
            columns={columns(recordLink)}
            rows={loaded.items}
            getRowId={(item) => item.id}
            selection={
              readOnly
                ? undefined
                : {
                    selected: new Set(selection),
                    onChange: (ids) => {
                      dispatch({ type: 'set', ids });
                    },
                    rowLabel: (id) => m.selectOfficer(names.get(id) ?? id),
                    summary: m.selectedCount,
                  }
            }
          />
        </div>
        <div className="min-[760px]:hidden">
          <FlaggedCards
            items={loaded.items}
            recordLink={recordLink}
            selection={readOnly ? null : selection}
            onSelectionChange={(ids) => {
              dispatch({ type: 'set', ids });
            }}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t px-4 py-2.5 text-[13.5px] text-muted-foreground">
          <span aria-live="polite" className="mr-auto">
            {loaded.nextCursor
              ? m.flaggedShown(loaded.items.length)
              : m.flaggedAllShown(loaded.items.length)}
          </span>
          {moreFailed ? (
            <span role="alert" className="text-destructive">
              {m.flaggedLoadMoreError}
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

  return (
    <>
      <Card
        ref={regionRef}
        role="region"
        aria-label={m.flaggedTitlePage}
        tabIndex={-1}
        // No overflow clipping here: it would stop the bulk bar sticking under the top bar.
        className="gap-0 p-0 outline-none sm:p-0"
      >
        {body}
      </Card>
      <Dialog
        open={exiting !== null}
        onOpenChange={(open) => {
          if (!open) setExiting(null);
        }}
      >
        {exiting ? (
          <ConfirmExitsDialogContent
            slug={slug}
            officers={exiting}
            onConfirmed={(exits) => {
              focusListOnClose.current = true;
              setExiting(null);
              toast({ title: m.exitsRecorded(exits.count) });
              settled();
            }}
            onStale={(message) => {
              focusListOnClose.current = true;
              setExiting(null);
              toast({ title: message, urgency: 'assertive' });
              void router.invalidate();
            }}
            onCloseAutoFocus={(event) => {
              if (focusListOnClose.current) {
                focusListOnClose.current = false;
                event.preventDefault();
                regionRef.current?.focus();
              }
            }}
          />
        ) : null}
      </Dialog>
    </>
  );
}

/** The kit's `.bulkbar`: a dark bar over the table that sticks under the top bar. */
function BulkBar({
  count,
  keeping,
  onConfirmExits,
  onKeep,
  onClear,
}: {
  count: number;
  keeping: boolean;
  onConfirmExits: () => void;
  onKeep: () => void;
  onClear: () => void;
}) {
  return (
    <div
      role="region"
      aria-label={m.bulkActions}
      className="sticky top-[68px] z-10 mx-4 mt-3 mb-1 flex flex-wrap items-center gap-2.5 rounded-xl bg-foreground px-4 py-2.5 text-sm text-background"
    >
      <p className="mr-auto font-semibold">{m.selectedCount(count)}</p>
      {/* On a narrow screen the actions take a row of their own under the count and Clear. */}
      <div className="order-last flex w-full flex-wrap gap-2.5 min-[640px]:order-none min-[640px]:w-auto">
        <Button
          size="sm"
          className="h-[34px] bg-background text-foreground shadow-none hover:bg-background/90"
          onClick={onConfirmExits}
          disabled={keeping}
        >
          <Icon icon={Logout03Icon} />
          {m.confirmExits}
        </Button>
        <Button
          size="sm"
          className="h-[34px] bg-background/15 text-background shadow-none hover:bg-background/25"
          onClick={onKeep}
          disabled={keeping}
          aria-busy={keeping || undefined}
        >
          <Icon
            icon={keeping ? Loading03Icon : UserCheck01Icon}
            className={keeping ? 'animate-spin' : undefined}
          />
          {keeping ? m.markingStillEmployed : m.stillEmployed}
        </Button>
      </div>
      <Button
        size="sm"
        variant="ghost"
        className="h-[34px] text-background/80 hover:bg-background/10 hover:text-background"
        onClick={onClear}
        disabled={keeping}
      >
        {m.clear}
      </Button>
    </div>
  );
}

/**
 * Below 760px the table becomes a list of cards (the prototype's `.table.cards`), each with its
 * checkbox, and "Select all on page" above them.
 */
function FlaggedCards({
  items,
  recordLink,
  selection,
  onSelectionChange,
}: {
  items: readonly RosterRecordListItem[];
  recordLink: FlaggedListProps['recordLink'];
  /** The selected ids; null for commission admins, who cannot select. */
  selection: Selection | null;
  onSelectionChange: (ids: Set<string>) => void;
}) {
  const ids = items.map((item) => item.id);
  const selected = new Set(selection ?? []);
  const onPage = ids.filter((id) => selected.has(id)).length;
  const toggle = (targets: readonly string[], checked: boolean) => {
    const next = new Set(selected);
    for (const id of targets) {
      if (checked) next.add(id);
      else next.delete(id);
    }
    onSelectionChange(next);
  };
  return (
    <>
      {selection ? (
        <label className="flex cursor-pointer items-center gap-3 border-b px-4 py-2.5 text-[13px] font-medium text-muted-foreground">
          <SelectAllOnPage
            checked={onPage > 0 && onPage === ids.length}
            indeterminate={onPage > 0 && onPage < ids.length}
            onChange={(checked) => {
              toggle(ids, checked);
            }}
          />
          {m.selectAllOnPage}
        </label>
      ) : null}
      <ul aria-label={m.flaggedCaption}>
        {items.map((record) => {
          const isSelected = selected.has(record.id);
          return (
            <li
              key={record.id}
              data-state={isSelected ? 'selected' : undefined}
              className="flex gap-3 border-b px-4 py-3.5 last:border-b-0 data-[state=selected]:bg-brand-faint"
            >
              {selection ? (
                <Checkbox
                  aria-label={m.selectOfficer(record.fullName)}
                  checked={isSelected}
                  onChange={(event) => {
                    toggle([record.id], event.target.checked);
                  }}
                  className="mt-0.5"
                />
              ) : null}
              <div className="grid min-w-0 flex-1 gap-1.5">
                <p className="leading-snug">{nameLink(recordLink, record)}</p>
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
                  <span className="font-mono text-[13px] whitespace-nowrap">
                    {record.personnelFileNumber}
                  </span>
                  <span>
                    <MaskedNationalId value={record.nationalIdMasked} />
                  </span>
                  {record.flaggedAt ? (
                    <span>{m.flaggedOn(formatDate(record.flaggedAt))}</span>
                  ) : null}
                </p>
                <span>
                  <RecordStateBadge state={record.state} />
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      {selection ? (
        <div role="status" className="sr-only">
          {m.selectedCount(selected.size)}
        </div>
      ) : null}
    </>
  );
}

function SelectAllOnPage({
  checked,
  indeterminate,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: (checked: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  // Mixed has no HTML attribute; set the DOM property after every render, as clicking clears it.
  useLayoutEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  });
  return (
    <Checkbox
      ref={ref}
      checked={checked}
      onChange={(event) => {
        onChange(event.target.checked);
      }}
    />
  );
}

/** The record's name as a link, styled like the kit's `.link`. */
function nameLink(recordLink: FlaggedListProps['recordLink'], record: RosterRecordListItem) {
  return <span className={NAME_LINK}>{recordLink(record)}</span>;
}

const NAME_LINK =
  'font-medium underline decoration-input underline-offset-[3px] hover:decoration-foreground [&_a]:rounded-sm [&_a]:outline-none [&_a]:focus-visible:outline-2 [&_a]:focus-visible:outline-offset-2 [&_a]:focus-visible:outline-ring';

function Optional({ value }: { value: string | null | undefined }) {
  return value ? <>{value}</> : <span className="text-muted-foreground">{m.noValue}</span>;
}

function columns(
  recordLink: FlaggedListProps['recordLink'],
): DataTableColumn<RosterRecordListItem>[] {
  return [
    {
      id: 'file-number',
      header: m.columnFileNumber,
      cell: (record) => (
        <span className="font-mono text-[13px] whitespace-nowrap">
          {record.personnelFileNumber}
        </span>
      ),
    },
    {
      id: 'name',
      header: m.columnFullName,
      rowHeader: true,
      className: 'min-w-[180px] font-normal',
      cell: (record) => nameLink(recordLink, record),
    },
    {
      id: 'national-id',
      header: m.columnNationalId,
      className: 'whitespace-nowrap',
      cell: (record) => <MaskedNationalId value={record.nationalIdMasked} />,
    },
    {
      id: 'designation',
      header: m.columnDesignation,
      cell: (record) => (
        <span className="block max-w-[180px] truncate" title={record.designation ?? undefined}>
          <Optional value={record.designation} />
        </span>
      ),
    },
    {
      id: 'reporting-entity',
      header: m.columnReportingEntity,
      cell: (record) => (
        <span
          className="block max-w-[200px] truncate"
          title={record.reportingEntity?.name ?? undefined}
        >
          <Optional value={record.reportingEntity?.name} />
        </span>
      ),
    },
    {
      id: 'state',
      header: m.columnState,
      cell: (record) => <RecordStateBadge state={record.state} />,
    },
    {
      id: 'flagged-in',
      header: m.columnFlaggedIn,
      className: 'whitespace-nowrap',
      cell: (record) =>
        record.flaggedAt ? (
          <time dateTime={record.flaggedAt}>{formatDate(record.flaggedAt)}</time>
        ) : (
          <Optional value={null} />
        ),
    },
  ];
}

const SKELETON_WIDTHS = [
  'w-[110px]',
  'w-[150px]',
  'w-[70px]',
  'w-[120px]',
  'w-[160px]',
  'w-[90px]',
  'w-[80px]',
];

/** Placeholder rows under the real header while the first page loads; the table is marked busy. */
export function FlaggedTableSkeleton({ readOnly }: { readOnly: boolean }) {
  const headers = [
    m.columnFileNumber,
    m.columnFullName,
    m.columnNationalId,
    m.columnDesignation,
    m.columnReportingEntity,
    m.columnState,
    m.columnFlaggedIn,
  ];
  return (
    <Table caption={m.flaggedLoadingCaption} aria-busy="true">
      <TableHeader>
        <TableRow>
          {readOnly ? null : <TableHead className="w-9 pr-0" aria-hidden="true" />}
          {headers.map((header) => (
            <TableHead key={header}>{header}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {Array.from({ length: 6 }, (_, row) => (
          <TableRow key={row}>
            {readOnly ? null : (
              <TableCell className="w-9 pr-0">
                <Skeleton className="size-[18px]" />
              </TableCell>
            )}
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
