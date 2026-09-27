import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';

/**
 * Shared by the text form controls (Input, Textarea, and the Keycloak theme's default pages) so
 * every control has the same edges and states. Read-only keys off the `readonly` attribute, as the
 * kit's `.input[readonly]` does, rather than `:read-only`, which also matches disabled fields and
 * checkboxes, radios and file inputs; disabled keeps its own, dimmer text.
 */
export const controlClassName =
  'w-full min-w-0 rounded-lg border-0 bg-control text-[15px] shadow-control transition-shadow outline-none placeholder:text-placeholder hover:shadow-control-hover focus-visible:shadow-control-focus disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground aria-invalid:shadow-control-error aria-invalid:focus-visible:shadow-control-error-focus [&[readonly]:not(:disabled)]:bg-muted [&[readonly]:not(:disabled)]:text-secondary-foreground';

export function Input({ className, type = 'text', ...props }: ComponentProps<'input'>) {
  return (
    <input type={type} className={cn(controlClassName, 'flex h-11 px-3', className)} {...props} />
  );
}
