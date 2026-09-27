import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';

/** Shared by Input, Textarea, Select and Combobox so every control has the same edges and states. */
export const controlClassName =
  'w-full min-w-0 rounded-lg border-0 bg-control text-[15px] shadow-control transition-shadow outline-none placeholder:text-placeholder hover:shadow-control-hover focus-visible:shadow-control-focus disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground aria-invalid:shadow-control-error aria-invalid:focus-visible:shadow-control-error-focus';

export function Input({ className, type = 'text', ...props }: ComponentProps<'input'>) {
  return (
    <input
      type={type}
      className={cn(
        controlClassName,
        'flex h-11 px-3 read-only:bg-muted read-only:text-secondary-foreground',
        className,
      )}
      {...props}
    />
  );
}
