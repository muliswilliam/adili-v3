import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';

/** Decorative loading placeholder. Mark the loading region with aria-busy for assistive tech. */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-muted', className)}
      {...props}
    />
  );
}
