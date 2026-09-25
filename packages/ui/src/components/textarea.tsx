import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'flex min-h-24 w-full min-w-0 rounded-lg border-0 bg-card px-2.5 py-2 text-sm shadow-control transition-shadow outline-none placeholder:text-placeholder hover:shadow-control-hover focus-visible:shadow-control-focus disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:shadow-control-error aria-invalid:placeholder:text-destructive/50 aria-invalid:focus-visible:shadow-control-error-focus',
        className,
      )}
      {...props}
    />
  );
}
