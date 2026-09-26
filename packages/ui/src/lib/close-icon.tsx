import type { ComponentProps } from 'react';

import { cn } from './cn';

/** Decorative "x" glyph for close and dismiss buttons; the button carries the accessible name. */
export function CloseIcon({ className, ...props }: ComponentProps<'svg'>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn('size-4', className)}
      {...props}
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
