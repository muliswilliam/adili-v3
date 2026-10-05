import type { ReactNode } from 'react';

import { cn } from '../lib/cn';
import type { DataTableColumn } from './data-table';
import { Skeleton } from './skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table';

export interface NewDataTableProps<Row> {
  caption: ReactNode;
  columns: readonly DataTableColumn<Row>[];
  rows: readonly Row[];
  getRowId: (row: Row) => string;
  /** Filters on the left, search on the right; wraps on smaller screens. */
  filters?: ReactNode;
  search?: ReactNode;
  footer?: ReactNode;
  loading?: boolean;
  loadingRows?: number;
  empty?: ReactNode;
  className?: string;
}

/** A compact list table with a muted header, inset rows and a responsive toolbar. */
export function NewDataTable<Row>({
  caption,
  columns,
  rows,
  getRowId,
  filters,
  search,
  footer,
  loading = false,
  loadingRows = 6,
  empty,
  className,
}: NewDataTableProps<Row>) {
  return (
    <div className={cn('min-w-0', className)}>
      {filters || search ? <NewDataTableToolbar filters={filters} search={search} /> : null}
      {!loading && rows.length === 0 && empty ? (
        empty
      ) : (
        <Table caption={caption} aria-busy={loading || undefined} className="table-fixed text-sm">
          <TableHeader className="[&_tr]:border-0">
            <TableRow>
              {columns.map((column) => (
                <TableHead
                  key={column.id}
                  className={cn(
                    'bg-muted py-2 text-sm first:rounded-l-md first:pl-2 last:rounded-r-md last:pr-2',
                    column.className,
                  )}
                >
                  {column.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading
              ? Array.from({ length: loadingRows }, (_, row) => (
                  <TableRow key={row}>
                    {columns.map((column) => (
                      <TableCell key={column.id} className="py-3 first:pl-2 last:pr-2">
                        <Skeleton className="h-4 w-3/4" />
                        <Skeleton className="mt-1 h-3 w-1/2" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              : rows.map((row) => (
                  <TableRow key={getRowId(row)} className="border-border/60">
                    {columns.map((column) => {
                      const Cell = column.rowHeader ? TableHead : TableCell;
                      return (
                        <Cell
                          key={column.id}
                          scope={column.rowHeader ? 'row' : undefined}
                          className={cn('py-3 font-normal first:pl-2 last:pr-2', column.className)}
                        >
                          {column.cell(row)}
                        </Cell>
                      );
                    })}
                  </TableRow>
                ))}
          </TableBody>
        </Table>
      )}
      {footer}
    </div>
  );
}

/** Shared filter/search arrangement for tables and responsive card lists. */
export function NewDataTableToolbar({
  filters,
  search,
}: {
  filters?: ReactNode;
  search?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      {filters}
      {search ? <div className="ml-auto w-full min-[1000px]:w-[280px]">{search}</div> : null}
    </div>
  );
}
