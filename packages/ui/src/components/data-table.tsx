import { type ReactNode, useLayoutEffect, useRef } from 'react';

import { Checkbox } from './checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table';

export interface DataTableColumn<Row> {
  id: string;
  header: ReactNode;
  cell: (row: Row) => ReactNode;
  /** Render this column's cells as row headers. Use for the column that names the row. */
  rowHeader?: boolean;
  className?: string;
}

export interface DataTableSelection {
  /** Ids of the selected rows. May include rows on other pages. */
  selected: ReadonlySet<string>;
  onChange: (selected: Set<string>) => void;
  /** Accessible name for a row's checkbox, e.g. "Select Jane Doe". */
  rowLabel: (id: string) => string;
  /** Text announced when the selection changes. Defaults to "{n} selected". */
  summary?: (count: number) => string;
  /** Accessible name for the header checkbox. Defaults to "Select all on page". */
  selectAllLabel?: string;
}

export interface DataTableProps<Row> {
  caption: ReactNode;
  columns: DataTableColumn<Row>[];
  /** The rows on the current page. */
  rows: Row[];
  getRowId: (row: Row) => string;
  /** Adds a checkbox column. Selection is controlled; select all only covers the rows passed in. */
  selection?: DataTableSelection;
  className?: string;
}

/**
 * A Table driven by column definitions, with optional row selection. Use TableRowLink in the
 * row header cell to make rows clickable; the checkboxes sit above the link.
 */
export function DataTable<Row>({
  caption,
  columns,
  rows,
  getRowId,
  selection,
  className,
}: DataTableProps<Row>) {
  const ids = rows.map(getRowId);
  const selectedOnPage = selection ? ids.filter((id) => selection.selected.has(id)).length : 0;
  const allOnPage = ids.length > 0 && selectedOnPage === ids.length;
  const someOnPage = selectedOnPage > 0 && !allOnPage;

  function toggle(targets: string[], checked: boolean) {
    if (!selection) return;
    const next = new Set(selection.selected);
    for (const id of targets) {
      if (checked) next.add(id);
      else next.delete(id);
    }
    selection.onChange(next);
  }

  return (
    <div className={className}>
      <Table caption={caption}>
        <TableHeader>
          <TableRow>
            {selection ? (
              <TableHead className="w-9 pr-0">
                <SelectAllCheckbox
                  label={selection.selectAllLabel ?? 'Select all on page'}
                  checked={allOnPage}
                  indeterminate={someOnPage}
                  disabled={ids.length === 0}
                  onChange={(checked) => {
                    toggle(ids, checked);
                  }}
                />
              </TableHead>
            ) : null}
            {columns.map((column) => (
              <TableHead key={column.id} className={column.className}>
                {column.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, index) => {
            const id = ids[index] ?? '';
            const selected = selection?.selected.has(id) ?? false;
            return (
              <TableRow
                key={id}
                data-state={selected ? 'selected' : undefined}
                className="data-[state=selected]:bg-brand-faint"
              >
                {selection ? (
                  <TableCell className="w-9 pr-0">
                    <Checkbox
                      aria-label={selection.rowLabel(id)}
                      checked={selected}
                      onChange={(event) => {
                        toggle([id], event.target.checked);
                      }}
                      // Above a TableRowLink's stretched hit area.
                      className="relative z-10 align-middle"
                    />
                  </TableCell>
                ) : null}
                {columns.map((column) =>
                  column.rowHeader ? (
                    <TableHead key={column.id} scope="row" className={column.className}>
                      {column.cell(row)}
                    </TableHead>
                  ) : (
                    <TableCell key={column.id} className={column.className}>
                      {column.cell(row)}
                    </TableCell>
                  ),
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {selection ? (
        <div role="status" className="sr-only">
          {(selection.summary ?? defaultSummary)(selection.selected.size)}
        </div>
      ) : null}
    </div>
  );
}

function defaultSummary(count: number) {
  return `${String(count)} selected`;
}

function SelectAllCheckbox({
  label,
  checked,
  indeterminate,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  indeterminate: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);

  // Mixed state has no HTML attribute; it is only settable as a DOM property. Set it after
  // every render, since clicking clears it in the DOM whatever the props say.
  useLayoutEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  });

  return (
    <Checkbox
      ref={ref}
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onChange={(event) => {
        onChange(event.target.checked);
        // A controlled parent may keep the selection as it was and not re-render, so put the
        // mixed state back now. A re-render with new props corrects it in the effect above.
        event.target.indeterminate = indeterminate;
      }}
      className="align-middle"
    />
  );
}
