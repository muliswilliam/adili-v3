import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  type BadgeProps,
  Button,
  Card,
  cn,
  EmptyState,
  focusRingInset,
  formatDate,
  Icon,
  IconTile,
  type IconProps,
  Skeleton,
} from '@adili/ui';
import {
  AlertCircleIcon,
  ArrowRight01Icon,
  Clock01Icon,
  Notification01Icon,
  RefreshIcon,
  SentIcon,
  Shield01Icon,
  Tick02Icon,
  WifiDisconnected01Icon,
} from '@hugeicons/core-free-icons';
import { Link } from '@tanstack/react-router';
import { useRef } from 'react';

import {
  COPY,
  SALARY_STOPPED,
  STATUS_LABELS,
  STEP_SHORT,
  STEP_TITLES,
  STRIP_STATES,
} from '../../notices/copy';
import {
  followedBy,
  isClosed,
  ladderOf,
  type NoticeLadderStep,
  urgentNotice,
  windowOf,
} from '../../notices/view';
import { salaryOnTop } from '../../notices/salary';
import type { MyNoticesResult } from '../../server/notices.server';
import type { ActionStatus, DeclarantNotice } from '../../server/review/types';
import { Pager } from '../my-declarations/pager';
import { SalaryBanner } from './salary-parts';

/**
 * The declarant's Notices (spec 08 FE-7, S17): the notice to act on soonest on top with the way
 * to comply and where its ladder stands, then every notice and warning, newest first, a page at a
 * time, each opening its page. Also the rows of the dashboard's Notices card.
 */

export const NOTICES_PAGE_SIZE = 10;

const STATUS_TONES: Record<ActionStatus, NonNullable<BadgeProps['variant']>> = {
  proposed: 'warning',
  approved: 'warning',
  'approved-pending-payroll': 'warning',
  issued: 'warning',
  responded: 'info',
  complied: 'success',
  reinstated: 'success',
  declined: 'default',
  cancelled: 'default',
};

const STATUS_ICONS: Record<ActionStatus, IconProps['icon']> = {
  proposed: Notification01Icon,
  approved: Notification01Icon,
  'approved-pending-payroll': Notification01Icon,
  issued: Notification01Icon,
  responded: SentIcon,
  complied: Tick02Icon,
  reinstated: Tick02Icon,
  declined: Tick02Icon,
  cancelled: Tick02Icon,
};

/** A warning (and the later steps) reads red; a notice to comply amber. */
function toneOf(notice: DeclarantNotice): 'warning' | 'destructive' | 'success' {
  if (isClosed(notice)) return 'success';
  return notice.step === 'notice-to-comply' ? 'warning' : 'destructive';
}

export function NoticeStatusBadge({ notice }: { notice: DeclarantNotice }) {
  const stopped = notice.salaryStoppedAt !== null && notice.salaryReinstatedAt === null;
  // An issued warning (or later step) reads red, as its row's icon does.
  const pastNotice = notice.status === 'issued' && notice.step !== 'notice-to-comply';
  const variant = stopped || pastNotice ? 'destructive' : STATUS_TONES[notice.status];
  return (
    <Badge variant={variant}>
      <Icon icon={pastNotice ? AlertCircleIcon : STATUS_ICONS[notice.status]} />
      {stopped ? SALARY_STOPPED.en : STATUS_LABELS[notice.status].en}
    </Badge>
  );
}

/** "Act by 7 Oct 2026 · 9 days left", red when 3 days or fewer remain. */
function ActBy({ notice, now }: { notice: DeclarantNotice; now: string }) {
  const window = windowOf(notice, now);
  if (!window || !notice.actBy) return null;
  if (window.daysLeft < 0) {
    return (
      <span className="text-[13.5px] text-muted-foreground">
        {COPY.windowEnded(formatDate(notice.actBy))}
      </span>
    );
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-[5px] text-[13.5px] font-semibold',
        window.daysLeft <= 3 ? 'text-destructive' : 'text-warning',
      )}
    >
      <Icon icon={Clock01Icon} className="size-3.5" />
      {`${COPY.actBy(formatDate(notice.actBy))} · ${COPY.daysLeft(window.daysLeft)}`}
    </span>
  );
}

function NoticeRow({
  notice,
  all,
  now,
}: {
  notice: DeclarantNotice;
  all: readonly DeclarantNotice[];
  now: string;
}) {
  const next = followedBy(notice, all);
  return (
    <li>
      <Link
        to="/notices/$actionId"
        params={{ actionId: notice.actionId }}
        className={cn(
          focusRingInset,
          'flex items-start gap-3.5 px-5 py-[18px] transition-colors hover:bg-muted/40 sm:px-6',
        )}
      >
        <IconTile tone={toneOf(notice)} size="lg">
          <Icon
            icon={
              isClosed(notice) || notice.step === 'notice-to-comply'
                ? Notification01Icon
                : AlertCircleIcon
            }
          />
        </IconTile>
        <div className="min-w-0 flex-1">
          <h3 className="text-[15.5px] leading-[1.35] font-semibold">
            {STEP_TITLES[notice.step].en}
          </h3>
          <p className="mt-[3px] text-[13.5px] leading-[1.45] text-muted-foreground">
            <span className="font-mono text-[0.94em] tracking-[0.01em] break-all">
              {notice.reference}
            </span>
            {' · '}
            <span className="whitespace-nowrap">{COPY.issuedOn(formatDate(notice.issuedAt))}</span>
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <NoticeStatusBadge notice={notice} />
            {next ? (
              <span className="text-[13.5px] text-muted-foreground">
                {COPY.followedBy(next.step)}
              </span>
            ) : isClosed(notice) ? null : (
              <ActBy notice={notice} now={now} />
            )}
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

/** Rows of notices, each a link to its page, divided by hairlines. */
export function NoticeRows({
  notices,
  all,
  now,
  label,
}: {
  notices: readonly DeclarantNotice[];
  all: readonly DeclarantNotice[];
  now: string;
  label?: string;
}) {
  return (
    <ul aria-label={label} className="divide-y divide-border">
      {notices.map((notice) => (
        <NoticeRow key={notice.actionId} notice={notice} all={all} now={now} />
      ))}
    </ul>
  );
}

/** Where a ladder stands: one bar per step, the current one red. */
export function LadderStrip({
  steps,
  compact = false,
}: {
  steps: readonly NoticeLadderStep[];
  compact?: boolean;
}) {
  return (
    <ol aria-label={COPY.ladderLabel} className="grid grid-cols-4 gap-1.5">
      {steps.map(({ step, state }) => (
        <li key={step} className="grid gap-1.5">
          <span
            aria-hidden="true"
            className={cn(
              'h-1 rounded-full',
              state === 'current'
                ? 'bg-destructive'
                : state === 'complied'
                  ? 'bg-success'
                  : state === 'issued'
                    ? 'bg-foreground/70'
                    : 'bg-border',
            )}
          />
          <span
            className={cn(
              compact ? 'text-[12.5px]' : 'text-[13px]',
              state === 'current' ? 'font-semibold' : 'text-muted-foreground',
            )}
          >
            {STEP_SHORT[step].en}
          </span>
          <span className={cn('text-muted-foreground', compact ? 'text-[12px]' : 'text-[12.5px]')}>
            {STRIP_STATES[state].en}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Where to go to comply: the dashboard's obligations, or the clarifications. */
export function ComplyLink({
  notice,
  variant = 'default',
}: {
  notice: DeclarantNotice;
  variant?: 'default' | 'secondary';
}) {
  return (
    <Button asChild size="sm" variant={variant}>
      <Link to={notice.whatToDo === 'file-declaration' ? '/' : '/clarifications'}>
        {COPY.cta[notice.whatToDo]}
        <Icon icon={ArrowRight01Icon} />
      </Link>
    </Button>
  );
}

function PageTitle() {
  return (
    <h1 className="text-2xl leading-tight font-semibold tracking-[-0.02em] sm:text-[28px]">
      {COPY.title}
    </h1>
  );
}

/** The list's placeholder rows while it loads. */
export function NoticesSkeleton() {
  return (
    <div>
      <PageTitle />
      <Card
        role="status"
        aria-busy="true"
        aria-label={COPY.title}
        className="mt-6 divide-y divide-border p-0 sm:p-0"
      >
        {[0, 1].map((key) => (
          <div key={key} className="flex gap-3.5 px-5 py-[18px] sm:px-6">
            <Skeleton className="size-10 shrink-0 rounded-xl" />
            <div className="grid flex-1 gap-2.5 pt-1">
              <Skeleton className="h-3.5 w-[40%]" />
              <Skeleton className="w-[65%]" />
              <Skeleton className="w-[30%]" />
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}

export interface NoticesViewProps {
  result: MyNoticesResult;
  /** The server's clock when the list loaded. */
  now: string;
  page: number;
  onPage: (page: number) => void;
  onRetry: () => void;
}

export function NoticesView({ result, now, page, onPage, onRetry }: NoticesViewProps) {
  return (
    <div>
      <PageTitle />
      {result.status === 'unavailable' ? (
        <Card className="mt-6 p-0 sm:p-0">
          <EmptyState
            className="py-12"
            tone="destructive"
            icon={<Icon icon={WifiDisconnected01Icon} />}
            title={COPY.errorTitle}
            description={COPY.errorBody}
            action={
              <Button type="button" variant="secondary" onClick={onRetry}>
                <Icon icon={RefreshIcon} />
                {COPY.tryAgain}
              </Button>
            }
          />
        </Card>
      ) : result.notices.length === 0 ? (
        <Card className="mt-6 p-0 sm:p-0">
          <EmptyState
            className="py-14"
            tone="success"
            icon={<Icon icon={Shield01Icon} />}
            title={COPY.emptyTitle}
            description={COPY.emptyBody}
          />
        </Card>
      ) : (
        <Notices notices={result.notices} now={now} page={page} onPage={onPage} />
      )}
    </div>
  );
}

function Notices({
  notices,
  now,
  page,
  onPage,
}: {
  notices: DeclarantNotice[];
  now: string;
  page: number;
  onPage: (page: number) => void;
}) {
  const salary = salaryOnTop(notices);
  const urgent = urgentNotice(notices, now);
  const listRef = useRef<HTMLDivElement>(null);
  const pages = Math.max(1, Math.ceil(notices.length / NOTICES_PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pages);
  const shown = notices.slice((current - 1) * NOTICES_PAGE_SIZE, current * NOTICES_PAGE_SIZE);
  const allComplied = notices.every(isClosed);
  // The ladder of the notice on top, or of the latest one once everything has closed.
  const stripFor = urgent ?? (allComplied ? (notices[0] ?? null) : null);
  return (
    <div className="mt-6 grid gap-4">
      {salary ? (
        <SalaryBanner standing={salary} />
      ) : urgent?.actBy ? (
        <Alert
          variant={urgent.step === 'notice-to-comply' ? 'warning' : 'destructive'}
          role="status"
        >
          <Icon icon={urgent.step === 'notice-to-comply' ? Notification01Icon : AlertCircleIcon} />
          <AlertTitle className="font-normal">
            <span className="font-semibold">{`${COPY.actBy(formatDate(urgent.actBy))}.`}</span>{' '}
            <span>{COPY.todo(urgent.subject)}</span>
          </AlertTitle>
          <AlertDescription className="mt-2.5">
            <ComplyLink notice={urgent} />
          </AlertDescription>
        </Alert>
      ) : allComplied ? (
        <Alert variant="success" role="status">
          <Icon icon={Tick02Icon} />
          <AlertTitle>{COPY.compliedBanner}</AlertTitle>
        </Alert>
      ) : null}
      {stripFor ? (
        <Card className="px-5 py-4 sm:px-6">
          <LadderStrip steps={ladderOf(stripFor, notices)} />
        </Card>
      ) : null}
      <div ref={listRef} className="scroll-mt-20">
        <Card className="overflow-hidden p-0 sm:p-0">
          <NoticeRows notices={shown} all={notices} now={now} label={COPY.title} />
          {notices.length > NOTICES_PAGE_SIZE ? (
            <Pager
              page={current}
              pageSize={NOTICES_PAGE_SIZE}
              total={notices.length}
              onPage={(next) => {
                onPage(next);
                listRef.current?.scrollIntoView({ block: 'start' });
              }}
              label={COPY.title}
              className="rounded-none border-t border-border bg-transparent shadow-none"
            />
          ) : null}
        </Card>
      </div>
    </div>
  );
}
