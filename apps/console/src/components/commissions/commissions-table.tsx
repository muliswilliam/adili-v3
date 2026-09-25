import {
  Badge,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableRowLink,
} from '@adili/ui';
import { Link } from '@tanstack/react-router';

import type { Commission } from '../../server/directory/types';
import { formatDateTime, formatRelative, summariseCategories } from './format';
import { messages } from './messages';

function Header() {
  return (
    <TableHeader>
      <TableRow>
        <TableHead>{messages.table.commission}</TableHead>
        <TableHead>{messages.table.type}</TableHead>
        <TableHead>{messages.table.categories}</TableHead>
        <TableHead>{messages.table.reportingOfficer}</TableHead>
        <TableHead>{messages.table.roster}</TableHead>
        <TableHead>{messages.table.created}</TableHead>
      </TableRow>
    </TableHeader>
  );
}

export function CommissionTypeBadge({ type }: { type: Commission['type'] }) {
  return <Badge>{messages.type[type]}</Badge>;
}

function Categories({ categories }: { categories: Commission['categories'] }) {
  if (categories.length === 0) {
    return <span className="text-muted-foreground">{messages.categoriesNone}</span>;
  }
  const { visible, hidden } = summariseCategories(categories);
  const rest = hidden.join(', ');
  return (
    <span className="font-mono text-[13px] whitespace-nowrap">
      {visible.join(', ')}
      {hidden.length > 0 ? (
        <span title={rest} className="ml-1.5 font-sans text-muted-foreground">
          +{hidden.length}
          <span className="sr-only">: {rest}</span>
        </span>
      ) : null}
    </span>
  );
}

function ReportingOfficer({ officer }: { officer: Commission['reportingOfficer'] }) {
  if (!officer) {
    return <span className="text-muted-foreground">{messages.officerState.none}</span>;
  }
  const activated = officer.state === 'activated';
  return (
    <span className="flex flex-col items-start gap-1">
      <span>{officer.name}</span>
      <Badge variant={activated ? 'success' : 'warning'}>
        {activated ? messages.officerState.activated : messages.officerState.invited}
      </Badge>
    </span>
  );
}

function Roster({ roster }: { roster: Commission['roster'] }) {
  if (roster.status === 'none') {
    return <span className="text-muted-foreground">{messages.rosterNone}</span>;
  }
  return (
    <span>{messages.rosterOnboarded(roster.onboardedDeclarants, roster.expectedDeclarants)}</span>
  );
}

export function CommissionsTable({ commissions }: { commissions: readonly Commission[] }) {
  return (
    <Table caption={messages.table.caption}>
      <Header />
      <TableBody>
        {commissions.map((commission) => (
          <TableRow key={commission.id}>
            <TableHead scope="row" className="py-3 whitespace-normal">
              <span className="flex flex-col gap-0.5">
                <TableRowLink asChild>
                  <Link to="/commissions/$slug" params={{ slug: commission.slug }}>
                    {commission.name}
                  </Link>
                </TableRowLink>
                <span className="font-mono text-xs font-normal text-muted-foreground uppercase">
                  {commission.issuerCode}
                </span>
              </span>
            </TableHead>
            <TableCell>
              <CommissionTypeBadge type={commission.type} />
            </TableCell>
            <TableCell>
              <Categories categories={commission.categories} />
            </TableCell>
            <TableCell>
              <ReportingOfficer officer={commission.reportingOfficer} />
            </TableCell>
            <TableCell>
              <Roster roster={commission.roster} />
            </TableCell>
            <TableCell className="whitespace-nowrap">
              <time
                dateTime={commission.createdAt}
                title={formatDateTime(commission.createdAt)}
                suppressHydrationWarning
              >
                {formatRelative(commission.createdAt)}
              </time>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Five placeholder rows under the real header, while the list loads. */
export function CommissionsTableSkeleton() {
  return (
    <div aria-busy="true">
      <Table caption={messages.table.caption}>
        <Header />
        <TableBody>
          {Array.from({ length: 5 }, (_, row) => (
            <TableRow key={row}>
              <TableCell>
                <Skeleton className="h-4 w-48" />
                <Skeleton className="mt-1.5 h-3 w-12" />
              </TableCell>
              {Array.from({ length: 5 }, (_, cell) => (
                <TableCell key={cell}>
                  <Skeleton className="h-4 w-20" />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
