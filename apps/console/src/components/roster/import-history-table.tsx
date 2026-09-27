import {
  cn,
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
import { ServerStack01Icon } from '@hugeicons/core-free-icons';
import { Link } from '@tanstack/react-router';

import type { RosterImport } from '../../server/directory/client';
import { formatDateTime, formatNumber } from '../format';
import { ImportChannelBadge, ImportStateBadge } from './roster-badges';
import { importProgress } from './import-progress';
import { importRunning } from './import-report';
import { messages as m } from './messages';

/** Under the start time: the file's name, or the size of an HR system batch. */
function importSubtitle(imp: RosterImport): string | null {
  if (imp.channel === 'api') return imp.totalRows === null ? m.apiBatch : m.batchOf(imp.totalRows);
  return imp.fileName;
}

/** Who started it: the officer's name, or "HR system" and its client id. */
export function StartedBy({ startedBy }: { startedBy: RosterImport['startedBy'] }) {
  if (startedBy.kind === 'client') {
    return (
      <span className="flex flex-col items-start">
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <Icon icon={ServerStack01Icon} className="size-[15px] text-muted-foreground" />
          {m.hrSystem}
        </span>
        <span className="font-mono text-xs text-muted-foreground">{startedBy.id}</span>
      </span>
    );
  }
  return startedBy.name ? (
    <span>{startedBy.name}</span>
  ) : (
    <span className="text-muted-foreground">{m.unknownUser}</span>
  );
}

function ReportLink({ imp }: { imp: RosterImport }) {
  return (
    <TableRowLink asChild>
      <Link to="/roster/imports/$importId" params={{ importId: imp.id }}>
        {formatDateTime(imp.startedAt)}
      </Link>
    </TableRowLink>
  );
}

/** A count once the import has ended; the rejected and flagged ones stand out when not zero. */
function Count({
  imp,
  value,
  tone,
}: {
  imp: RosterImport;
  value: (counts: NonNullable<RosterImport['counts']>) => number;
  tone?: 'destructive' | 'warning';
}) {
  if (!imp.counts || importRunning(imp)) {
    return (
      <span className="text-muted-foreground">
        <span aria-hidden="true">-</span>
        <span className="sr-only">{m.notCounted}</span>
      </span>
    );
  }
  const count = value(imp.counts);
  return (
    <span
      className={cn(
        count > 0 && tone === 'destructive' && 'font-semibold text-destructive',
        count > 0 && tone === 'warning' && 'font-semibold text-warning',
      )}
    >
      {formatNumber(count)}
    </span>
  );
}

function State({ imp }: { imp: RosterImport }) {
  const progress = importProgress(imp);
  return (
    <span className="flex flex-col items-start gap-0.5">
      <ImportStateBadge state={imp.state} />
      {importRunning(imp) && progress.kind === 'rows' ? (
        <span className="text-xs text-muted-foreground tabular-nums">
          {m.percentDone(progress.percent)}
        </span>
      ) : null}
    </span>
  );
}

function Header() {
  return (
    <TableHeader>
      <TableRow>
        <TableHead>{m.columnStarted}</TableHead>
        <TableHead>{m.columnChannel}</TableHead>
        <TableHead>{m.columnComplete}</TableHead>
        <TableHead>{m.columnState}</TableHead>
        <TableHead className="text-right">{m.columnCreated}</TableHead>
        <TableHead className="text-right">{m.columnUpdated}</TableHead>
        <TableHead className="text-right">{m.columnRejected}</TableHead>
        <TableHead className="text-right">{m.columnFlagged}</TableHead>
        <TableHead>{m.columnStartedBy}</TableHead>
      </TableRow>
    </TableHeader>
  );
}

function HistoryTable({ items }: { items: readonly RosterImport[] }) {
  return (
    <Table caption={m.historyCaption}>
      <Header />
      <TableBody>
        {items.map((imp) => {
          const subtitle = importSubtitle(imp);
          return (
            <TableRow key={imp.id}>
              <TableHead scope="row" className="min-w-[220px] font-normal whitespace-normal">
                <span className="font-medium">
                  <ReportLink imp={imp} />
                </span>
                {subtitle ? (
                  <span className="block max-w-[260px] truncate text-[13px] text-muted-foreground">
                    {subtitle}
                  </span>
                ) : null}
              </TableHead>
              <TableCell>
                <ImportChannelBadge channel={imp.channel} />
              </TableCell>
              <TableCell>{imp.declaredComplete ? m.completeYes : m.completePartial}</TableCell>
              <TableCell>
                <State imp={imp} />
              </TableCell>
              <TableCell className="text-right tabular-nums">
                <Count imp={imp} value={(counts) => counts.created} />
              </TableCell>
              <TableCell className="text-right tabular-nums">
                <Count imp={imp} value={(counts) => counts.updated} />
              </TableCell>
              <TableCell className="text-right tabular-nums">
                <Count imp={imp} value={(counts) => counts.rejected} tone="destructive" />
              </TableCell>
              <TableCell className="text-right tabular-nums">
                <Count imp={imp} value={(counts) => counts.flaggedAbsent} tone="warning" />
              </TableCell>
              <TableCell>
                <StartedBy startedBy={imp.startedBy} />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/** Below 900px each import is a card: when and what, its badges, then the counts. */
function HistoryCards({ items }: { items: readonly RosterImport[] }) {
  return (
    <ul aria-label={m.historyCaption}>
      {items.map((imp) => {
        const subtitle = importSubtitle(imp);
        return (
          <li
            key={imp.id}
            className="relative flex flex-col gap-2 border-b px-4 py-3.5 transition-colors last:border-b-0 hover:bg-muted/50"
          >
            <div className="min-w-0 leading-snug">
              <span className="font-medium">
                <ReportLink imp={imp} />
              </span>
              {subtitle ? (
                <span className="block truncate text-[13px] text-muted-foreground">{subtitle}</span>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <ImportChannelBadge channel={imp.channel} />
              <ImportStateBadge state={imp.state} />
              <span className="text-[13px] text-muted-foreground">
                {imp.declaredComplete ? m.completeRoster : m.partialUpdate}
              </span>
            </div>
            {imp.counts && !importRunning(imp) ? (
              <p className="flex flex-wrap gap-x-3.5 gap-y-1 text-[13px] text-muted-foreground">
                <span>
                  <b className="font-semibold text-foreground tabular-nums">
                    {formatNumber(imp.counts.created)}
                  </b>{' '}
                  {m.created.toLowerCase()}
                </span>
                <span>
                  <b className="font-semibold text-foreground tabular-nums">
                    {formatNumber(imp.counts.updated)}
                  </b>{' '}
                  {m.updated.toLowerCase()}
                </span>
                <span>
                  <b className="font-semibold text-foreground tabular-nums">
                    {formatNumber(imp.counts.rejected)}
                  </b>{' '}
                  {m.rejected.toLowerCase()}
                </span>
                <span>
                  <b className="font-semibold text-foreground tabular-nums">
                    {formatNumber(imp.counts.flaggedAbsent)}
                  </b>{' '}
                  {m.columnFlagged.toLowerCase()}
                </span>
              </p>
            ) : null}
            <div className="text-[13px]">
              <StartedBy startedBy={imp.startedBy} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function ImportHistoryResults({ items }: { items: readonly RosterImport[] }) {
  return (
    <>
      <div className="hidden min-[900px]:block">
        <HistoryTable items={items} />
      </div>
      <div className="min-[900px]:hidden">
        <HistoryCards items={items} />
      </div>
    </>
  );
}

const SKELETON_WIDTHS = [
  'w-[150px]',
  'w-[52px]',
  'w-[48px]',
  'w-[86px]',
  'w-8',
  'w-10',
  'w-8',
  'w-8',
  'w-[110px]',
];

/** Placeholder rows under the real header while the history loads; the table is marked busy. */
export function ImportHistorySkeleton() {
  return (
    <Table caption={m.historyLoadingCaption} aria-busy="true">
      <Header />
      <TableBody>
        {Array.from({ length: 6 }, (_, row) => (
          <TableRow key={row}>
            {SKELETON_WIDTHS.map((width, column) => (
              <TableCell key={column} className={column >= 4 && column <= 7 ? 'text-right' : ''}>
                <Skeleton className={cn(width, column >= 4 && column <= 7 && 'ml-auto')} />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
