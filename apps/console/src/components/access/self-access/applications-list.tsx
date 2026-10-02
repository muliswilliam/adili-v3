import {
  Badge,
  Card,
  DeadlineChip,
  deadlineSoonDays,
  EmptyState,
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
import { Certificate01Icon } from '@hugeicons/core-free-icons';
import type { ReactNode } from 'react';

import type {
  SelfAccessApplication,
  SelfAccessPage,
  SelfAccessResult,
} from '../../../server/self-access.server';
import { LoadError } from '../../load-error';
import { shortDate } from '../format';
import { applicationState, deadlineRuns, STATE_TONE } from './application-view';
import { messages as m } from './messages';

export interface ApplicationsListProps {
  /** The page; null while it loads. */
  result: SelfAccessResult<SelfAccessPage> | null;
  /** The declarant's name as a link to the application. */
  applicationLink: (application: SelfAccessApplication) => ReactNode;
  readOnly: boolean;
  /** Previous and Next, under the rows. */
  pager?: ReactNode;
}

/**
 * The Commission's written self-access applications (the prototype's Certified copies tab),
 * earliest deadline first: the declarant, who applied, the version and delivery, where the
 * copy stands and its 14-day deadline (or when it was issued, collected or dispatched).
 */
export function ApplicationsList({
  result,
  applicationLink,
  readOnly,
  pager,
}: ApplicationsListProps) {
  return (
    <Card className="overflow-hidden p-0 sm:p-0">
      {result === null ? (
        <ListSkeleton />
      ) : !result.ok ? (
        <div className="p-5">
          <LoadError title={m.listErrorTitle} detail={m.listErrorDetail} retryLabel={m.tryAgain} />
        </div>
      ) : result.data.items.length === 0 ? (
        <EmptyState
          icon={<Icon icon={Certificate01Icon} />}
          title={m.emptyTitle}
          description={readOnly ? m.emptyTextReadOnly : m.emptyText}
        />
      ) : (
        <>
          <div className="hidden min-[760px]:block">
            <ListTable items={result.data.items} applicationLink={applicationLink} />
          </div>
          <div className="min-[760px]:hidden">
            <ListCards items={result.data.items} applicationLink={applicationLink} />
          </div>
          {pager}
        </>
      )}
    </Card>
  );
}

function Sub({ children }: { children: ReactNode }) {
  return <div className="mt-0.5 text-[13px] text-muted-foreground">{children}</div>;
}

export function StateBadge({ application }: { application: SelfAccessApplication }) {
  const state = applicationState(application);
  return <Badge variant={STATE_TONE[state]}>{m.states[state]}</Badge>;
}

/** The 14-day deadline while the copy is not issued; then when it was issued or handed over. */
export function ApplicationDeadline({
  application,
  withDate = true,
}: {
  application: SelfAccessApplication;
  withDate?: boolean;
}) {
  const state = applicationState(application);
  if (state === 'collected' || state === 'dispatched') {
    const at = application.deliveredAt ?? application.deadlineAt;
    return (
      <span className="text-[13px] text-muted-foreground">
        {state === 'collected' ? m.collectedOn(shortDate(at)) : m.dispatchedOn(shortDate(at))}
      </span>
    );
  }
  if (!deadlineRuns(state) && application.certifiedCopy.issuedAt) {
    return (
      <DeadlineChip
        due={application.deadlineAt}
        soonDays={deadlineSoonDays.certifiedCopy}
        label={m.issueBy}
        met={m.issuedOn(shortDate(application.certifiedCopy.issuedAt))}
      />
    );
  }
  return (
    <>
      <DeadlineChip
        due={application.deadlineAt}
        soonDays={deadlineSoonDays.certifiedCopy}
        label={m.issueBy}
        late={application.late}
      />
      {withDate ? <Sub>{m.issueByOn(shortDate(application.deadlineAt))}</Sub> : null}
    </>
  );
}

function AppliedBy({ application }: { application: SelfAccessApplication }) {
  return application.representative ? (
    <>
      <div className="font-medium">{application.representative.name}</div>
      <Sub>{m.representative}</Sub>
    </>
  ) : (
    <>
      <div className="font-medium">{m.inPerson}</div>
      <Sub>{m.theDeclarant}</Sub>
    </>
  );
}

function Header() {
  return (
    <TableHeader>
      <TableRow>
        <TableHead>{m.columnDeclarant}</TableHead>
        <TableHead>{m.columnAppliedBy}</TableHead>
        <TableHead>{m.columnVersion}</TableHead>
        <TableHead>{m.columnStatus}</TableHead>
        <TableHead>{m.columnDeadline}</TableHead>
      </TableRow>
    </TableHeader>
  );
}

function ListTable({
  items,
  applicationLink,
}: {
  items: readonly SelfAccessApplication[];
  applicationLink: ApplicationsListProps['applicationLink'];
}) {
  return (
    <Table caption={m.listCaption}>
      <Header />
      <TableBody>
        {items.map((application) => (
          <TableRow key={application.id}>
            <TableHead scope="row" className="font-normal">
              <TableRowLink asChild className="font-medium">
                {applicationLink(application)}
              </TableRowLink>
              <Sub>{m.fileNumber(application.declarant.personnelFileNumber)}</Sub>
            </TableHead>
            <TableCell className="min-w-[160px]">
              <AppliedBy application={application} />
            </TableCell>
            <TableCell className="min-w-[200px]">
              <span className="font-mono text-[13px]">{application.declarationReference}</span>
              <Sub>{m.versionLine(application.version, application.deliveryMethod)}</Sub>
            </TableCell>
            <TableCell>
              <StateBadge application={application} />
            </TableCell>
            <TableCell className="whitespace-nowrap">
              <ApplicationDeadline application={application} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Below 760px the table becomes a list of cards. */
function ListCards({
  items,
  applicationLink,
}: {
  items: readonly SelfAccessApplication[];
  applicationLink: ApplicationsListProps['applicationLink'];
}) {
  return (
    <ul aria-label={m.listCaption}>
      {items.map((application) => (
        <li
          key={application.id}
          className="relative grid gap-1.5 border-b px-4 py-3.5 transition-colors last:border-b-0 hover:bg-muted/50"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <TableRowLink asChild className="font-medium">
              {applicationLink(application)}
            </TableRowLink>
            <StateBadge application={application} />
          </div>
          <p className="text-sm">
            <span className="font-mono text-[13px]">{application.declarationReference}</span>
            <span className="text-muted-foreground">
              {` · ${m.versionLine(application.version, application.deliveryMethod)}`}
            </span>
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <ApplicationDeadline application={application} withDate={false} />
          </div>
        </li>
      ))}
    </ul>
  );
}

const SKELETON_WIDTHS = ['w-[170px]', 'w-[130px]', 'w-[180px]', 'w-[90px]', 'w-[110px]'];

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
