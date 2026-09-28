import { Button, Card, EmptyState, formatDate, Icon } from '@adili/ui';
import { SquareLock02Icon, UserGroupIcon, ViewIcon } from '@hugeicons/core-free-icons';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import type { Commission, DirectoryResult, RosterImportPage } from '../../server/directory/client';
import { formatNumber, formatRelativeTime } from '../format';
import { SectionCard } from '../page';
import { onboardedPercent } from '../roster/coverage';
import { ImportHistoryResults } from '../roster/import-history-table';
import { messages as m } from './messages';

/**
 * The Commission detail's roster card (spec 02 FE-9), read only: coverage tiles and the import
 * history for platform admins and EACC, each import opening its report, and for platform admins
 * the way into the records.
 */
export function RosterCard({
  commission,
  imports,
  pager,
  canOpenRecords,
  className,
}: {
  commission: Commission;
  /** The page of the import history on show; null when not loaded (no workspace). */
  imports: DirectoryResult<RosterImportPage> | null;
  /** Pages through the import history, under it. */
  pager: ReactNode;
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
      <ImportHistory slug={commission.slug} imports={imports} pager={pager} />
    </SectionCard>
  );
}

/** A stat tile inside the card (the kit's `.tile`). */
function Tile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Card className="min-w-0 gap-1.5 p-4 sm:p-4">
      <p className="text-[13px] font-medium text-muted-foreground">{label}</p>
      {children}
    </Card>
  );
}

function TileValue({ children }: { children: ReactNode }) {
  return (
    <p className="text-[26px] leading-[1.15] font-semibold tracking-[-0.02em] tabular-nums">
      {children}
    </p>
  );
}

/** The Commission's import history, a page at a time, each import linking to its report. */
function ImportHistory({
  slug,
  imports,
  pager,
}: {
  slug: string;
  imports: DirectoryResult<RosterImportPage> | null;
  pager: ReactNode;
}) {
  if (!imports) return null;
  if (!imports.ok) {
    return (
      <p className="border-t px-5 py-4 text-sm text-muted-foreground">{m.rosterImportsError}</p>
    );
  }
  if (imports.data.items.length === 0 && !imports.data.nextCursor) {
    return (
      <p className="border-t px-5 py-4 text-sm text-muted-foreground">{m.rosterImportsEmpty}</p>
    );
  }
  return (
    <div className="border-t">
      <ImportHistoryResults items={imports.data.items} slug={slug} />
      {pager}
    </div>
  );
}
