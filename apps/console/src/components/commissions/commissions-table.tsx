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
import { useId } from 'react';

import type { Commission } from '../../server/directory/types';
import { CommissionTypeBadge, OfficerStateBadge } from './badges';
import { formatAgo, formatDateTime, summariseCategories } from './format';
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

function IssuerCode({ code }: { code: string }) {
  return (
    <span className="block font-mono text-xs font-medium tracking-[0.04em] text-muted-foreground">
      {code}
    </span>
  );
}

function Muted({ children }: { children: string }) {
  return <span className="text-[13.5px] text-muted-foreground">{children}</span>;
}

/**
 * The first two citations, then a "+N" chip whose tooltip lists the rest with their
 * descriptions. The chip is focusable so keyboard users get the tooltip too, and sits above the
 * row link.
 */
export function CategoriesCell({ categories }: { categories: Commission['categories'] }) {
  const tooltipId = useId();
  if (categories.length === 0) return <Muted>{messages.categoriesNone}</Muted>;
  const { visible, hidden } = summariseCategories(categories);
  return (
    <span className="flex flex-nowrap items-center gap-1.5">
      {visible.map((category, index) => (
        <span
          key={category.code}
          className="text-[13px] font-medium whitespace-nowrap text-secondary-foreground tabular-nums"
        >
          {category.citation}
          {index < visible.length - 1 ? ',' : null}
        </span>
      ))}
      {hidden.length > 0 ? (
        <span
          tabIndex={0}
          role="note"
          aria-label={messages.categoriesMore(hidden.map((category) => category.citation))}
          aria-describedby={tooltipId}
          className="group relative z-10 inline-flex cursor-default rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          onKeyDown={(event) => {
            if (event.key === 'Escape') event.currentTarget.blur();
          }}
        >
          <span className="inline-flex h-[22px] items-center rounded-sm bg-muted px-[7px] text-xs font-semibold text-secondary-foreground">
            +{hidden.length}
          </span>
          <span
            id={tooltipId}
            role="tooltip"
            className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-30 hidden w-max max-w-[320px] min-w-[220px] -translate-x-1/2 space-y-1 rounded-lg bg-primary px-3 py-2.5 text-left text-[12.5px] leading-[1.45] font-normal whitespace-normal text-primary-foreground shadow-pop group-hover:block group-focus:block"
          >
            {hidden.map((category) => (
              <span key={category.code} className="block">
                <b className="font-semibold">{category.citation}</b> {category.description}
              </span>
            ))}
          </span>
        </span>
      ) : null}
    </span>
  );
}

function OfficerCell({ officer }: { officer: Commission['reportingOfficer'] }) {
  if (!officer) return <Muted>{messages.officerState.none}</Muted>;
  return (
    <span className="flex flex-col items-start gap-[3px]">
      <span className="whitespace-nowrap">{officer.name}</span>
      <OfficerStateBadge state={officer.state} />
    </span>
  );
}

export function RosterCell({ roster }: { roster: Commission['roster'] }) {
  if (roster.status === 'none') return <Muted>{messages.rosterNone}</Muted>;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className="font-medium tabular-nums">
        {messages.rosterOnboarded(roster.onboardedDeclarants, roster.expectedDeclarants)}
      </span>
      {roster.flagged > 0 ? (
        <Badge variant="warning">{messages.rosterFlagged(roster.flagged)}</Badge>
      ) : null}
    </span>
  );
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

function CommissionsTable({ commissions }: { commissions: readonly Commission[] }) {
  return (
    <Table caption={messages.table.caption}>
      <Header />
      <TableBody>
        {commissions.map((commission) => (
          <TableRow key={commission.id}>
            <TableHead scope="row" className="min-w-[270px] font-normal whitespace-normal">
              <CommissionLink commission={commission} />
              <span className="mt-0.5 block">
                <IssuerCode code={commission.issuerCode} />
              </span>
            </TableHead>
            <TableCell>
              <CommissionTypeBadge type={commission.type} />
            </TableCell>
            <TableCell>
              <CategoriesCell categories={commission.categories} />
            </TableCell>
            <TableCell>
              <OfficerCell officer={commission.reportingOfficer} />
            </TableCell>
            <TableCell>
              <RosterCell roster={commission.roster} />
            </TableCell>
            <TableCell className="whitespace-nowrap">
              <time
                dateTime={commission.createdAt}
                title={formatDateTime(commission.createdAt)}
                suppressHydrationWarning
              >
                {formatAgo(commission.createdAt)}
              </time>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Below 700px the table becomes a list of cards (the prototype's `.mlist`). */
function CommissionsCards({ commissions }: { commissions: readonly Commission[] }) {
  return (
    <ul aria-label={messages.table.caption}>
      {commissions.map((commission) => (
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
              messages.officerNone
            )}
          </p>
          <p className="text-[13px] text-muted-foreground">
            {commission.roster.status === 'none'
              ? messages.rosterNone
              : messages.rosterOnboarded(
                  commission.roster.onboardedDeclarants,
                  commission.roster.expectedDeclarants,
                )}
          </p>
        </li>
      ))}
    </ul>
  );
}

export function CommissionsResults({ commissions }: { commissions: readonly Commission[] }) {
  return (
    <>
      <div className="hidden min-[700px]:block">
        <CommissionsTable commissions={commissions} />
      </div>
      <div className="min-[700px]:hidden">
        <CommissionsCards commissions={commissions} />
      </div>
    </>
  );
}

const SKELETON_WIDTHS = ['w-[140px]', 'w-[54px]', 'w-[70px]', 'w-[154px]', 'w-10', 'w-[100px]'];

/** Five placeholder rows under the real header while the list loads. */
export function CommissionsTableSkeleton() {
  return (
    <Table caption={messages.table.loadingCaption} aria-busy="true">
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
