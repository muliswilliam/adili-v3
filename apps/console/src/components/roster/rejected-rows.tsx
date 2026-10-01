import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  cn,
  Icon,
  Skeleton,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@adili/ui';
import {
  AlertCircleIcon,
  Download04Icon,
  InformationCircleIcon,
  LockIcon,
  RefreshIcon,
} from '@hugeicons/core-free-icons';

import { useRef } from 'react';

import type { RosterImport, RosterImportRow } from '../../server/directory/client';
import { CursorPager } from '../cursor-pager';
import { formatNumber } from '../format';
import { columnName, rowFileNumber, type RowsFailure } from './import-report';
import { messages as m } from './messages';
import type { RejectedRowsView } from './use-rejected-rows';
import { ColumnName } from './wizard-template-step';

const pagerLabels = {
  pagination: m.rowsPagination,
  pageRange: m.rowsPageRange,
  pageRows: m.rowsPageRows,
  previousPage: m.previousPage,
  nextPage: m.nextPage,
};

export interface RejectedRowsProps {
  imp: Pick<RosterImport, 'channel' | 'counts'>;
  view: RejectedRowsView;
  downloading: boolean;
  onDownload: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onRetry: () => void;
}

/**
 * The rejected rows of an import (the prototype's card under the counts): each with its row
 * number, file number, the fields at fault and why, 50 to a page, and the CSV download to fix
 * them in the source file and upload again.
 */
export function RejectedRows({
  imp,
  view,
  downloading,
  onDownload,
  onNext,
  onPrevious,
  onRetry,
}: RejectedRowsProps) {
  const rejected = imp.counts?.rejected ?? 0;
  // The CSV holds the same rows: offer it only while they can be read.
  const canDownload = view.phase !== 'failed';
  const card = useRef<HTMLDivElement>(null);
  // Another page starts at the top of the list, not where the pager was.
  const toTop = () => {
    card.current?.scrollIntoView({ block: 'start' });
  };
  return (
    <Card
      ref={card}
      role="region"
      aria-labelledby="rejected-rows-title"
      className="mt-5 scroll-mt-20 gap-0 overflow-hidden p-0 sm:p-0"
    >
      <div className="flex flex-wrap items-center gap-3 border-b px-5 py-4">
        <div className="min-w-[240px] flex-1">
          <h3 id="rejected-rows-title" className="text-[15.5px] font-semibold">
            {m.rejectedRowsTitle}{' '}
            <span className="font-medium text-muted-foreground tabular-nums">
              {formatNumber(rejected)}
            </span>
          </h3>
          {imp.channel === 'api' ? (
            <p className="mt-0.5 text-[13px] text-muted-foreground">{m.rejectedRowsApiHint}</p>
          ) : null}
        </div>
        {canDownload ? (
          <Button variant="secondary" size="sm" disabled={downloading} onClick={onDownload}>
            {downloading ? <Spinner className="size-4" /> : <Icon icon={Download04Icon} />}
            {downloading ? m.downloadingRejected : m.downloadRejected}
          </Button>
        ) : null}
      </div>
      {view.phase === 'loading' ? (
        <RowsSkeleton rows={Math.min(Math.max(rejected, 1), 5)} />
      ) : view.phase === 'failed' ? (
        <div className="p-5">
          <RowsUnavailable failure={view.failure} onRetry={onRetry} />
        </div>
      ) : (
        <>
          <div className="hidden min-[700px]:block">
            <RowsTable rows={view.page.items} />
          </div>
          <div className="min-[700px]:hidden">
            <RowsCards rows={view.page.items} />
          </div>
          {view.paging.hasPrevious || view.paging.hasNext ? (
            <CursorPager
              labels={pagerLabels}
              range={view.paging.range}
              rows={view.page.items.length}
              hasPrevious={view.paging.hasPrevious}
              hasNext={view.paging.hasNext}
              onPrevious={() => {
                onPrevious();
                toTop();
              }}
              onNext={() => {
                onNext();
                toTop();
              }}
            />
          ) : null}
        </>
      )}
    </Card>
  );
}

/** The row's file number in mono; kept on one line in the table (at most 30 characters). */
function FileNumber({ row, wrap = false }: { row: RosterImportRow; wrap?: boolean }) {
  const fileNumber = rowFileNumber(row);
  return fileNumber ? (
    <span
      className={cn('font-mono text-[13.5px]', wrap ? 'min-w-0 break-all' : 'whitespace-nowrap')}
    >
      {fileNumber}
    </span>
  ) : (
    <span className="text-muted-foreground">{m.noFileNumber}</span>
  );
}

function RowsTable({ rows }: { rows: readonly RosterImportRow[] }) {
  return (
    <Table caption={m.rejectedCaption}>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[90px] text-right">{m.columnRow}</TableHead>
          <TableHead>{m.columnFileNumber}</TableHead>
          <TableHead>{m.columnField}</TableHead>
          <TableHead className="w-[48%]">{m.columnReason}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.rowNumber} className="hover:bg-transparent">
            <TableHead scope="row" className="text-right font-normal text-foreground tabular-nums">
              {formatNumber(row.rowNumber)}
            </TableHead>
            <TableCell>
              <FileNumber row={row} />
            </TableCell>
            <TableCell>
              <ul className="grid gap-1.5">
                {row.errors.map((error, index) => (
                  <li key={index} className="leading-[21px]">
                    <ColumnName>{columnName(error.field)}</ColumnName>
                  </li>
                ))}
              </ul>
            </TableCell>
            <TableCell className="whitespace-normal">
              <ul className="grid gap-1.5">
                {row.errors.map((error, index) => (
                  <li key={index} className="leading-[21px]">
                    {error.message}
                  </li>
                ))}
              </ul>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Below 700px each row is a card: row number and file number, then field and reason pairs. */
function RowsCards({ rows }: { rows: readonly RosterImportRow[] }) {
  return (
    <ul aria-label={m.rejectedCaption}>
      {rows.map((row) => (
        <li key={row.rowNumber} className="grid gap-2 border-b px-4 py-3.5 last:border-b-0">
          <p className="flex min-w-0 items-baseline gap-2 text-[13.5px]">
            <span className="shrink-0 text-muted-foreground">
              {m.columnRow}{' '}
              <span className="text-foreground tabular-nums">{formatNumber(row.rowNumber)}</span>
            </span>
            <FileNumber row={row} wrap />
          </p>
          <ul className="grid gap-1.5 text-[14px]">
            {row.errors.map((error, index) => (
              <li key={index} className="grid gap-0.5">
                <span>
                  <ColumnName>{columnName(error.field)}</ColumnName>
                </span>
                <span>{error.message}</span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

function RowsUnavailable({ failure, onRetry }: { failure: RowsFailure; onRetry: () => void }) {
  if (failure === 'purged') {
    return (
      <Alert variant="neutral" role="note">
        <Icon icon={InformationCircleIcon} />
        <AlertTitle>{m.rowsPurged}</AlertTitle>
        <AlertDescription>{m.rowsPurgedText}</AlertDescription>
      </Alert>
    );
  }
  if (failure === 'commission-only') {
    return (
      <Alert variant="neutral" role="note">
        <Icon icon={LockIcon} />
        <AlertDescription>{m.rowsCommissionOnly}</AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert variant="destructive">
      <Icon icon={AlertCircleIcon} />
      <AlertTitle>{m.rowsLoadFailed}</AlertTitle>
      <AlertDescription>{m.errorDetail}</AlertDescription>
      <div className="mt-2.5">
        <Button variant="secondary" size="sm" onClick={onRetry}>
          <Icon icon={RefreshIcon} />
          {m.tryAgain}
        </Button>
      </div>
    </Alert>
  );
}

function RowsSkeleton({ rows }: { rows: number }) {
  return (
    <div role="status" aria-busy="true" aria-label={m.rowsLoading} className="divide-y">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-6 px-4 py-3.5">
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-4 w-[120px]" />
          <Skeleton className="h-4 w-[110px]" />
          <Skeleton className="h-4 flex-1" />
        </div>
      ))}
    </div>
  );
}
