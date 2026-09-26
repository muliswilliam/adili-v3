import { Slot } from '@radix-ui/react-slot';
import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';

/** Data table in a horizontally scrolling wrapper. Always give it a `TableCaption`. */
export function Table({ className, ...props }: ComponentProps<'table'>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn('w-full border-collapse text-sm', className)} {...props} />
    </div>
  );
}

export type TableCaptionProps = ComponentProps<'caption'> & {
  /** Show the caption on screen. Hidden by default; screen readers always announce it. */
  visible?: boolean;
};

export function TableCaption({ visible = false, className, ...props }: TableCaptionProps) {
  return (
    <caption
      className={cn(
        visible ? 'mb-2 text-left text-sm text-muted-foreground' : 'sr-only',
        className,
      )}
      {...props}
    />
  );
}

export function TableHeader({ className, ...props }: ComponentProps<'thead'>) {
  return <thead className={cn('bg-muted/60', className)} {...props} />;
}

export function TableBody({ className, ...props }: ComponentProps<'tbody'>) {
  return <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />;
}

export function TableRow({ className, ...props }: ComponentProps<'tr'>) {
  return (
    <tr
      className={cn(
        // `relative` anchors a TableRowLink so its hit area covers the whole row.
        'relative border-b transition-colors has-[[data-row-link]]:hover:bg-muted/60',
        className,
      )}
      {...props}
    />
  );
}

/** Header cell. Defaults to `scope="col"`; pass `scope="row"` for row headers. */
export function TableHead({ className, scope = 'col', ...props }: ComponentProps<'th'>) {
  return (
    <th
      scope={scope}
      className={cn(
        'h-10 px-3 text-left align-middle text-xs font-medium whitespace-nowrap text-muted-foreground first:pl-4 last:pr-4',
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: ComponentProps<'td'>) {
  return <td className={cn('px-3 py-3 align-middle first:pl-4 last:pr-4', className)} {...props} />;
}

export type TableRowLinkProps = ComponentProps<'a'> & {
  /** Render the child element (e.g. a router `Link`) with row link behaviour. */
  asChild?: boolean;
};

/**
 * The row's primary link, placed in its first cell. Its hit area stretches over the whole
 * `TableRow`, so a click anywhere on the row follows it while keyboard and screen reader users
 * get one named link per row. Other interactive content in the row needs `relative z-10`.
 */
export function TableRowLink({ className, asChild = false, ...props }: TableRowLinkProps) {
  const Component = asChild ? Slot : 'a';
  return (
    <Component
      data-row-link=""
      className={cn(
        'rounded-sm font-medium text-foreground underline-offset-4 outline-none after:absolute after:inset-0 hover:underline focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
      {...props}
    />
  );
}
