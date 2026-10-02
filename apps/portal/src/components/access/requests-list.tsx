import {
  Badge,
  Button,
  Card,
  cn,
  DeadlineChip,
  deadlineSoonDays,
  deadlineStatus,
  DECIDED_ACCESS_STATUSES,
  EmptyState,
  focusRingInset,
  GRANTED_ACCESS_STATUSES,
  groundMeta,
  Icon,
  OPEN_ACCESS_STATUSES,
  unissuedPackageState,
} from '@adili/ui';
import {
  Add01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Calendar03Icon,
  File01Icon,
  PackageRemoveIcon,
  SquareLock02Icon,
} from '@hugeicons/core-free-icons';
import { Link } from '@tanstack/react-router';

import { day, REQUESTS_COPY as COPY } from '../../access/copy';
import type { RequestSummary } from '../../server/access-requests.server';
import { RequestStatusBadge, RequestStatusTile } from './request-status';

export const REQUESTS_PAGE_SIZE = 10;

/** The line under a row's reference: when it was submitted, decided, withdrawn or closed. */
function dateLine(request: RequestSummary): string {
  if (request.closedAt && DECIDED_ACCESS_STATUSES.has(request.status))
    return COPY.decidedOn(day(request.closedAt));
  if (request.closedAt && request.status === 'withdrawn') {
    return COPY.withdrawnOn(day(request.closedAt));
  }
  if (request.closedAt && request.status === 'cannot-identify') {
    return COPY.closedOn(day(request.closedAt));
  }
  return COPY.submittedOn(day(request.submittedAt));
}

/**
 * A clock's chip with what it counts down to written beside it ("Download by 14 Oct 2026"), so
 * "12 days left" never reads as another clock. The chip says it all to screen readers.
 */
function LabelledClock({
  label,
  due,
  soonDays,
  todayText,
  now,
}: {
  label: string;
  due: string;
  soonDays: number;
  todayText?: string;
  now: number;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className="text-[13px] text-secondary-foreground">
        {`${label} ${day(due)}`}
      </span>
      <DeadlineChip due={due} soonDays={soonDays} label={label} todayText={todayText} now={now} />
    </span>
  );
}

/**
 * The decision clock while the request is open: the due date, then from day 20 (due soon) the
 * days left or late beside it, counted in Kenyan calendar days.
 */
function DecisionDue({ request, now }: { request: RequestSummary; now: number }) {
  if (!OPEN_ACCESS_STATUSES.has(request.status)) return null;
  const due = request.decisionDeadlineAt;
  if (deadlineStatus(due, { now, soonDays: deadlineSoonDays.decision }).state === 'due') {
    return (
      <Badge variant="default">
        <Icon icon={Calendar03Icon} strokeWidth={2.2} />
        {COPY.dueOn(day(due))}
      </Badge>
    );
  }
  return (
    <LabelledClock
      label={COPY.decisionDue}
      due={due}
      soonDays={deadlineSoonDays.decision}
      now={now}
    />
  );
}

/**
 * A granted package's download window: by when, days left (soon from 3 days), or expired; or,
 * an hour after the grant without a package, that none was issued (the rule every app shares).
 */
function DownloadBy({ request, now }: { request: RequestSummary; now: number }) {
  if (!GRANTED_ACCESS_STATUSES.has(request.status)) return null;
  if (!request.downloadExpiresAt) {
    if (!request.closedAt || unissuedPackageState(request.closedAt, now) === 'preparing') {
      return null;
    }
    return (
      <Badge variant="default">
        <Icon icon={PackageRemoveIcon} strokeWidth={2.2} />
        {COPY.noPackage}
      </Badge>
    );
  }
  if (Date.parse(request.downloadExpiresAt) <= now) {
    return (
      <Badge variant="default">
        <Icon icon={SquareLock02Icon} strokeWidth={2.2} />
        {COPY.downloadExpired}
      </Badge>
    );
  }
  return (
    <LabelledClock
      label={COPY.downloadBy}
      due={request.downloadExpiresAt}
      soonDays={deadlineSoonDays.download}
      todayText={COPY.expiresToday}
      now={now}
    />
  );
}

/** A decided row's grounds and the start of its reasons; the request's page has the rest. */
function DecisionSummary({ decision }: { decision: NonNullable<RequestSummary['decision']> }) {
  return (
    <span className="mt-2 grid gap-0.5 text-[13px]">
      {decision.grounds.length > 0 ? (
        <span className="text-secondary-foreground">
          <span className="font-medium">{COPY.grounds}</span>{' '}
          {decision.grounds.map((ground) => groundMeta[ground].label).join('; ')}
        </span>
      ) : null}
      <span className="line-clamp-2 text-muted-foreground">{decision.reasons}</span>
    </span>
  );
}

function RequestRow({ request, now }: { request: RequestSummary; now: number }) {
  return (
    <li className="border-b border-border last:border-b-0">
      <Link
        to="/access/requests/$id"
        params={{ id: request.id }}
        aria-label={COPY.open(request.reference)}
        className={cn(focusRingInset, 'flex items-start gap-4 px-5 py-4 hover:bg-muted/60 sm:px-6')}
      >
        <RequestStatusTile status={request.status} />
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="truncate text-[15px] font-semibold">{request.officerName}</span>
          <span className="truncate text-[13px] text-muted-foreground">
            <span className="font-mono">{request.reference}</span> · {request.commission.name}
          </span>
          <span className="text-[13px] text-muted-foreground">{dateLine(request)}</span>
          <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <RequestStatusBadge status={request.status} />
            <DecisionDue request={request} now={now} />
            <DownloadBy request={request} now={now} />
          </span>
          {request.decision ? <DecisionSummary decision={request.decision} /> : null}
        </span>
        <Icon
          icon={ArrowRight01Icon}
          className="mt-3 size-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
      </Link>
    </li>
  );
}

/** Pages of a list, ten to a page unless told: the range shown and a button per page. */
export function Pager({
  page,
  total,
  onPage,
  pageSize = REQUESTS_PAGE_SIZE,
  label = COPY.pagination,
}: {
  page: number;
  total: number;
  onPage: (page: number) => void;
  pageSize?: number;
  /** Names the pager for screen readers. */
  label?: string;
}) {
  const pages = Math.ceil(total / pageSize);
  if (pages <= 1) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav
      aria-label={label}
      className="flex items-center gap-1.5 border-t border-border px-5 py-2.5 text-[13.5px] text-muted-foreground sm:px-6"
    >
      <span aria-live="polite">{COPY.range(from, to, total)}</span>
      <span className="flex-1" />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 [&_svg]:size-4"
        aria-label={COPY.previous}
        disabled={page === 1}
        onClick={() => {
          onPage(page - 1);
        }}
      >
        <Icon icon={ArrowLeft01Icon} />
      </Button>
      {Array.from({ length: pages }, (_, index) => index + 1).map((number) => (
        <Button
          key={number}
          type="button"
          variant={number === page ? 'default' : 'ghost'}
          size="icon"
          className="size-8 text-[13px] tabular-nums"
          aria-label={COPY.page(number)}
          aria-current={number === page ? 'page' : undefined}
          onClick={() => {
            onPage(number);
          }}
        >
          {number}
        </Button>
      ))}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 [&_svg]:size-4"
        aria-label={COPY.next}
        disabled={page === pages}
        onClick={() => {
          onPage(page + 1);
        }}
      >
        <Icon icon={ArrowRight01Icon} />
      </Button>
    </nav>
  );
}

export function NewRequestButton() {
  return (
    <Button asChild>
      <Link to="/access/requests/new">
        <Icon icon={Add01Icon} />
        {COPY.newRequest}
      </Link>
    </Button>
  );
}

/**
 * My requests (spec 10 FE-3): the applicant's Form K requests, latest first, ten to a page,
 * each with its officer, reference, Commission, status and, while open, the decision clock;
 * once decided, the grounds and the start of the reasons, and once granted, the package's
 * download window. Withdrawing is on the request's page.
 */
export function RequestsList({
  requests,
  page,
  now,
  onPage,
}: {
  requests: RequestSummary[];
  page: number;
  /** Epoch milliseconds from the server, so the clocks read the same on both sides. */
  now: number;
  onPage: (page: number) => void;
}) {
  if (requests.length === 0) {
    return (
      <Card>
        <EmptyState
          className="py-14"
          icon={<Icon icon={File01Icon} />}
          title={COPY.emptyTitle}
          description={COPY.emptyText}
          action={<NewRequestButton />}
        />
      </Card>
    );
  }
  const pages = Math.ceil(requests.length / REQUESTS_PAGE_SIZE);
  const shown = Math.min(Math.max(1, page), pages);
  const rows = requests.slice((shown - 1) * REQUESTS_PAGE_SIZE, shown * REQUESTS_PAGE_SIZE);
  return (
    <Card className="overflow-hidden p-0 sm:p-0">
      <ul aria-label={COPY.title}>
        {rows.map((request) => (
          <RequestRow key={request.id} request={request} now={now} />
        ))}
      </ul>
      <Pager page={shown} total={requests.length} onPage={onPage} />
    </Card>
  );
}
