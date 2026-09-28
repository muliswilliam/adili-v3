import { cn } from '@adili/ui';
import type { ReactNode } from 'react';

import { formatFileSize } from '../format';
import { rosterFileFormat } from './roster-file';

/**
 * The chosen roster file (the prototype's `.filebox`): a format tile, the name and size, and a
 * status or action on the right.
 */
export function FileBox({
  name,
  size,
  detail,
  children,
}: {
  name: string;
  /** Unknown for an import reopened after a refresh: the import does not record it. */
  size?: number;
  /** After the size, e.g. the number of rows detected. */
  detail?: ReactNode;
  /** On the right: a status badge, a spinner line or an action. */
  children?: ReactNode;
}) {
  const format = rosterFileFormat(name);
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-xl bg-card px-4 py-3.5 shadow-control">
      <span
        aria-hidden="true"
        className={cn(
          'grid size-10 shrink-0 place-items-center rounded-lg text-[11px] font-bold tracking-[0.02em]',
          format === 'csv'
            ? 'bg-info-subtle text-info-subtle-foreground'
            : 'bg-success-subtle text-success',
        )}
      >
        {(format ?? 'file').toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14.5px] font-medium">{name}</p>
        {size !== undefined || detail ? (
          <p className="text-[13px] text-muted-foreground">
            {size !== undefined ? formatFileSize(size) : null}
            {size !== undefined && detail ? ' · ' : null}
            {detail}
          </p>
        ) : null}
      </div>
      {children ? <div className="flex shrink-0 items-center">{children}</div> : null}
    </div>
  );
}
