import {
  Button,
  buttonVariants,
  Card,
  cn,
  daysBetween,
  EmptyState,
  FilterChip,
  formatDate,
  Icon,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableRowLink,
} from '@adili/ui';
import { Search01Icon, JusticeScale01Icon } from '@hugeicons/core-free-icons';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import {
  currentAction,
  LADDER_FILTERS,
  type LadderFilter,
  pendingStep,
  subjectOf,
} from '../../actions/ladder';
import type { Ladder, LadderPage } from '../../server/actions.server';
import type { ServiceResult } from '../../server/service-call';
import { LoadError } from '../load-error';
import { salaryStopped } from '../../actions/payroll';
import { SalaryStoppedBadge } from './payroll-instruction';
import { ActionStatusBadge } from './status-badge';
import { en as m, stepLabel } from './messages';

export interface ActionsListProps {
  /** The page for the filter; null while it loads. */
  result: ServiceResult<LadderPage> | null;
  filter: LadderFilter;
  onFilter: (filter: LadderFilter) => void;
  /** The server's clock when the page loaded, for "in 3 days". */
  now: string;
  /** Previous and Next, under the rows. */
  pager?: ReactNode;
}

/**
 * The Commission's administrative action ladders (spec 08 FE-5): a filter by the current step's status,
 * then per ladder what it is about (an overdue declaration or an unanswered clarification), the
 * declarant, the current step with its status and when its window ends, and Review for a step
 * waiting for a decision (Open otherwise).
 */
export function ActionsList({ result, filter, onFilter, now, pager }: ActionsListProps) {
  return (
    <Card className="overflow-hidden p-0 sm:p-0">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <div role="group" aria-label={m.filtersLabel} className="flex flex-wrap gap-1.5">
          {LADDER_FILTERS.map((each) => (
            <FilterChip
              key={each}
              pressed={filter === each}
              onPressedChange={() => {
                onFilter(each);
              }}
            >
              {m.filters[each]}
            </FilterChip>
          ))}
        </div>
      </div>
      {result === null ? (
        <ListSkeleton />
      ) : !result.ok ? (
        <div className="p-5">
          <LoadError title={m.loadErrorTitle} detail={m.loadErrorDetail} retryLabel={m.tryAgain} />
        </div>
      ) : result.data.items.length === 0 ? (
        filter === 'all' ? (
          <EmptyState
            icon={<Icon icon={JusticeScale01Icon} />}
            title={m.emptyTitle}
            description={m.emptyBody}
          />
        ) : (
          <EmptyState
            icon={<Icon icon={Search01Icon} />}
            title={m.emptyFilteredTitle}
            description={m.emptyFilteredBody}
            action={
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  onFilter('all');
                }}
              >
                {m.showAll}
              </Button>
            }
          />
        )
      ) : (
        <>
          <div className="hidden min-[760px]:block">
            <LadderTable items={result.data.items} now={now} />
          </div>
          <LadderCards items={result.data.items} now={now} />
          {pager}
        </>
      )}
    </Card>
  );
}

function Header() {
  return (
    <TableHeader>
      <TableRow>
        <TableHead>{m.columns.subject}</TableHead>
        <TableHead>{m.columns.declarant}</TableHead>
        <TableHead>{m.columns.step}</TableHead>
        <TableHead>{m.columns.window}</TableHead>
        <TableHead>
          <span className="sr-only">{m.open}</span>
        </TableHead>
      </TableRow>
    </TableHeader>
  );
}

function Sub({ children }: { children: ReactNode }) {
  return <div className="mt-0.5 text-[13px] text-muted-foreground">{children}</div>;
}

function Subject({ ladder }: { ladder: Ladder }) {
  const subject = subjectOf(ladder);
  return (
    <>
      <div className={cn('font-medium', subject.reference && 'font-mono text-[13.5px]')}>
        {subject.title}
      </div>
      <Sub>{subject.cause}</Sub>
    </>
  );
}

function CurrentStep({ ladder }: { ladder: Ladder }) {
  const action = currentAction(ladder);
  if (!action) return null;
  return (
    <div className="grid justify-items-start gap-1">
      <span className="font-medium">{stepLabel(action.step)}</span>
      {salaryStopped(action) ? (
        <SalaryStoppedBadge />
      ) : (
        <ActionStatusBadge status={action.status} />
      )}
    </div>
  );
}

/** When the current step's window ends, or how the ladder ended. */
function WindowEnds({ ladder, now }: { ladder: Ladder; now: string }) {
  if (ladder.status === 'complied' && ladder.endedAt) {
    return (
      <span className="text-muted-foreground">{m.compliedOn(formatDate(ladder.endedAt))}</span>
    );
  }
  if (ladder.status !== 'active') return <span className="text-muted-foreground">{m.ended}</span>;
  const windowEndsAt = currentAction(ladder)?.windowEndsAt ?? null;
  if (!windowEndsAt) return <span className="text-muted-foreground">-</span>;
  return (
    <>
      <div>{formatDate(windowEndsAt)}</div>
      <Sub>{m.inDays(daysBetween(now, windowEndsAt))}</Sub>
    </>
  );
}

function OpenLink({ ladder }: { ladder: Ladder }) {
  const waiting = pendingStep(ladder) !== null;
  return (
    <TableRowLink asChild className="no-underline hover:no-underline">
      <Link
        to="/actions/$ladderId"
        params={{ ladderId: ladder.id }}
        aria-label={m.openLabel(ladder.declarantName)}
        className={buttonVariants({ variant: waiting ? 'default' : 'secondary', size: 'sm' })}
      >
        {waiting ? m.review : m.open}
      </Link>
    </TableRowLink>
  );
}

function LadderTable({ items, now }: { items: readonly Ladder[]; now: string }) {
  return (
    <Table caption={m.title}>
      <Header />
      <TableBody>
        {items.map((ladder) => (
          <TableRow key={ladder.id}>
            <TableHead scope="row" className="min-w-[200px] font-normal">
              <Subject ladder={ladder} />
            </TableHead>
            <TableCell className="min-w-[200px]">
              <div className="font-medium">{ladder.declarantName}</div>
              <Sub>{m.fileNumber(ladder.personnelFileNumber)}</Sub>
            </TableCell>
            <TableCell className="min-w-[180px]">
              <CurrentStep ladder={ladder} />
            </TableCell>
            <TableCell className="whitespace-nowrap">
              <WindowEnds ladder={ladder} now={now} />
            </TableCell>
            <TableCell className="text-right">
              <OpenLink ladder={ladder} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Below 760px the table becomes a list of cards. */
function LadderCards({ items, now }: { items: readonly Ladder[]; now: string }) {
  return (
    <ul aria-label={m.title} className="min-[760px]:hidden">
      {items.map((ladder) => (
        <li
          key={ladder.id}
          className="relative grid gap-2 border-b px-4 py-3.5 transition-colors last:border-b-0 hover:bg-muted/50"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-medium">{ladder.declarantName}</div>
              <div className="text-[13px] text-muted-foreground">
                <Subject ladder={ladder} />
              </div>
            </div>
            <OpenLink ladder={ladder} />
          </div>
          <div className="flex flex-wrap items-end justify-between gap-3 text-sm">
            <CurrentStep ladder={ladder} />
            <div className="text-right">
              <WindowEnds ladder={ladder} now={now} />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

const SKELETON_WIDTHS = ['w-[170px]', 'w-[190px]', 'w-[130px]', 'w-[90px]', 'w-[60px]'];

/** Placeholder rows under the real header while the page loads; the table is marked busy. */
function ListSkeleton() {
  return (
    <Table caption={m.title} aria-busy="true">
      <Header />
      <TableBody>
        {Array.from({ length: 6 }, (_, row) => (
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
