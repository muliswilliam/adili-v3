import {
  Badge,
  Button,
  Card,
  DeadlineChip,
  deadlineSoonDays,
  EmptyState,
  formatDate,
  Icon,
  leaStatusMeta,
  Skeleton,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableRowLink,
} from '@adili/ui';
import { Download01Icon, PlusSignIcon, Shield01Icon } from '@hugeicons/core-free-icons';
import { Link, useRouter } from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';

import type { AccessResult } from '../../server/access-requests.server';
import type { LeaRequest, LeaRequestStatus } from '../../server/access/types';
import { CursorPager } from '../cursor-pager';
import { LoadError } from '../load-error';
import { messages as m } from './messages';
import { packageState, usePackageDownload } from './package';

/** Requests per page of the list. */
export const MY_REQUESTS_PAGE_SIZE = 20;

export function MineBadge({ status }: { status: LeaRequestStatus }) {
  const { label, tone } = leaStatusMeta[status];
  return <Badge variant={tone}>{label}</Badge>;
}

/**
 * The law enforcement officer's requests (spec 10 FE-6), latest first: the reference and when it
 * was sent, the Commission, the officer sought, the case, where it stands and, at the end, the
 * package to download, the decision's deadline or when it was decided.
 */
export function MyRequests({
  result,
  now,
}: {
  /** Null while the list loads. */
  result: AccessResult<LeaRequest[]> | null;
  now: string;
}) {
  const [page, setPage] = useState(0);
  if (result === null) {
    return (
      <Card className="overflow-hidden p-0 sm:p-0">
        <ListSkeleton />
      </Card>
    );
  }
  if (!result.ok) {
    return (
      <LoadError title={m.listErrorTitle} detail={m.listErrorDetail} retryLabel={m.tryAgain} />
    );
  }
  const requests = result.data;
  if (requests.length === 0) {
    return (
      <Card className="p-0 sm:p-0">
        <EmptyState
          icon={<Icon icon={Shield01Icon} />}
          title={m.emptyTitle}
          description={m.emptyText}
          action={<NewRequestButton />}
        />
      </Card>
    );
  }
  const pages = Math.ceil(requests.length / MY_REQUESTS_PAGE_SIZE);
  const current = Math.min(page, pages - 1);
  const shown = requests.slice(
    current * MY_REQUESTS_PAGE_SIZE,
    (current + 1) * MY_REQUESTS_PAGE_SIZE,
  );
  return (
    <Card className="overflow-hidden p-0 sm:p-0">
      <div className="hidden min-[820px]:block">
        <RequestsTable requests={shown} now={now} />
      </div>
      <div className="min-[820px]:hidden">
        <RequestCards requests={shown} now={now} />
      </div>
      {requests.length > MY_REQUESTS_PAGE_SIZE ? (
        <CursorPager
          labels={{
            pagination: m.pagination,
            pageRange: m.pageRange,
            pageRows: m.pageRows,
            previousPage: m.previousPage,
            nextPage: m.nextPage,
          }}
          range={{
            from: current * MY_REQUESTS_PAGE_SIZE + 1,
            to: current * MY_REQUESTS_PAGE_SIZE + shown.length,
          }}
          rows={shown.length}
          hasPrevious={current > 0}
          hasNext={current < pages - 1}
          onPrevious={() => {
            setPage(current - 1);
          }}
          onNext={() => {
            setPage(current + 1);
          }}
        />
      ) : null}
    </Card>
  );
}

export function NewRequestButton({ size = 'sm' }: { size?: 'sm' | 'default' }) {
  return (
    <Button asChild size={size}>
      <Link to="/lea/requests/new">
        <Icon icon={PlusSignIcon} />
        {m.newRequest}
      </Link>
    </Button>
  );
}

function Sub({ children }: { children: ReactNode }) {
  return (
    <div className="mt-0.5 text-[13px] whitespace-nowrap text-muted-foreground">{children}</div>
  );
}

function RequestLink({ request }: { request: LeaRequest }) {
  return (
    <TableRowLink asChild className="font-mono text-[13.5px] font-semibold whitespace-nowrap">
      <Link to="/lea/requests/$leaRequestId" params={{ leaRequestId: request.id }}>
        {request.reference}
      </Link>
    </TableRowLink>
  );
}

/** The package to download, the decision's deadline, or when it was decided. */
function Action({ request, now }: { request: LeaRequest; now: string }) {
  const router = useRouter();
  const { busy, download } = usePackageDownload(() => void router.invalidate());
  const state = packageState(request, Date.parse(now));
  switch (state.kind) {
    case 'ready':
      return (
        <div className="relative z-10">
          <Button
            variant="secondary"
            size="sm"
            disabled={busy !== null}
            aria-label={m.downloadOf(request.reference)}
            onClick={() => void download(state.documentId)}
          >
            {busy ? <Spinner className="size-4" /> : <Icon icon={Download01Icon} />}
            {m.download}
          </Button>
          <Sub>{m.until(formatDate(state.until))}</Sub>
        </div>
      );
    case 'closed':
      return (
        <span className="text-[13px] text-muted-foreground">
          {m.windowClosedOn(formatDate(state.until))}
        </span>
      );
    case 'preparing':
      return (
        <span className="inline-flex items-center gap-2 text-[13px] text-muted-foreground">
          <Spinner className="size-3.5" />
          {m.preparing}
        </span>
      );
    case 'missing':
    case 'none':
      break;
  }
  if (request.status === 'received' || request.status === 'verified') {
    return (
      <>
        <DeadlineChip
          due={request.deadlineAt}
          soonDays={deadlineSoonDays.lawEnforcement}
          label={m.decisionDue}
        />
        <Sub>{m.decisionDueOn(formatDate(request.deadlineAt))}</Sub>
      </>
    );
  }
  return (
    <span className="text-[13px] text-muted-foreground">
      {request.decision ? m.decidedOn(formatDate(request.decision.decidedAt)) : m.withdrawn}
    </span>
  );
}

function Header() {
  return (
    <TableHeader>
      <TableRow>
        <TableHead>{m.columnReference}</TableHead>
        <TableHead>{m.columnCommission}</TableHead>
        <TableHead>{m.columnOfficer}</TableHead>
        <TableHead>{m.columnCase}</TableHead>
        <TableHead>{m.columnStatus}</TableHead>
        <TableHead>
          <span className="sr-only">{m.columnAction}</span>
        </TableHead>
      </TableRow>
    </TableHeader>
  );
}

function RequestsTable({ requests, now }: { requests: LeaRequest[]; now: string }) {
  return (
    <Table caption={m.listCaption}>
      <Header />
      <TableBody>
        {requests.map((request) => (
          <TableRow key={request.id}>
            <TableHead scope="row" className="font-normal">
              <RequestLink request={request} />
              <Sub>{formatDate(request.receivedAt)}</Sub>
            </TableHead>
            <TableCell className="min-w-[150px]">
              <div className="font-medium">{request.commission.slug.toUpperCase()}</div>
              <div
                className="mt-0.5 max-w-[200px] truncate text-[13px] text-muted-foreground"
                title={request.commission.name}
              >
                {request.commission.name}
              </div>
            </TableCell>
            <TableCell className="min-w-[160px] font-medium">
              {request.officerSought.name}
            </TableCell>
            <TableCell>
              <span className="font-mono text-[13px] whitespace-nowrap">
                {request.caseReference}
              </span>
            </TableCell>
            <TableCell>
              <MineBadge status={request.status} />
            </TableCell>
            <TableCell className="whitespace-nowrap">
              <Action request={request} now={now} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Below 820px the table becomes a list of cards. */
function RequestCards({ requests, now }: { requests: LeaRequest[]; now: string }) {
  return (
    <ul aria-label={m.listCaption}>
      {requests.map((request) => (
        <li
          key={request.id}
          className="relative grid gap-1.5 border-b px-4 py-3.5 transition-colors last:border-b-0 hover:bg-muted/50"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <RequestLink request={request} />
            <MineBadge status={request.status} />
          </div>
          <p className="text-sm">
            {request.commission.name}
            <span className="text-muted-foreground"> · </span>
            {request.officerSought.name}
          </p>
          <p className="font-mono text-[13px] text-muted-foreground">{request.caseReference}</p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Action request={request} now={now} />
          </div>
        </li>
      ))}
    </ul>
  );
}

const SKELETON_WIDTHS = [
  'w-[190px]',
  'w-[120px]',
  'w-[150px]',
  'w-[120px]',
  'w-[80px]',
  'w-[100px]',
];

function ListSkeleton() {
  return (
    <Table caption={m.listLoadingCaption} aria-busy="true">
      <Header />
      <TableBody>
        {Array.from({ length: 5 }, (_, row) => (
          <TableRow key={row}>
            {SKELETON_WIDTHS.map((width) => (
              <TableCell key={width} className="py-4">
                <Skeleton className={width} />
                <Skeleton className="mt-2 h-3 w-[70px]" />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
