import { cn } from '@adili/ui';
import type { ReactNode } from 'react';

/**
 * A value the declarant can read but not change, laid out like the Figma form fields: label
 * above, value in a field-sized box. The box is flat (no control shadow) so it does not look
 * editable. Use inside a `<dl>`.
 */
export function ReadOnlyField({
  label,
  children,
  action,
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  /** Sits at the right edge of the box, e.g. a copy button or a Verified badge. */
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('grid min-w-0 content-start gap-2', className)}>
      <dt className="text-sm leading-4 text-muted-foreground">{label}</dt>
      <dd className="flex min-h-8 items-center justify-between gap-2 rounded-lg bg-muted px-2.5 py-1.5 text-sm text-foreground">
        <span className="min-w-0 break-words">{children}</span>
        {action}
      </dd>
    </div>
  );
}
