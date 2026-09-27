import {
  Skeleton,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableRowLink,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@adili/ui';
import { Link } from '@tanstack/react-router';

import type { Commission } from '../../server/directory/client';
import { formatDate, formatDateTime, formatRelativeDate } from '../format';
import { CommissionTypeBadge, IssuerCode, OfficerStateBadge } from './badges';
import { messages as m } from './messages';

const COLUMNS = [
  m.columnCommission,
  m.columnType,
  m.columnCategories,
  m.columnOfficer,
  m.columnRoster,
  m.columnCreated,
];

function Head() {
  return (
    <TableHeader>
      <TableRow>
        {COLUMNS.map((column) => (
          <TableHead key={column}>{column}</TableHead>
        ))}
      </TableRow>
    </TableHeader>
  );
}

export function CommissionsTable({ items }: { items: Commission[] }) {
  return (
    <Table>
      <TableCaption>{m.caption}</TableCaption>
      <Head />
      <TableBody>
        {items.map((commission) => (
          <CommissionRow key={commission.id} commission={commission} />
        ))}
      </TableBody>
    </Table>
  );
}

function CommissionRow({ commission }: { commission: Commission }) {
  const officer = commission.reportingOfficer;
  return (
    <TableRow>
      <TableCell className="min-w-56">
        <TableRowLink asChild>
          <Link to="/commissions/$slug" params={{ slug: commission.slug }}>
            {commission.name}
          </Link>
        </TableRowLink>
        <IssuerCode code={commission.issuerCode} className="mt-0.5 block" />
      </TableCell>
      <TableCell>
        <CommissionTypeBadge type={commission.type} />
      </TableCell>
      <TableCell>
        <Categories categories={commission.categories} />
      </TableCell>
      <TableCell>
        {officer ? (
          <div className="grid justify-items-start gap-1">
            <span className="whitespace-nowrap">{officer.name}</span>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <OfficerStateBadge state={officer.state} />
              {officer.state === 'activated' && officer.activatedAt ? (
                <time
                  dateTime={officer.activatedAt}
                  className="text-xs whitespace-nowrap text-muted-foreground tabular-nums"
                >
                  {formatDate(officer.activatedAt)}
                </time>
              ) : null}
            </div>
          </div>
        ) : (
          <span className="text-muted-foreground">{m.officerNone}</span>
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">{m.noRoster}</TableCell>
      <TableCell className="whitespace-nowrap">
        <Tooltip>
          <TooltipTrigger asChild>
            <time
              dateTime={commission.createdAt}
              tabIndex={0}
              suppressHydrationWarning
              className="relative z-10 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {formatRelativeDate(commission.createdAt)}
            </time>
          </TooltipTrigger>
          <TooltipContent>{formatDateTime(commission.createdAt)}</TooltipContent>
        </Tooltip>
      </TableCell>
    </TableRow>
  );
}

/** First two citations, then `+N` with the rest in a tooltip. */
function Categories({ categories }: { categories: Commission['categories'] }) {
  if (categories.length === 0) {
    return <span className="text-muted-foreground">{m.noCategories}</span>;
  }
  const shown = categories.slice(0, 2);
  const rest = categories.slice(2);
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
      {shown.map((category, index) => (
        <span key={category.code} className="whitespace-nowrap">
          {category.citation}
          {index < shown.length - 1 ? ',' : ''}
        </span>
      ))}
      {rest.length > 0 ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              tabIndex={0}
              aria-label={m.moreCategories(
                rest.length,
                rest.map((category) => category.citation).join(', '),
              )}
              className="relative z-10 inline-flex h-5 items-center rounded-full bg-secondary px-1.5 text-xs font-medium text-secondary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              +{rest.length}
            </span>
          </TooltipTrigger>
          <TooltipContent className="grid gap-1">
            {rest.map((category) => (
              <span key={category.code}>
                <span className="font-semibold">{category.citation}</span> {category.description}
              </span>
            ))}
          </TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}

/** Five placeholder rows while the list loads; the table is marked busy. */
export function CommissionsTableSkeleton() {
  return (
    <Table aria-busy="true">
      <TableCaption>{m.loadingCaption}</TableCaption>
      <Head />
      <TableBody>
        {Array.from({ length: 5 }, (_, row) => (
          <TableRow key={row}>
            <TableCell>
              <Skeleton className="w-48" />
              <Skeleton className="mt-2 h-3 w-12" />
            </TableCell>
            {['w-16', 'w-24', 'w-28', 'w-24', 'w-20'].map((width, cell) => (
              <TableCell key={cell}>
                <Skeleton className={width} />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
