import {
  Badge,
  Button,
  Card,
  cn,
  DeadlineChip,
  deadlineSoonDays,
  EmptyState,
  focusRingInset,
  Icon,
} from '@adili/ui';
import {
  Add01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Calendar03Icon,
  File01Icon,
} from '@hugeicons/core-free-icons';
import { Link } from '@tanstack/react-router';

import { day, REQUESTS_COPY as COPY } from '../../access/copy';
import type { RequestSummary } from '../../server/access-requests.server';
import { RequestStatusBadge, RequestStatusTile } from './request-status';

export const REQUESTS_PAGE_SIZE = 10;

const DECIDED = new Set(['granted', 'partially-granted', 'denied']);
const OPEN = new Set([
  'submitted',
  'pending-applicant-verification',
  'officer-unresolved',
  'awaiting-representations',
  'under-decision',
]);

/** The line under a row's reference: when it was submitted, decided, withdrawn or closed. */
function dateLine(request: RequestSummary): string {
  if (request.closedAt && DECIDED.has(request.status)) return COPY.decidedOn(day(request.closedAt));
  if (request.closedAt && request.status === 'withdrawn') {
    return COPY.withdrawnOn(day(request.closedAt));
  }
  if (request.closedAt && request.status === 'cannot-identify') {
    return COPY.closedOn(day(request.closedAt));
  }
  return COPY.submittedOn(day(request.submittedAt));
}

/** The decision clock while the request is open: due date, then due soon or late from day 20. */
function DecisionDue({ request, now }: { request: RequestSummary; now: number }) {
  if (!OPEN.has(request.status)) return null;
  const daysLeft = Math.ceil((Date.parse(request.decisionDeadlineAt) - now) / 86_400_000);
  if (daysLeft > deadlineSoonDays.decision) {
    return (
      <Badge variant="default">
        <Icon icon={Calendar03Icon} strokeWidth={2.2} />
        {COPY.dueOn(day(request.decisionDeadlineAt))}
      </Badge>
    );
  }
  return (
    <DeadlineChip
      due={request.decisionDeadlineAt}
      soonDays={deadlineSoonDays.decision}
      label={COPY.decisionDue}
      now={now}
    />
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
          </span>
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

/** Pages of a list of requests, ten to a page: the range shown and a button per page. */
export function Pager({
  page,
  total,
  onPage,
}: {
  page: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.ceil(total / REQUESTS_PAGE_SIZE);
  if (pages <= 1) return null;
  const from = (page - 1) * REQUESTS_PAGE_SIZE + 1;
  const to = Math.min(total, page * REQUESTS_PAGE_SIZE);
  return (
    <nav
      aria-label={COPY.pagination}
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
 * each with its officer, reference, Commission, status and, while open, the decision clock.
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
