import {
  Button,
  EmptyState,
  Icon,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@adili/ui';
import { SquareLock02Icon, UserGroupIcon, ViewIcon } from '@hugeicons/core-free-icons';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import type {
  Commission,
  DirectoryResult,
  RosterImport,
  RosterImportPage,
} from '../../server/directory/client';
import { formatDate, formatDateTime, formatNumber, formatRelativeTime } from '../format';
import { SectionCard } from '../page';
import { onboardedPercent } from '../roster/coverage';
import { ImportChannelBadge, ImportStateBadge } from '../roster/roster-badges';
import { messages as m } from './messages';

/** How many of the newest imports the card lists. */
export const RECENT_IMPORTS = 5;

/**
 * The Commission detail's roster card (spec 02 FE-9), read only: coverage tiles and the newest
 * imports for platform admins and EACC, and for platform admins the way into the records.
 */
export function RosterCard({
  commission,
  imports,
  canOpenRecords,
  className,
}: {
  commission: Commission;
  /** The newest imports; null when not loaded (no workspace). */
  imports: DirectoryResult<RosterImportPage> | null;
  /** Platform admins open records (audited); EACC sees counts only. */
  canOpenRecords: boolean;
  className?: string;
}) {
  const { roster } = commission;
  if (roster.status === 'none') {
    return (
      <SectionCard id="roster" icon={UserGroupIcon} title={m.rosterCardTitle} className={className}>
        <EmptyState
          icon={<Icon icon={UserGroupIcon} />}
          title={m.rosterNoneTitle}
          description={m.rosterNoneText}
        />
      </SectionCard>
    );
  }
  const percent = onboardedPercent(roster.onboardedDeclarants, roster.expectedDeclarants);
  return (
    <SectionCard
      id="roster"
      icon={UserGroupIcon}
      title={m.rosterCardTitle}
      className={className}
      actions={
        canOpenRecords ? (
          <Button asChild variant="secondary" size="sm">
            <Link to="/commissions/$slug/records" params={{ slug: commission.slug }}>
              <Icon icon={ViewIcon} />
              {m.rosterOpenRecords}
            </Link>
          </Button>
        ) : null
      }
    >
      <div className="grid gap-3.5 p-5">
        <section
          aria-label={m.rosterSummary}
          className="grid grid-cols-2 gap-3 min-[900px]:grid-cols-4"
        >
          <Tile label={m.rosterExpected}>
            <TileValue>{formatNumber(roster.expectedDeclarants)}</TileValue>
          </Tile>
          <Tile label={m.rosterOnboarded}>
            <TileValue>
              {formatNumber(roster.onboardedDeclarants)}{' '}
              <small className="text-sm font-medium tracking-normal text-muted-foreground">
                {m.rosterOnboardedShare(percent)}
              </small>
            </TileValue>
          </Tile>
          <Tile label={m.rosterFlaggedAbsent}>
            <TileValue>{formatNumber(roster.flagged)}</TileValue>
          </Tile>
          <Tile label={m.rosterLastImportTile}>
            {roster.lastImportAt ? (
              <>
                <p className="mt-1.5 text-[17px] leading-tight font-semibold tracking-[-0.01em]">
                  <time dateTime={roster.lastImportAt}>{formatDate(roster.lastImportAt)}</time>
                </p>
                <p className="text-[12.5px] text-muted-foreground" suppressHydrationWarning>
                  {formatRelativeTime(roster.lastImportAt)}
                </p>
              </>
            ) : (
              <p className="mt-1.5 text-[17px] leading-tight font-semibold text-muted-foreground">
                {m.rosterNoImport}
              </p>
            )}
          </Tile>
        </section>
        <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground [&_svg]:size-3.5">
          <Icon icon={canOpenRecords ? ViewIcon : SquareLock02Icon} />
          {canOpenRecords ? m.rosterAudited : m.rosterCountsOnly}
        </p>
      </div>
      <RecentImports imports={imports} />
    </SectionCard>
  );
}

/** A stat tile inside the card (the kit's `.tile`). */
function Tile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-[14px] bg-card p-4 shadow-card">
      <p className="text-[13px] font-medium text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

function TileValue({ children }: { children: ReactNode }) {
  return (
    <p className="text-[26px] leading-[1.15] font-semibold tracking-[-0.02em] tabular-nums">
      {children}
    </p>
  );
}

function Count({ value }: { value: number | undefined }) {
  return value === undefined ? (
    <span className="text-muted-foreground">{m.rosterNoCount}</span>
  ) : (
    <>{formatNumber(value)}</>
  );
}

const NUMERIC = 'text-right tabular-nums';

function RecentImports({ imports }: { imports: DirectoryResult<RosterImportPage> | null }) {
  if (!imports) return null;
  if (!imports.ok) {
    return (
      <p className="border-t px-5 py-4 text-sm text-muted-foreground">{m.rosterImportsError}</p>
    );
  }
  const items = imports.data.items.slice(0, RECENT_IMPORTS);
  if (items.length === 0) {
    return (
      <p className="border-t px-5 py-4 text-sm text-muted-foreground">{m.rosterImportsEmpty}</p>
    );
  }
  return (
    <>
      <div className="border-t">
        <Table caption={m.rosterImportsCaption}>
          <TableHeader>
            <TableRow>
              <TableHead>{m.rosterColumnStarted}</TableHead>
              <TableHead>{m.rosterColumnChannel}</TableHead>
              <TableHead>{m.rosterColumnComplete}</TableHead>
              <TableHead>{m.rosterColumnState}</TableHead>
              <TableHead className={NUMERIC}>{m.rosterColumnCreated}</TableHead>
              <TableHead className={NUMERIC}>{m.rosterColumnUpdated}</TableHead>
              <TableHead className={NUMERIC}>{m.rosterColumnRejected}</TableHead>
              <TableHead className={NUMERIC}>{m.rosterColumnFlagged}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <ImportRow key={item.id} item={item} />
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="border-t px-4 py-2.5 text-[13.5px] text-muted-foreground">
        {m.rosterImportsLatest(items.length)}
      </p>
    </>
  );
}

function ImportRow({ item }: { item: RosterImport }) {
  const { counts } = item;
  return (
    <TableRow>
      <TableHead scope="row" className="font-medium whitespace-nowrap">
        <time dateTime={item.startedAt}>{formatDateTime(item.startedAt)}</time>
      </TableHead>
      <TableCell>
        <ImportChannelBadge channel={item.channel} />
      </TableCell>
      <TableCell className="whitespace-nowrap">
        {item.declaredComplete ? m.rosterCompleteYes : m.rosterCompletePartial}
      </TableCell>
      <TableCell>
        <ImportStateBadge state={item.state} />
      </TableCell>
      <TableCell className={NUMERIC}>
        <Count value={counts?.created} />
      </TableCell>
      <TableCell className={NUMERIC}>
        <Count value={counts?.updated} />
      </TableCell>
      <TableCell className={NUMERIC}>
        <Count value={counts?.rejected} />
      </TableCell>
      <TableCell className={NUMERIC}>
        <Count value={counts?.flaggedAbsent} />
      </TableCell>
    </TableRow>
  );
}
