import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';

/** Decorative loading placeholder. Mark the loading region with aria-busy for assistive tech. */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'block h-3 animate-shimmer rounded-sm bg-linear-to-r from-muted from-25% via-muted/40 via-50% to-muted to-75% bg-[length:200%_100%] motion-reduce:animate-none',
        className,
      )}
      {...props}
    />
  );
}
