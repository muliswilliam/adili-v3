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
  Tooltip,
} from '@adili/ui';
import { Link } from '@tanstack/react-router';

import type { Commission } from '../../server/directory/client';
import { formatDateTime, formatRelativeDate } from '../format';
import { CommissionTypeBadge, IssuerCode, OfficerStateBadge } from './badges';
import { messages as m } from './messages';

/** Focus ring for the cells' own focusable bits, which sit above the row link. */
const FOCUSABLE =
  'relative z-10 rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring';

function Header() {
  return (
    <TableHeader>
      <TableRow>
        <TableHead>{m.columnCommission}</TableHead>
        <TableHead>{m.columnType}</TableHead>
        <TableHead>{m.columnCategories}</TableHead>
        <TableHead>{m.columnOfficer}</TableHead>
        <TableHead>{m.columnRoster}</TableHead>
        <TableHead>{m.columnCreated}</TableHead>
      </TableRow>
    </TableHeader>
  );
}

function Muted({ children }: { children: string }) {
  return <span className="text-[13.5px] whitespace-nowrap text-muted-foreground">{children}</span>;
}

function CommissionLink({ commission }: { commission: Commission }) {
  return (
    <TableRowLink asChild>
      <Link to="/commissions/$slug" params={{ slug: commission.slug }}>
        {commission.name}
      </Link>
    </TableRowLink>
  );
}

/** First two citations, then a focusable `+N` whose tooltip lists the rest with descriptions. */
function Categories({ categories }: { categories: Commission['categories'] }) {
  if (categories.length === 0) return <Muted>{m.noCategories}</Muted>;
  const shown = categories.slice(0, 2);
  const rest = categories.slice(2);
  return (
    <span className="flex flex-nowrap items-center gap-1.5">
      {shown.map((category, index) => (
        <span
          key={category.code}
          className="text-[13px] font-medium whitespace-nowrap text-secondary-foreground tabular-nums"
        >
          {category.citation}
          {index < shown.length - 1 ? ',' : null}
        </span>
      ))}
      {rest.length > 0 ? (
        <Tooltip
          className="grid max-w-[320px] gap-1 font-normal"
          content={rest.map((category) => (
            <span key={category.code}>
              <b className="font-semibold">{category.citation}</b> {category.description}
            </span>
          ))}
        >
          <span
            tabIndex={0}
            aria-label={m.moreCategories(
              rest.length,
              rest.map((category) => category.citation).join(', '),
            )}
            className={`inline-flex cursor-default ${FOCUSABLE}`}
          >
            <Badge className="rounded-sm font-semibold">+{rest.length}</Badge>
          </span>
        </Tooltip>
      ) : null}
    </span>
  );
}

function Officer({ officer }: { officer: Commission['reportingOfficer'] }) {
  if (!officer) return <Muted>{m.officerNone}</Muted>;
  return (
    <span className="flex flex-col items-start gap-[3px]">
      <span className="whitespace-nowrap">{officer.name}</span>
      <OfficerStateBadge state={officer.state} />
    </span>
  );
}

function Created({ iso }: { iso: string }) {
  return (
    <Tooltip content={formatDateTime(iso)}>
      <time dateTime={iso} tabIndex={0} suppressHydrationWarning className={FOCUSABLE}>
        {formatRelativeDate(iso)}
      </time>
    </Tooltip>
  );
}

function CommissionsTable({ items }: { items: readonly Commission[] }) {
  return (
    <Table caption={m.caption}>
      <Header />
      <TableBody>
        {items.map((commission) => (
          <TableRow key={commission.id}>
            <TableHead scope="row" className="min-w-[270px] font-normal whitespace-normal">
              <CommissionLink commission={commission} />
              <IssuerCode code={commission.issuerCode} className="mt-0.5" />
            </TableHead>
            <TableCell>
              <CommissionTypeBadge type={commission.type} />
            </TableCell>
            <TableCell>
              <Categories categories={commission.categories} />
            </TableCell>
            <TableCell>
              <Officer officer={commission.reportingOfficer} />
            </TableCell>
            <TableCell>
              {/* Coverage ("X of Y onboarded") arrives with the roster import (spec 02). */}
              <Muted>{m.noRoster}</Muted>
            </TableCell>
            <TableCell className="whitespace-nowrap">
              <Created iso={commission.createdAt} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Below 700px the table becomes a list of cards (the prototype's `.mlist`). */
function CommissionsCards({ items }: { items: readonly Commission[] }) {
  return (
    <ul aria-label={m.caption}>
      {items.map((commission) => (
        <li
          key={commission.id}
          className="relative flex flex-col gap-2 border-b px-4 py-3.5 transition-colors last:border-b-0 hover:bg-muted/50"
        >
          <div className="flex items-start gap-2.5">
            <div className="min-w-0 flex-1 leading-snug">
              <CommissionLink commission={commission} />
              <IssuerCode code={commission.issuerCode} />
            </div>
            <CommissionTypeBadge type={commission.type} />
          </div>
          <p className="flex flex-wrap items-center gap-1.5 text-[13px] text-muted-foreground">
            {commission.reportingOfficer ? (
              <>
                {commission.reportingOfficer.name}
                <OfficerStateBadge state={commission.reportingOfficer.state} />
              </>
            ) : (
              m.officerNotAssigned
            )}
          </p>
          <p className="text-[13px] text-muted-foreground">{m.noRoster}</p>
        </li>
      ))}
    </ul>
  );
}

export function CommissionsResults({ items }: { items: readonly Commission[] }) {
  return (
    <>
      <div className="hidden min-[700px]:block">
        <CommissionsTable items={items} />
      </div>
      <div className="min-[700px]:hidden">
        <CommissionsCards items={items} />
      </div>
    </>
  );
}

const SKELETON_WIDTHS = ['w-[140px]', 'w-[54px]', 'w-[70px]', 'w-[154px]', 'w-10', 'w-[100px]'];

/** Five placeholder rows under the real header while the list loads; the table is marked busy. */
export function CommissionsTableSkeleton() {
  return (
    <Table caption={m.loadingCaption} aria-busy="true">
      <Header />
      <TableBody>
        {Array.from({ length: 5 }, (_, row) => (
          <TableRow key={row}>
            {SKELETON_WIDTHS.map((width) => (
              <TableCell key={width}>
                <Skeleton className={width} />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
