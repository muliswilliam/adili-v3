import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';

/**
 * Native `<select>` styled like `Input`. Native keeps keyboard, screen reader and mobile pickers
 * right for short option lists such as filters. Give it a label (visible or `aria-label`).
 */
export function Select({ className, children, ...props }: ComponentProps<'select'>) {
  return (
    <div className={cn('relative w-full', className)}>
      <select
        className="flex h-10 w-full min-w-0 appearance-none rounded-md border border-input bg-card py-2 pr-9 pl-3 text-sm shadow-xs transition-colors outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive"
        {...props}
      >
        {children}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </div>
  );
}
