import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';

/**
 * Placeholder block shown while content loads. Hidden from assistive technology: mark the
 * loading region itself with `aria-busy` and give it an accessible name instead.
 */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'h-4 animate-pulse rounded-md bg-foreground/10 motion-reduce:animate-none',
        className,
      )}
      {...props}
    />
  );
}
