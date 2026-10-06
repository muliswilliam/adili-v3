import {
  Alert,
  AlertDescription,
  Button,
  Card,
  cn,
  EmptyState,
  formatDate,
  formatTime,
  Icon,
  type IconProps,
  Select,
  SelectItem,
  Skeleton,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
} from '@adili/ui';
import {
  Calendar03Icon,
  Clock01Icon,
  InformationCircleIcon,
  MinusSignIcon,
  PencilEdit02Icon,
  RefreshIcon,
  Search01Icon,
  Tick02Icon,
  UserGroupIcon,
} from '@hugeicons/core-free-icons';
import { type ReactNode, useId } from 'react';

import type {
  DeclarationProgress,
  DeclarationsResult,
  ProgressCounts,
  ProgressRow,
} from '../../server/declarations/client';
import { CursorPager } from '../cursor-pager';
import { formatNumber } from '../format';
import { InfoTip } from '../info-tip';
import { LoadError } from '../load-error';
import { problemStatus } from '../../server/service-call';
import { Page, PageHead } from '../page';
import { SearchBox } from '../search-box';
import { cycleLabel } from '../obligations/obligations-query';
import {
  hasProgress,
  matchingRows,
  obligationTotal,
  PROGRESS_KEYS,
  PROGRESS_SEARCH_MAX,
  progressCycles,
  progressPage,
  type ProgressSearch,
  progressTotals,
  shareLabel,
} from './declaration-progress';
import { messages as obligationsMessages } from '../obligations/messages';
import { messages as m } from './messages';
import { Tile, TileValue, WARNING_TILE } from './tile';

export interface CoverageViewProps {
  /** The counts for the cycle in `search`; null while they load. */
  result: DeclarationsResult<DeclarationProgress> | null;
  search: ProgressSearch;
  onSearchChange: (next: ProgressSearch) => void;
  /** When the counts on show were read (ISO date-time); null while they load. */
  loadedAt: string | null;
  /** Whether the counts on show are being read again. */
  refreshing: boolean;
  onRefresh: () => void;
  /** The Commission has no roster yet: there is nothing to count. */
  noRoster?: boolean;
  /** Offered with no roster, e.g. "Import roster". */
  noRosterAction?: ReactNode;
}

/**
 * Roster coverage (#301): a cycle's obligations per reporting entity, not started, in progress,
 * submitted and late, with totals, as the declarations service counts them (#300). Counts only:
 * no declarant, no draft content.
 */
export function CoverageView(props: CoverageViewProps) {
  const { result, search, onSearchChange } = props;
  if (problemStatus(result) === 404) {
    return (
      <Page narrow>
        <PageHead title={m.coverageTitle} />
        <Card className="p-2 sm:p-2">
          <EmptyState
            icon={<Icon icon={Search01Icon} />}
            title={m.coverageNotFoundTitle}
            description={m.coverageNotFoundText}
          />
        </Card>
      </Page>
    );
  }
  if (props.noRoster) {
    return (
      <Page>
        <PageHead title={m.coverageTitle} />
        <Card className="p-2 sm:p-2">
          <EmptyState
            icon={<Icon icon={UserGroupIcon} />}
            title={m.noneTitle}
            description={m.coverageNoRosterText}
            action={props.noRosterAction}
          />
        </Card>
      </Page>
    );
  }
  const progress = result?.ok ? result.data : null;
  return (
    <Page>
      <PageHead
        title={m.coverageTitle}
        actions={
          result && !result.ok ? null : (
            <CoverageActions
              progress={progress}
              loadedAt={props.loadedAt}
              refreshing={props.refreshing}
              onRefresh={props.onRefresh}
              onCycleChange={(cycle) => {
                onSearchChange({ cycle });
              }}
            />
          )
        }
      />
      {result && !result.ok ? (
        <LoadError
          title={m.coverageErrorTitle}
          detail={
            result.error.kind === 'unavailable' && result.error.detail
              ? result.error.detail
              : m.errorDetail
          }
          retryLabel={m.tryAgain}
        />
      ) : (
        <div className="flex flex-col gap-4">
          {/* With nothing counted, the empty state says when the cycle opens. */}
          {progress && !progress.cycle.opened && hasProgress(progress) ? (
            <Alert variant="info" role="status">
              <Icon icon={InformationCircleIcon} />
              <AlertDescription>
                {obligationsMessages.cycleNotOpenNotice(
                  cycleLabel(progress.cycle.key),
                  formatDate(progress.cycle.opensOn),
                )}
              </AlertDescription>
            </Alert>
          ) : null}
          {progress && !hasProgress(progress) ? (
            <Card className="p-2 sm:p-2">
              <EmptyState
                icon={<Icon icon={Calendar03Icon} />}
                title={m.coverageEmptyTitle(cycleLabel(progress.cycle.key))}
                description={
                  progress.cycle.opened
                    ? m.coverageEmptyText
                    : m.coverageEmptyNotOpen(formatDate(progress.cycle.opensOn))
                }
              />
            </Card>
          ) : (
            <>
              <ProgressTiles counts={progress?.total ?? null} />
              <Card className="@container gap-0 overflow-hidden p-0 sm:p-0">
                <Toolbar
                  search={search}
                  disabled={progress === null}
                  onSearch={(text) => {
                    onSearchChange({ cycle: search.cycle, search: text || undefined });
                  }}
                />
                {progress === null ? (
                  <CoverageSkeleton />
                ) : (
                  <CoverageTable
                    progress={progress}
                    search={search}
                    onSearchChange={onSearchChange}
                  />
                )}
              </Card>
            </>
          )}
        </div>
      )}
    </Page>
  );
}

/** The cycle select, then when the counts were read and a way to read them again. */
function CoverageActions({
  progress,
  loadedAt,
  refreshing,
  onRefresh,
  onCycleChange,
}: {
  progress: DeclarationProgress | null;
  loadedAt: string | null;
  refreshing: boolean;
  onRefresh: () => void;
  onCycleChange: (cycle: string) => void;
}) {
  const id = useId();
  if (!progress) return <Skeleton className="h-10 w-60" />;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <label htmlFor={`${id}-cycle`} className="sr-only">
        {m.coverageCycle}
      </label>
      <Select
        id={`${id}-cycle`}
        value={progress.cycle.key}
        onValueChange={(cycle) => {
          if (cycle !== progress.cycle.key) onCycleChange(cycle);
        }}
        className="h-10 w-auto min-w-60 text-sm"
      >
        {progressCycles(progress).map((cycle) => (
          <SelectItem key={cycle.key} value={cycle.key}>
            {cycle.label}
          </SelectItem>
        ))}
      </Select>
      <span className="inline-flex items-center gap-1.5 text-[13px] whitespace-nowrap text-muted-foreground">
        <span aria-live="polite" className="inline-flex items-center gap-1.5">
          {refreshing ? (
            <>
              <Spinner className="size-3" />
              {m.coverageUpdating}
            </>
          ) : loadedAt ? (
            m.coverageUpdated(formatTime(loadedAt))
          ) : null}
        </span>
        <Tooltip content={m.coverageRefresh}>
          <Button
            variant="ghost"
            size="icon"
            aria-label={m.coverageRefresh}
            disabled={refreshing}
            onClick={onRefresh}
            className="size-7"
          >
            <Icon icon={RefreshIcon} className="size-3.5" />
          </Button>
        </Tooltip>
      </span>
    </div>
  );
}

interface Bucket {
  key: keyof ProgressCounts;
  label: string;
  icon: IconProps['icon'];
  hint?: string;
  /** Its share of the bar and its legend swatch; not started is the bar's track. */
  swatch: string;
}

const BUCKET: Record<Bucket['key'], Bucket> = {
  notStarted: {
    key: 'notStarted',
    label: m.coverageNotStarted,
    icon: MinusSignIcon,
    swatch: 'bg-muted ring-1 ring-border ring-inset',
  },
  inProgress: {
    key: 'inProgress',
    label: m.coverageInProgress,
    icon: PencilEdit02Icon,
    hint: m.coverageInProgressHint,
    swatch: 'bg-info',
  },
  submitted: {
    key: 'submitted',
    label: m.coverageSubmitted,
    icon: Tick02Icon,
    swatch: 'bg-success',
  },
  late: {
    key: 'late',
    label: m.coverageLate,
    icon: Clock01Icon,
    hint: m.coverageLateHint,
    swatch: 'bg-warning',
  },
};

/** The tiles' and columns' order. */
const BUCKETS = PROGRESS_KEYS.map((key) => BUCKET[key]);

/** The bar's segments, in the order they fill it; not started is what is left. */
const BAR = [BUCKET.submitted, BUCKET.inProgress, BUCKET.late];

/** The legend: the bar's segments, then the track. */
const LEGEND = [...BAR, BUCKET.notStarted];

function ProgressTiles({ counts }: { counts: ProgressCounts | null }) {
  const whole = counts ? obligationTotal(counts) : 0;
  return (
    <section
      aria-label={m.coverageCounts}
      className="grid grid-cols-2 gap-3.5 min-[760px]:grid-cols-4"
    >
      {BUCKETS.map((bucket) => {
        const value = counts?.[bucket.key] ?? 0;
        const late = bucket.key === 'late' && value > 0;
        return (
          <Tile
            key={bucket.key}
            icon={bucket.icon}
            label={bucket.label}
            hint={
              bucket.hint ? (
                <InfoTip content={bucket.hint} label={m.coverageHintLabel(bucket.label)} />
              ) : undefined
            }
            className={late ? WARNING_TILE : undefined}
          >
            {counts ? (
              <TileValue>
                {formatNumber(value)}{' '}
                <small className="text-sm font-medium tracking-normal text-muted-foreground">
                  {shareLabel(value, whole)}
                </small>
              </TileValue>
            ) : (
              <Skeleton className="mt-1 h-[26px] w-2/5" />
            )}
          </Tile>
        );
      })}
    </section>
  );
}

function Toolbar({
  search,
  disabled,
  onSearch,
}: {
  search: ProgressSearch;
  disabled: boolean;
  onSearch: (text: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3" role="search">
      <SearchBox
        id={`${id}-search`}
        label={m.coverageSearchLabel}
        placeholder={m.coverageSearchPlaceholder}
        maxLength={PROGRESS_SEARCH_MAX}
        applied={search.search ?? ''}
        disabled={disabled}
        onSearch={onSearch}
      />
      <ul
        aria-hidden="true"
        className="ml-auto flex flex-wrap gap-x-3.5 gap-y-1 text-[12.5px] text-muted-foreground"
      >
        {LEGEND.map((item) => (
          <li key={item.key} className="inline-flex items-center gap-1.5">
            <span className={cn('size-2.5 rounded-[3px]', item.swatch)} />
            {item.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The counts as one bar: submitted, in progress and late, the rest not started. */
function SharesBar({ counts }: { counts: ProgressCounts }) {
  const whole = obligationTotal(counts);
  const width = (part: number) => `${String(whole > 0 ? (part / whole) * 100 : 0)}%`;
  return (
    <div
      role="img"
      aria-label={m.coverageBarLabel(
        shareLabel(counts.submitted, whole),
        shareLabel(counts.inProgress, whole),
        shareLabel(counts.late, whole),
      )}
      className="flex h-2 min-w-[100px] overflow-hidden rounded-full bg-muted"
    >
      {BAR.map((segment) => (
        <span
          key={segment.key}
          className={cn('block h-full', segment.swatch)}
          style={{ width: width(counts[segment.key]) }}
        />
      ))}
    </div>
  );
}

function EntityName({ row }: { row: ProgressRow }) {
  return row.reportingEntity ? (
    <>{row.reportingEntity.name}</>
  ) : (
    <span className="text-muted-foreground italic">{m.coverageNoEntity}</span>
  );
}

const rowKey = (row: ProgressRow) => row.reportingEntity?.id ?? 'none';

function CoverageTable({
  progress,
  search,
  onSearchChange,
}: {
  progress: DeclarationProgress;
  search: ProgressSearch;
  onSearchChange: (next: ProgressSearch) => void;
}) {
  const rows = matchingRows(progress.reportingEntities, search.search);
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Icon icon={Search01Icon} />}
        title={m.coverageNoMatchesTitle}
        description={m.coverageNoMatchesText}
        action={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              onSearchChange(search.cycle ? { cycle: search.cycle } : {});
            }}
          >
            {m.coverageClearSearch}
          </Button>
        }
      />
    );
  }
  const page = progressPage(rows, search.page);
  const totals = progressTotals(progress, search.search);
  const totalLabel =
    totals.matching === null ? m.coverageTotal : m.coverageTotalMatching(totals.matching);
  const caption = m.coverageCaption(cycleLabel(progress.cycle.key));
  const goTo = (target: number) => {
    onSearchChange({ ...search, page: target > 1 ? target : undefined });
  };
  return (
    <>
      <div className="hidden @[760px]:block">
        <Table caption={caption}>
          <CoverageHeader />
          <TableBody>
            {page.rows.map((row) => (
              <TableRow key={rowKey(row)}>
                <TableHead scope="row" className="min-w-60 py-3 font-medium whitespace-normal">
                  <EntityName row={row} />
                </TableHead>
                <CountCells counts={row.counts} />
              </TableRow>
            ))}
          </TableBody>
          <tfoot className="border-t bg-background/60 font-semibold">
            <TableRow className="border-0">
              <TableHead scope="row" className="py-3">
                {totalLabel}
              </TableHead>
              <CountCells counts={totals.counts} total />
            </TableRow>
          </tfoot>
        </Table>
      </div>
      <div className="@[760px]:hidden">
        <ul aria-label={caption}>
          {page.rows.map((row) => (
            <li key={rowKey(row)} className="grid gap-2 border-b px-4 py-3.5">
              <NarrowCounts label={<EntityName row={row} />} counts={row.counts} />
            </li>
          ))}
        </ul>
        <div className="grid gap-2 bg-background/60 px-4 py-3.5">
          <NarrowCounts
            label={<span className="font-semibold">{totalLabel}</span>}
            counts={totals.counts}
          />
        </div>
      </div>
      {page.pages > 1 ? (
        <CursorPager
          labels={{
            pagination: m.coveragePagination,
            pageRange: (from, to) => m.coveragePageRange(from, to, rows.length),
            pageRows: m.coveragePageRows,
            previousPage: m.previousPage,
            nextPage: m.nextPage,
          }}
          range={{ from: page.from, to: page.to }}
          rows={page.rows.length}
          hasPrevious={page.page > 1}
          hasNext={page.page < page.pages}
          onPrevious={() => {
            goTo(page.page - 1);
          }}
          onNext={() => {
            goTo(page.page + 1);
          }}
        />
      ) : null}
    </>
  );
}

function CoverageHeader() {
  return (
    <TableHeader>
      <TableRow>
        <TableHead>{m.coverageEntity}</TableHead>
        <TableHead className="text-right">{m.coverageObligations}</TableHead>
        {BUCKETS.map((bucket) => (
          <TableHead key={bucket.key} className="text-right">
            {bucket.label}
          </TableHead>
        ))}
        <TableHead className="min-w-[150px]">
          <span className="sr-only">{m.coverageBar}</span>
        </TableHead>
      </TableRow>
    </TableHeader>
  );
}

function CountCells({ counts, total = false }: { counts: ProgressCounts; total?: boolean }) {
  return (
    <>
      <TableCell className="text-right tabular-nums">
        {formatNumber(obligationTotal(counts))}
      </TableCell>
      {BUCKETS.map((bucket) => {
        const value = counts[bucket.key];
        return (
          <TableCell
            key={bucket.key}
            className={cn(
              'text-right tabular-nums',
              !total && value === 0 && 'text-muted-foreground/70',
              bucket.key === 'late' && value > 0 && 'font-semibold text-warning-subtle-foreground',
            )}
          >
            {formatNumber(value)}
          </TableCell>
        );
      })}
      <TableCell>
        <SharesBar counts={counts} />
      </TableCell>
    </>
  );
}

/** One reporting entity (or the total) as a list item, for containers too narrow for the table. */
function NarrowCounts({ label, counts }: { label: ReactNode; counts: ProgressCounts }) {
  return (
    <>
      <div className="flex items-start justify-between gap-3 text-sm">
        <span className="min-w-0 font-medium">{label}</span>
        <span className="shrink-0 text-muted-foreground tabular-nums">
          {formatNumber(obligationTotal(counts))}
        </span>
      </div>
      <SharesBar counts={counts} />
      <p className="text-[13px] text-muted-foreground">
        {m.coverageCardCounts(counts.notStarted, counts.inProgress, counts.submitted)}
        {counts.late > 0 ? (
          <>
            {' · '}
            <span className="font-medium whitespace-nowrap text-warning-subtle-foreground">
              {m.coverageCardLate(counts.late)}
            </span>
          </>
        ) : null}
      </p>
    </>
  );
}

function CoverageSkeleton() {
  return (
    <Table caption={m.coverageLoadingCaption} aria-busy="true">
      <CoverageHeader />
      <TableBody>
        {Array.from({ length: 6 }, (_, row) => (
          <TableRow key={row}>
            <TableCell>
              <Skeleton className="w-60 max-w-full" />
            </TableCell>
            {Array.from({ length: 5 }, (_, column) => (
              <TableCell key={column}>
                <Skeleton className="ml-auto w-10" />
              </TableCell>
            ))}
            <TableCell>
              <Skeleton className="h-2 w-full" />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
