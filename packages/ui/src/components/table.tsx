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
      <table className={cn('w-full caption-bottom border-collapse text-sm', className)} {...props}>
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
        'relative border-b transition-colors has-[[data-row-link]]:hover:bg-muted/50',
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
        'text-left align-middle font-medium first:pl-4 last:pr-4',
        scope === 'col'
          ? 'bg-background/60 px-3 py-2.5 text-[12.5px] whitespace-nowrap text-muted-foreground'
          : 'p-3 text-foreground',
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: ComponentProps<'td'>) {
  return <td className={cn('p-3 align-middle first:pl-4 last:pr-4', className)} {...props} />;
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
        'font-medium text-foreground underline-offset-4 outline-hidden after:absolute after:inset-0 hover:underline focus-visible:after:outline-2 focus-visible:after:outline-solid focus-visible:after:-outline-offset-2 focus-visible:after:outline-ring',
        className,
      )}
      {...props}
    />
  );
}
