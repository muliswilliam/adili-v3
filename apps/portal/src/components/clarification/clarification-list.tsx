import {
  Badge,
  Button,
  Card,
  CardTitle,
  cn,
  EmptyState,
  focusRingInset,
  Icon,
  IconTile,
  Skeleton,
} from '@adili/ui';
import {
  AlertCircleIcon,
  ArrowRight01Icon,
  Clock01Icon,
  Link01Icon,
  Message01Icon,
  Notification01Icon,
  RefreshIcon,
  SentIcon,
  Tick02Icon,
  UnavailableIcon,
  WifiDisconnected01Icon,
} from '@hugeicons/core-free-icons';
import { Link } from '@tanstack/react-router';
import { type ReactNode, type Ref, useRef } from 'react';

import { LIST_COPY as COPY } from '../../clarification/copy';
import type { Countdown } from '../../clarification/deadline';
import {
  type ClarificationRow as Row,
  groupClarifications,
  LIST_PAGE_SIZE,
  pageOf,
  type RowTag,
  rowOf,
} from '../../clarification/list';
import type { MyClarificationsResult } from '../../server/clarifications.server';
import type { ClarificationStatus, DeclarantClarification } from '../../server/review/types';
import { HomeLink } from '../home-link';
import { Pager } from '../my-declarations/pager';

/**
 * The declarant's clarifications (spec 07a FE-5): those that need a response, then the earlier
 * ones a page at a time, each row opening the clarification. Also the rows of the dashboard's
 * Clarifications card.
 */

type IconData = typeof Message01Icon;

const STATUS_ICONS: Record<ClarificationStatus, IconData> = {
  draft: Message01Icon,
  issued: Message01Icon,
  overdue: AlertCircleIcon,
  responded: SentIcon,
  resolved: Tick02Icon,
  withdrawn: UnavailableIcon,
};

const TAG_ICONS: Record<RowTag['key'], IconData> = {
  reminder: Notification01Icon,
  late: Clock01Icon,
  'follow-up': Link01Icon,
  'further-sent': Message01Icon,
};

const COUNTDOWN_TONES: Record<Countdown['tone'], string> = {
  neutral: 'text-foreground',
  warning: 'text-warning',
  danger: 'text-destructive',
};

function ClarificationRowLink({ row }: { row: Row }) {
  return (
    <li>
      <Link
        to="/clarifications/$id"
        params={{ id: row.id }}
        className={cn(
          focusRingInset,
          'flex items-start gap-3.5 px-5 py-[18px] transition-colors hover:bg-muted/40 sm:px-6',
        )}
      >
        <IconTile tone={row.status.variant} size="lg">
          <Icon icon={STATUS_ICONS[row.kind]} />
        </IconTile>
        <div className="min-w-0 flex-1">
          <h3 className="text-[15.5px] leading-[1.35] font-semibold">{row.title}</h3>
          <p className="mt-[3px] text-[13.5px] leading-[1.45] text-muted-foreground">
            {row.reference ? (
              <>
                <span className="font-mono text-[0.94em] tracking-[0.01em] break-all">
                  {row.reference}
                </span>
                {' · '}
              </>
            ) : null}
            {row.commission}
          </p>
          <p className="mt-[3px] text-[13.5px] leading-[1.45] text-muted-foreground">
            {/* The line wraps between the dates, never inside one. */}
            {row.dates.map((part, index) => (
              <span key={part} className="whitespace-nowrap">
                {index > 0 ? ' · ' : null}
                {part}
              </span>
            ))}
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <Badge variant={row.status.variant}>
              <Icon icon={STATUS_ICONS[row.kind]} />
              {row.status.label}
            </Badge>
            {row.countdown ? (
              <span
                className={cn(
                  'inline-flex items-center gap-[5px] text-[13.5px] font-semibold',
                  COUNTDOWN_TONES[row.countdown.tone],
                )}
              >
                <Icon icon={Clock01Icon} className="size-3.5" />
                {row.countdown.text}
              </span>
            ) : null}
            {row.tags.map((tag) => (
              <Badge key={tag.key} variant={tag.variant}>
                <Icon icon={TAG_ICONS[tag.key]} />
                {tag.label}
              </Badge>
            ))}
          </div>
        </div>
        <Icon
          icon={ArrowRight01Icon}
          aria-hidden="true"
          className="size-5 shrink-0 self-center text-muted-foreground"
        />
      </Link>
    </li>
  );
}

/** Rows of clarifications, each a link to its page, divided by hairlines. */
export function ClarificationRows({
  clarifications,
  all,
  now,
  label,
}: {
  clarifications: DeclarantClarification[];
  /** The whole list, to tell which ones were followed up. */
  all: DeclarantClarification[];
  now: string;
  label?: string;
}) {
  return (
    <ul aria-label={label} className="divide-y divide-border">
      {clarifications.map((clarification) => (
        <ClarificationRowLink key={clarification.id} row={rowOf(clarification, all, now)} />
      ))}
    </ul>
  );
}

/** A card of clarification rows under a title, with View all (the dashboard, a declaration). */
export function ClarificationsCardFrame({
  titleId,
  title,
  className,
  children,
}: {
  titleId: string;
  title: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card asChild className={cn('overflow-hidden p-0 sm:p-0', className)}>
      <section aria-labelledby={titleId}>
        <div className="flex items-center gap-3 border-b border-border px-5 py-4 sm:px-6 sm:py-[18px]">
          <CardTitle id={titleId} className="flex-1">
            {title}
          </CardTitle>
          <Button asChild variant="ghost" size="sm">
            <Link to="/clarifications" aria-label={COPY.viewAllLabel}>
              {COPY.viewAll}
            </Link>
          </Button>
        </div>
        {children}
      </section>
    </Card>
  );
}

function Group({
  title,
  children,
  ref,
}: {
  title: string;
  children: ReactNode;
  ref?: Ref<HTMLElement>;
}) {
  return (
    <section ref={ref} aria-label={title} className="scroll-mt-20">
      <h2 className="mt-6 mb-2.5 text-base font-semibold tracking-[-0.01em]">{title}</h2>
      <Card className="overflow-hidden p-0 sm:p-0">{children}</Card>
    </section>
  );
}

function PageHeader() {
  return (
    <>
      <HomeLink label={COPY.home} />
      <h1 className="text-2xl leading-tight font-semibold tracking-[-0.02em] sm:text-[28px]">
        {COPY.title}
      </h1>
    </>
  );
}

/** The list's placeholder rows while it loads. */
export function ClarificationsSkeleton() {
  return (
    <div>
      <PageHeader />
      <Card
        role="status"
        aria-busy="true"
        aria-label={COPY.loading}
        className="mt-6 divide-y divide-border p-0 sm:p-0"
      >
        {[0, 1].map((key) => (
          <div key={key} className="flex gap-3.5 px-5 py-[18px] sm:px-6">
            <Skeleton className="size-10 shrink-0 rounded-xl" />
            <div className="grid flex-1 gap-2.5 pt-1">
              <Skeleton className="h-3.5 w-[45%]" />
              <Skeleton className="w-[70%]" />
              <Skeleton className="w-[30%]" />
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}

export interface ClarificationsViewProps {
  result: MyClarificationsResult;
  /** The server's clock when the list loaded. */
  now: string;
  /** The page of the earlier clarifications. */
  page: number;
  onPage: (page: number) => void;
  onRetry: () => void;
}

/** The "Clarifications" page: the groups, the empty state, or an error with Try again. */
export function ClarificationsView({
  result,
  now,
  page,
  onPage,
  onRetry,
}: ClarificationsViewProps) {
  return (
    <div>
      <PageHeader />
      {result.status === 'unavailable' ? (
        <Card className="mt-6 p-0 sm:p-0">
          <EmptyState
            className="py-12"
            tone="destructive"
            icon={<Icon icon={WifiDisconnected01Icon} />}
            title={COPY.unavailableTitle}
            description={COPY.unavailableBody}
            action={
              <Button type="button" variant="secondary" onClick={onRetry}>
                <Icon icon={RefreshIcon} />
                {COPY.tryAgain}
              </Button>
            }
          />
        </Card>
      ) : result.clarifications.length === 0 ? (
        <Card className="mt-6 p-0 sm:p-0">
          <EmptyState
            className="py-14"
            tone="success"
            icon={<Icon icon={Message01Icon} />}
            title={COPY.emptyTitle}
            description={COPY.emptyBody}
          />
        </Card>
      ) : (
        <Groups clarifications={result.clarifications} now={now} page={page} onPage={onPage} />
      )}
    </div>
  );
}

function Groups({
  clarifications,
  now,
  page,
  onPage,
}: {
  clarifications: DeclarantClarification[];
  now: string;
  page: number;
  onPage: (page: number) => void;
}) {
  const { open, earlier } = groupClarifications(clarifications);
  const shown = pageOf(earlier, page);
  const earlierRef = useRef<HTMLElement>(null);
  return (
    <>
      {open.length > 0 ? (
        <Group title={COPY.needsResponse}>
          <ClarificationRows clarifications={open} all={clarifications} now={now} />
        </Group>
      ) : null}
      {earlier.length > 0 ? (
        <Group ref={earlierRef} title={open.length > 0 ? COPY.earlier : COPY.all}>
          <ClarificationRows clarifications={shown.rows} all={clarifications} now={now} />
          {earlier.length > LIST_PAGE_SIZE ? (
            <Pager
              page={shown.page}
              pageSize={LIST_PAGE_SIZE}
              total={earlier.length}
              onPage={(next) => {
                onPage(next);
                earlierRef.current?.scrollIntoView({ block: 'start' });
              }}
              label={COPY.pagination}
              className="rounded-none border-t border-border bg-transparent shadow-none"
            />
          ) : null}
        </Group>
      ) : null}
    </>
  );
}
