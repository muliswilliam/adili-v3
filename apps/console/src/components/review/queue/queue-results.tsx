import {
  AssigneeChip,
  Badge,
  Button,
  cn,
  EmptyState,
  focusRing,
  formatDate,
  Icon,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  PriorityBadge,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableRowLink,
  Tooltip,
} from '@adili/ui';
import {
  Alert02Icon,
  ArrowLeftRightIcon,
  InboxIcon,
  InformationCircleIcon,
  MailReply01Icon,
  MoreVerticalIcon,
  Search01Icon,
  UserRemove01Icon,
  WifiOff02Icon,
} from '@hugeicons/core-free-icons';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';

import { CASE_COPY } from '../../../review-case/messages';
import type { AssignmentAction, CaseViewer } from '../../../review-case/case';
import { QUEUE_COPY as m } from '../../../review-queue/messages';
import { hasQueueFilters, type QueueSearch } from '../../../review-queue/query';
import { clarificationCell, rowAction, rowMenu } from '../../../review-queue/rows';
import type { QueuePage } from '../../../server/review-queue';
import type { CaseListItem } from '../../../server/review/types';
import { SERVICE_UNAVAILABLE, type ServiceResult } from '../../../server/service-call';
import { LoadError } from '../../load-error';
import { appendPage, type LoadedPages } from '../../roster/records-query';
import { goToSignIn } from '../../sign-in-redirect';

/**
 * Where the list switches from cards to the table: 1120px of list fits the eight columns. The
 * results and their skeleton share these, so loading never changes the layout.
 */
export const TABLE_ONLY = 'hidden @[1120px]:block';
export const CARDS_ONLY = '@[1120px]:hidden';

export interface QueueResultsProps {
  /** The first page for `search`. */
  result: ServiceResult<QueuePage>;
  search: QueueSearch;
  onSearchChange: (next: QueueSearch) => void;
  viewer: CaseViewer;
  /** The page after `cursor` for the same filters, for "Load more". */
  loadPage: (cursor: string) => Promise<ServiceResult<QueuePage>>;
  /** Claim, or a supervisor's Reassign, Assign or Unassign. */
  onAction: (action: AssignmentAction, item: CaseListItem) => void;
}

/**
 * The queue's cases, highest priority first then oldest (spec 07a FE-2): a table where the list
 * is wide enough, cards below 1120px of list; "Load more" for the next page; and the empty, no
 * matches and error states. Each row opens its case; Claim, Open or View and a supervisor's menu
 * sit above the row's link.
 */
export function QueueResults(props: QueueResultsProps) {
  const { result, search, onSearchChange, loadPage } = props;
  const [loaded, setLoaded] = useState<LoadedPages<CaseListItem> | null>(
    result.ok ? result.data : null,
  );
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);

  if (!result.ok || loaded === null) {
    return (
      <div className="p-5">
        <LoadError title={m.errorTitle} detail={m.errorDetail} retryLabel={m.retry} />
      </div>
    );
  }

  if (loaded.items.length === 0) {
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
              onSearchChange({});
            }}
          >
            {m.clear}
          </Button>
        }
      />
    ) : (
      <EmptyState icon={<Icon icon={InboxIcon} />} title={m.emptyTitle} description={m.emptyText} />
    );
  }

  const more = async () => {
    if (!loaded.nextCursor || loadingMore) return;
    setLoadingMore(true);
    setMoreFailed(false);
    const page: ServiceResult<QueuePage> = await loadPage(loaded.nextCursor).catch(
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
      <div className={TABLE_ONLY}>
        <QueueTable {...props} items={loaded.items} />
      </div>
      <div className={CARDS_ONLY}>
        <QueueCards {...props} items={loaded.items} />
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

type RowsProps = QueueResultsProps & { items: readonly CaseListItem[] };

function CaseLink({ item }: { item: CaseListItem }) {
  return (
    <TableRowLink asChild>
      <Link
        to="/review/cases/$caseId"
        params={{ caseId: item.id }}
        className="font-mono text-[13px] font-semibold tracking-[-0.01em] whitespace-nowrap"
      >
        {item.reference}
      </Link>
    </TableRowLink>
  );
}

/** Spec 07b: a registry could not be checked for someone on the case at its latest check. */
function RegistryIcon({ item }: { item: CaseListItem }) {
  if (!item.registryUnavailable) return null;
  return (
    <Tooltip content={m.registryIcon}>
      <span
        role="img"
        tabIndex={0}
        aria-label={m.registryIcon}
        className={cn(
          'relative z-10 ml-1.5 inline-flex rounded-sm align-[-3px] text-warning',
          focusRing,
        )}
      >
        <Icon icon={WifiOff02Icon} className="size-4" />
      </span>
    </Tooltip>
  );
}

function TypeCycle({ item }: { item: CaseListItem }) {
  return <>{m.typeCycle(CASE_COPY.type[item.type], item.cycleYear)}</>;
}

function Clarification({ item }: { item: CaseListItem }) {
  const cell = clarificationCell(item);
  switch (cell.kind) {
    case 'none':
      return <span className="text-muted-foreground">{m.clarification.none}</span>;
    case 'draft':
      return <span className="text-muted-foreground">{m.clarification.draft}</span>;
    case 'overdue':
      return (
        <Badge variant="destructive">
          <Icon icon={Alert02Icon} />
          {m.clarification.overdue}
        </Badge>
      );
    case 'responded':
      return (
        <Badge variant="brand">
          <Icon icon={MailReply01Icon} />
          {m.clarification.responded}
        </Badge>
      );
    case 'open':
      return (
        <span className="whitespace-nowrap">
          {cell.dueAt ? m.clarification.open(cell.dueAt) : m.clarification.openUndated}
        </span>
      );
  }
}

const MENU_ITEMS: Record<
  'reassign' | 'assign' | 'unassign',
  { label: string; icon: typeof ArrowLeftRightIcon }
> = {
  reassign: { label: CASE_COPY.reassign, icon: ArrowLeftRightIcon },
  assign: { label: CASE_COPY.assign, icon: ArrowLeftRightIcon },
  unassign: { label: CASE_COPY.unassign, icon: UserRemove01Icon },
};

function RowActions({ item, viewer, onAction }: RowsProps & { item: CaseListItem }) {
  const action = rowAction(item, viewer);
  const menu = rowMenu(item, viewer).filter(
    (each): each is keyof typeof MENU_ITEMS => each in MENU_ITEMS,
  );
  return (
    <div className="relative z-10 flex items-center justify-end gap-1">
      {action === 'claim' ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            onAction('claim', item);
          }}
        >
          {m.claim}
        </Button>
      ) : (
        <Button asChild variant={action === 'open' ? 'secondary' : 'ghost'} size="sm">
          <Link to="/review/cases/$caseId" params={{ caseId: item.id }} tabIndex={-1}>
            {action === 'open' ? m.open : m.view}
          </Link>
        </Button>
      )}
      {menu.length > 0 ? (
        <Menu>
          <MenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 [&_svg]:size-4.5"
              aria-label={m.moreActions(item.declarantName)}
            >
              <Icon icon={MoreVerticalIcon} />
            </Button>
          </MenuTrigger>
          <MenuContent>
            {menu.map((each) => (
              <MenuItem
                key={each}
                icon={MENU_ITEMS[each].icon}
                onSelect={() => {
                  onAction(each, item);
                }}
              >
                {MENU_ITEMS[each].label}
              </MenuItem>
            ))}
          </MenuContent>
        </Menu>
      ) : null}
    </div>
  );
}

function Header() {
  return (
    <TableHeader>
      <TableRow>
        <TableHead>{m.columns.reference}</TableHead>
        <TableHead>{m.columns.declarant}</TableHead>
        <TableHead>{m.columns.received}</TableHead>
        <TableHead>
          <span className="inline-flex items-center gap-1">
            {m.columns.priority}
            <Tooltip content={m.priorityTip}>
              <span
                tabIndex={0}
                aria-label={m.priorityTipLabel}
                className={cn('inline-flex rounded-sm', focusRing)}
              >
                <Icon icon={InformationCircleIcon} className="size-3.5" />
              </span>
            </Tooltip>
          </span>
        </TableHead>
        <TableHead className="text-right">{m.columns.flags}</TableHead>
        <TableHead>{m.columns.assignee}</TableHead>
        <TableHead>{m.columns.clarification}</TableHead>
        <TableHead>
          <span className="sr-only">{m.columns.actions}</span>
        </TableHead>
      </TableRow>
    </TableHeader>
  );
}

function QueueTable(props: RowsProps) {
  const { items, viewer } = props;
  return (
    <Table caption={m.caption}>
      <Header />
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.id}>
            <TableHead scope="row" className="font-normal whitespace-nowrap">
              <CaseLink item={item} />
              <RegistryIcon item={item} />
              <span className="mt-0.5 block text-[12.5px] text-muted-foreground">
                <TypeCycle item={item} />
              </span>
            </TableHead>
            <TableCell>
              <span className="block font-medium">{item.declarantName}</span>
              <span className="block text-[12.5px] whitespace-nowrap text-muted-foreground">
                {m.fileNumber(item.personnelFileNumber)}
              </span>
            </TableCell>
            <TableCell className="whitespace-nowrap tabular-nums">
              {formatDate(item.receivedAt)}
              {item.late ? (
                <span className="mt-1 block">
                  <Badge variant="warning">{m.lateFiling}</Badge>
                </span>
              ) : null}
            </TableCell>
            <TableCell>
              <PriorityBadge band={item.band} className="relative z-10" />
            </TableCell>
            <TableCell className="text-right tabular-nums">{item.openFlags}</TableCell>
            <TableCell className="whitespace-nowrap">
              <AssigneeChip compact assignee={item.assignee} viewerSubject={viewer.subject} />
            </TableCell>
            <TableCell>
              <Clarification item={item} />
            </TableCell>
            <TableCell>
              <RowActions {...props} item={item} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Below 1120px of list the eight columns do not fit: a card per case (the prototype's `.qcard`). */
function QueueCards(props: RowsProps) {
  const { items, viewer } = props;
  return (
    <ul aria-label={m.caption}>
      {items.map((item) => (
        <li
          key={item.id}
          className="relative flex flex-col gap-2 border-b px-4 py-3.5 transition-colors last:border-b-0 has-[[data-row-link]:hover]:bg-muted/50"
        >
          <div className="flex items-center gap-2">
            <span className="min-w-0">
              <CaseLink item={item} />
              <RegistryIcon item={item} />
            </span>
            <PriorityBadge band={item.band} className="relative z-10 ml-auto" />
          </div>
          <div>
            <p className="font-semibold">{item.declarantName}</p>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
              <span>{m.fileNumber(item.personnelFileNumber)}</span>
              <span>{m.typeCycleShort(CASE_COPY.type[item.type], item.cycleYear)}</span>
              <span>{m.receivedOn(item.receivedAt)}</span>
              {item.late ? <Badge variant="warning">{m.lateShort}</Badge> : null}
            </p>
          </div>
          <div className="flex items-center gap-2 text-[13px]">
            <AssigneeChip compact assignee={item.assignee} viewerSubject={viewer.subject} />
            <span className="text-muted-foreground">· {m.flagCount(item.openFlags)}</span>
          </div>
          <div className="flex items-center gap-2 text-[13px]">
            <span className="text-muted-foreground">{m.clarificationShort}</span>
            <Clarification item={item} />
            <span className="ml-auto">
              <RowActions {...props} item={item} />
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

const SKELETON_WIDTHS = ['w-44', 'w-36', 'w-22', 'w-18', 'w-6', 'w-28', 'w-24', 'w-16'];

/** The list while its first page loads: the table's or the cards' placeholders, as the list will be. */
export function QueueResultsSkeleton() {
  return (
    <>
      <div className={TABLE_ONLY}>
        <QueueTableSkeleton />
      </div>
      <ul aria-busy="true" aria-label={m.loadingCaption} className={CARDS_ONLY}>
        {Array.from({ length: 4 }, (_, index) => (
          <li key={index} className="flex flex-col gap-2.5 border-b px-4 py-4 last:border-b-0">
            <Skeleton className="w-48" />
            <Skeleton className="w-40" />
            <Skeleton className="w-64 max-w-full" />
          </li>
        ))}
      </ul>
    </>
  );
}

/** Placeholder rows under the real header while the first page loads; the table is marked busy. */
function QueueTableSkeleton() {
  return (
    <Table caption={m.loadingCaption} aria-busy="true">
      <Header />
      <TableBody>
        {Array.from({ length: 8 }, (_, row) => (
          <TableRow key={row}>
            {SKELETON_WIDTHS.map((width, column) => (
              <TableCell key={column} className="py-4">
                <Skeleton className={width} />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
