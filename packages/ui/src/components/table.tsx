import { Slot } from '@radix-ui/react-slot';
import type { ComponentProps, ReactNode } from 'react';

import { cn } from '../lib/cn';

export type TableProps = ComponentProps<'table'> & {
  /** Names the table for assistive technology; rendered visually hidden. */
  caption: ReactNode;
};

export function Table({ caption, className, children, ...props }: TableProps) {
  return (
    <div className="relative w-full overflow-x-auto">
      <table className={cn('w-full caption-bottom text-sm', className)} {...props}>
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}

export function TableHeader({ className, ...props }: ComponentProps<'thead'>) {
  return <thead className={cn('[&_tr]:border-b', className)} {...props} />;
}

export function TableBody({ className, ...props }: ComponentProps<'tbody'>) {
  return <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />;
}

export function TableRow({ className, ...props }: ComponentProps<'tr'>) {
  return (
    <tr
      className={cn(
        // Relative so a TableRowLink can stretch over the whole row.
        'relative border-b transition-colors has-[[data-row-link]]:hover:bg-muted/60',
        className,
      )}
      {...props}
    />
  );
}

export type TableHeadProps = ComponentProps<'th'> & {
  /** `col` for column headers; use `row` for the first cell of a body row. */
  scope?: 'col' | 'row' | 'colgroup' | 'rowgroup';
};

export function TableHead({ scope = 'col', className, ...props }: TableHeadProps) {
  return (
    <th
      scope={scope}
      className={cn(
        'h-10 px-3 text-left align-middle font-medium whitespace-nowrap',
        scope === 'col' ? 'text-[13px] text-muted-foreground' : 'text-foreground',
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: ComponentProps<'td'>) {
  return <td className={cn('px-3 py-3 align-middle', className)} {...props} />;
}

export type TableRowLinkProps = ComponentProps<'a'> & {
  /** Render the child element (e.g. a router link) with row link behaviour. */
  asChild?: boolean;
};

/**
 * The one link in a row, usually inside its row header. Its hit area stretches over the whole
 * row, so the row is clickable but stays a single tab stop named by the link text. Give any
 * other interactive element in the row `relative z-10` so it sits above the link.
 */
export function TableRowLink({ asChild = false, className, ...props }: TableRowLinkProps) {
  const Component = asChild ? Slot : 'a';
  return (
    <Component
      data-row-link=""
      className={cn(
        'font-medium text-foreground underline-offset-4 outline-none after:absolute after:inset-0 hover:underline focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset',
        className,
      )}
      {...props}
    />
  );
}
