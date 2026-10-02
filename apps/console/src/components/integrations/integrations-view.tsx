import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  BREAKER_BADGE_MESSAGES,
  BreakerBadge,
  Button,
  Card,
  cn,
  EmptyState,
  formatDateTime,
  formatTime,
  Icon,
  type IconProps,
  Meter,
  Skeleton,
  StatTile,
  StatTileSkeleton,
  SystemStatusList,
  SystemStatusRow,
} from '@adili/ui';
import {
  Activity01Icon,
  BankIcon,
  BanIcon,
  Briefcase01Icon,
  Car01Icon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  InformationCircleIcon,
  Location01Icon,
  PauseIcon,
  PlugSocketIcon,
  RefreshIcon,
  UserIcon,
} from '@hugeicons/core-free-icons';
import type { ReactNode } from 'react';

import type {
  IntegrationGatewayResult,
  IntegrationSystem,
  SystemCoverage,
} from '../../server/integration-gateway/client';
import { formatNumber } from '../format';
import { LoadError, NoAccess } from '../load-error';
import { Page, PageHead } from '../page';
import {
  formatDuration,
  formatLastSuccess,
  formatPercent,
  isLastSuccessStale,
  summarise,
  systemInfo,
} from './coverage';
import { messages as m } from './messages';
import { PauseControl, type SetPaused } from './pause-control';

const ICONS: Partial<Record<IntegrationSystem, IconProps['icon']>> = {
  iprs: UserIcon,
  kra: BankIcon,
  ntsa: Car01Icon,
  brs: Briefcase01Icon,
  ardhisasa: Location01Icon,
};

const TILES = 'grid grid-cols-2 gap-3 min-[980px]:grid-cols-4';

export interface IntegrationsViewProps {
  /** Coverage; null while it loads. */
  result: IntegrationGatewayResult<SystemCoverage[]> | null;
  /** When the coverage was read (ISO); null while it loads. */
  loadedAt: string | null;
  /** Reads the coverage again. */
  onRefresh: () => void;
  /** A refresh is running. */
  refreshing?: boolean;
  /** Offered to staff refused the page (403). */
  forbiddenAction?: ReactNode;
  /** Pauses or resumes a system; without it there are no Pause and Resume buttons. */
  setPaused?: SetPaused;
  /** A system was paused or resumed: read the coverage again. */
  onChanged?: () => void;
  /** For tests. */
  now?: Date;
}

/**
 * How each registry integration behaves (spec 07b FE-3, S13 read): calls in the last 24 hours,
 * cache hit rate, breaker, last success and paused, with the configured limits on expanding a
 * system, and Pause and Resume with a confirm dialog (S13). Platform administrators only.
 */
export function IntegrationsView({
  result,
  loadedAt,
  onRefresh,
  refreshing = false,
  forbiddenAction,
  setPaused,
  onChanged = () => undefined,
  now = new Date(),
}: IntegrationsViewProps) {
  if (
    result &&
    !result.ok &&
    result.error.kind === 'problem' &&
    result.error.problem.status === 403
  ) {
    return (
      <Page narrow>
        <PageHead title={m.title} />
        <NoAccess text={m.forbidden} action={forbiddenAction} />
      </Page>
    );
  }
  const busy = result === null || refreshing;
  return (
    <Page>
      <PageHead
        title={m.title}
        actions={
          <>
            {loadedAt && result?.ok ? (
              <span className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
                <Icon icon={Clock01Icon} className="size-3.5" />
                {m.updatedAt(formatTime(loadedAt))}
              </span>
            ) : null}
            <Button variant="secondary" size="sm" onClick={onRefresh} disabled={busy}>
              <Icon
                icon={RefreshIcon}
                className={cn(busy && 'animate-spin motion-reduce:animate-none')}
              />
              {m.refresh}
            </Button>
          </>
        }
      />
      {result === null ? (
        <CoverageSkeleton />
      ) : !result.ok ? (
        <LoadError title={m.errorTitle} detail={m.errorDetail} retryLabel={m.tryAgain} />
      ) : result.data.length === 0 ? (
        <Card className="p-0 sm:p-0">
          <EmptyState
            icon={<Icon icon={PlugSocketIcon} />}
            title={m.emptyTitle}
            description={m.emptyText}
          />
        </Card>
      ) : (
        <Coverage
          rows={result.data}
          now={now}
          pauseAction={
            setPaused
              ? (row) => <PauseControl row={row} setPaused={setPaused} onChanged={onChanged} />
              : undefined
          }
        />
      )}
    </Page>
  );
}

function Coverage({
  rows,
  now,
  pauseAction,
}: {
  rows: SystemCoverage[];
  now: Date;
  pauseAction: ((row: SystemCoverage) => ReactNode) | undefined;
}) {
  const summary = summarise(rows);
  return (
    <div className="flex flex-col gap-[18px]">
      <div role="group" aria-label={m.summaryLabel} className={TILES}>
        <StatTile
          label={m.callsTile}
          value={summary.calls24h}
          description={m.callsAcross(rows.length)}
        />
        <StatTile
          label={m.hitRateTile}
          value={summary.cacheHitRate}
          // Without calls there is no rate: 0% would read as a cache that never hits.
          format={summary.calls24h > 0 ? formatPercent : () => m.noCalls}
          description={summary.calls24h > 0 ? m.hitRateHint : m.noCallsHint}
        />
        <StatTile
          label={m.openTile}
          value={summary.open.length}
          tone={summary.open.length > 0 ? 'warning' : 'default'}
          marker={
            summary.open.length > 0 ? (
              <span aria-hidden="true" className="size-2 rounded-full bg-destructive" />
            ) : undefined
          }
          description={m.halfOpenCount(summary.halfOpen.length)}
        />
        <StatTile
          label={m.pausedTile}
          value={summary.paused.length}
          description={
            summary.paused.length > 0
              ? summary.paused.map((row) => systemInfo(row.system).name).join(', ')
              : m.noneHint
          }
        />
      </div>
      <Alerts rows={rows} now={now} />
      <div className="flex flex-col gap-3.5">
        <SystemStatusList label={m.coverageLabel}>
          {rows.map((row) => (
            <SystemRow key={row.system} row={row} now={now} action={pauseAction?.(row)} />
          ))}
        </SystemStatusList>
        <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Icon icon={InformationCircleIcon} className="size-3.5 shrink-0" />
          {m.configNote}
        </p>
      </div>
    </div>
  );
}

/** Breakers open first, then those recovering, then paused systems; or all clear. */
function Alerts({ rows, now }: { rows: SystemCoverage[]; now: Date }) {
  const { open, halfOpen, paused } = summarise(rows);
  if (open.length + halfOpen.length + paused.length === 0) {
    return (
      <Alert variant="success" role="status">
        <Icon icon={CheckmarkCircle02Icon} />
        <AlertTitle>{m.allWorking}</AlertTitle>
      </Alert>
    );
  }
  return (
    <div className="flex flex-col gap-2.5">
      {open.map((row) => (
        <Alert key={row.system} variant="destructive">
          <Icon icon={BanIcon} />
          <AlertDescription>
            <b className="font-semibold">{m.notResponding(systemInfo(row.system))}</b>{' '}
            {m.notRespondingDetail(
              formatLastSuccess(row.lastSuccessAt, now, m.never).toLowerCase(),
            )}
          </AlertDescription>
        </Alert>
      ))}
      {halfOpen.map((row) => (
        <Alert key={row.system} variant="warning" role="status">
          <Icon icon={Activity01Icon} />
          <AlertDescription>
            <b className="font-semibold">{m.recovering(systemInfo(row.system))}</b>{' '}
            {m.recoveringDetail}
          </AlertDescription>
        </Alert>
      ))}
      {paused.map((row) => (
        <Alert key={row.system} variant="info" role="status">
          <Icon icon={PauseIcon} />
          <AlertDescription>
            <b className="font-semibold">{m.paused(systemInfo(row.system))}</b>{' '}
            {row.pausedBy && row.pausedAt
              ? `${m.pausedSince(row.pausedBy, formatTime(row.pausedAt))} `
              : null}
            {m.pausedDetail(systemInfo(row.system))}
          </AlertDescription>
        </Alert>
      ))}
    </div>
  );
}

function SystemRow({ row, now, action }: { row: SystemCoverage; now: Date; action: ReactNode }) {
  const system = systemInfo(row.system);
  return (
    <SystemStatusRow
      name={system.name}
      icon={ICONS[row.system] ?? PlugSocketIcon}
      description={system.use ?? undefined}
      data-system={row.system}
      metrics={<Metrics row={row} now={now} />}
      action={action}
      badge={
        <span className="flex w-auto items-center justify-start gap-2 @min-[1056px]:w-[178px] @min-[1056px]:justify-end">
          {/* Paused takes the breaker's place: nothing is sent, so its state says nothing now. */}
          {row.paused ? (
            <Badge variant="warning">
              <Icon icon={PauseIcon} strokeWidth={2.2} />
              {m.pausedBadge}
            </Badge>
          ) : (
            <BreakerBadge state={row.breaker} />
          )}
        </span>
      }
    >
      <Details row={row} withAction={action !== undefined && action !== null} />
    </SystemStatusRow>
  );
}

/** Calls, cache hit rate and last success, in fixed columns so they line up down the list. */
function Metrics({ row, now }: { row: SystemCoverage; now: Date }) {
  const stale = isLastSuccessStale(row, now);
  return (
    <dl className="grid grid-cols-[minmax(0,92px)_minmax(0,128px)_minmax(0,124px)] gap-x-5">
      <Metric term={m.calls}>{formatNumber(row.calls24h)}</Metric>
      <Metric term={m.hitRate}>
        {row.calls24h > 0 ? (
          <span className="flex items-center gap-2">
            <span className="w-10">{formatPercent(row.cacheHitRate)}</span>
            <Meter value={row.cacheHitRate} />
          </span>
        ) : (
          <span className="text-muted-foreground">{m.noCalls}</span>
        )}
      </Metric>
      <Metric term={m.lastSuccess}>
        <span className={cn(stale && 'font-semibold text-destructive')}>
          {row.lastSuccessAt ? (
            <time dateTime={row.lastSuccessAt}>
              {formatLastSuccess(row.lastSuccessAt, now, m.never)}
            </time>
          ) : (
            m.never
          )}
        </span>
      </Metric>
    </dl>
  );
}

function Metric({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs whitespace-nowrap text-muted-foreground">{term}</dt>
      <dd className="text-sm whitespace-nowrap tabular-nums">{children}</dd>
    </div>
  );
}

function Details({ row, withAction }: { row: SystemCoverage; withAction: boolean }) {
  const callout = row.paused ? (
    <Alert variant="warning" role="status">
      <Icon icon={PauseIcon} />
      <AlertDescription>
        {row.pausedBy && row.pausedAt
          ? m.pausedByCallout(systemInfo(row.system), row.pausedBy, formatDateTime(row.pausedAt))
          : m.pausedCallout(systemInfo(row.system))}
      </AlertDescription>
    </Alert>
  ) : row.breaker === 'open' ? (
    <Alert variant="destructive" role="status">
      <Icon icon={BanIcon} />
      <AlertDescription>{m.breakerOpenCallout}</AlertDescription>
    </Alert>
  ) : row.breaker === 'half-open' ? (
    <Alert variant="warning" role="status">
      <Icon icon={Activity01Icon} />
      <AlertDescription>{m.breakerHalfOpenCallout}</AlertDescription>
    </Alert>
  ) : null;
  const { owner } = systemInfo(row.system);
  // Each in the row's column above it (when the row has its figures beside the name): who runs it and its failures under
  // the name, the rate limit and timeout under Calls, the cache and breaker under Last success.
  const items: [string, string, DetailColumn][] = [
    ...(owner === null ? [] : [[m.operatedBy, owner, 'name'] satisfies DetailItem]),
    [m.rateLimit, m.rateLimitValue(row.rateLimitPerMinute), 'calls'],
    [m.cacheLifetime, m.cacheLifetimeValue(formatDuration(row.cacheTtlSeconds)), 'last'],
    [m.failedCalls, formatNumber(row.failures24h), 'name'],
    [m.timeout, m.timeoutValue(formatDuration(row.timeoutMs / 1000)), 'calls'],
    [
      m.breakerRule,
      m.breakerRuleValue(row.breakerFailureThreshold, formatDuration(row.breakerCooldownSeconds)),
      'last',
    ],
    // The row shows Paused in the breaker's place; the breaker's own state is kept here.
    ...(row.paused
      ? [[m.breaker, BREAKER_BADGE_MESSAGES[row.breaker], 'name'] satisfies DetailItem]
      : []),
  ];
  return (
    <div className="grid gap-3.5 pl-10 max-sm:pl-0">
      {callout}
      <dl
        className={cn(
          'grid gap-x-2.5 gap-y-3 sm:grid-cols-2 sm:gap-x-6',
          withAction ? DETAIL_COLUMNS_WITH_ACTION : DETAIL_COLUMNS,
        )}
      >
        {items.map(([term, value, column]) => (
          <div
            key={term}
            data-column={column}
            className={cn('min-w-0 @min-[1056px]:pr-4', COLUMN_START[column])}
          >
            <dt className="text-xs text-muted-foreground">{term}</dt>
            <dd className="text-sm">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** The row's column a detail sits under: the name, Calls, or Last success. */
type DetailColumn = 'name' | 'calls' | 'last';
type DetailItem = [string, string, DetailColumn];

const COLUMN_START: Record<DetailColumn, string> = {
  name: '@min-[1056px]:col-start-1',
  calls: '@min-[1056px]:col-start-2',
  last: '@min-[1056px]:col-start-3',
};

/**
 * The details' columns, when the list is wide enough for the row's figures beside its name
 * (1056px, as SystemStatusRow), lined up with the row above: the
 * first under the name; the second from Calls to Cache hit rate (`Metrics`: 92px, 20px gap,
 * 128px, 20px gap, less the 10px gap between columns); the third from Last success (124px) over
 * the badge (178px), the Pause or Resume button (104px) and the chevron (16px), with the row's
 * 10px gaps between them.
 */
const DETAIL_COLUMNS =
  '@min-[1056px]:grid-cols-[minmax(0,1fr)_250px_338px] @min-[1056px]:gap-x-2.5';
const DETAIL_COLUMNS_WITH_ACTION =
  '@min-[1056px]:grid-cols-[minmax(0,1fr)_250px_452px] @min-[1056px]:gap-x-2.5';

function CoverageSkeleton() {
  return (
    <div aria-busy="true" aria-label={m.loadingLabel} className="flex flex-col gap-[18px]">
      <div className={TILES}>
        {Array.from({ length: 4 }, (_, index) => (
          <StatTileSkeleton key={index} />
        ))}
      </div>
      <Skeleton className="h-12 w-full rounded-lg" />
      <SystemStatusList aria-hidden="true">
        {Array.from({ length: 5 }, (_, index) => (
          <li
            key={index}
            className="flex items-center gap-3 border-t border-border/60 px-3.5 py-3 first:border-t-0"
          >
            <Skeleton className="size-[30px] rounded-md" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="w-32" />
              <Skeleton className="w-56 max-w-full" />
            </div>
            <Skeleton className="hidden w-80 sm:block" />
            <Skeleton className="h-6 w-20 rounded-full" />
          </li>
        ))}
      </SystemStatusList>
    </div>
  );
}
