import { Slot } from '@radix-ui/react-slot';
import { type ComponentProps, type ReactNode, useId } from 'react';

import { cn } from '../lib/cn';
import { Label } from './label';

export type FormFieldProps = Omit<ComponentProps<'div'>, 'children'> & {
  label: ReactNode;
  /** Help text shown under the control. */
  hint?: ReactNode;
  /** Validation message. Marks the control invalid and is announced when it appears. */
  error?: ReactNode;
  /** Shows an "Optional" marker next to the label. */
  optional?: boolean;
  /** Id for the control. Generated when omitted; do not set `id` on the control itself. */
  controlId?: string;
  /** A single control, e.g. `Input` or `Textarea`. It receives id and aria wiring. */
  children: ReactNode;
};

/**
 * Label, control, hint and error wired together: the label targets the control, and the control
 * gets `aria-describedby` (hint, then error) and `aria-invalid` while an error is shown.
 */
export function FormField({
  label,
  hint,
  error,
  optional = false,
  controlId,
  className,
  children,
  ...props
}: FormFieldProps) {
  const generatedId = useId();
  const id = controlId ?? generatedId;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const hasError = error != null && error !== false && error !== '';
  const describedBy = [hint ? hintId : null, hasError ? errorId : null].filter(Boolean).join(' ');

  return (
    <div className={cn('grid gap-2', className)} {...props}>
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {optional ? <span className="text-[13px] text-muted-foreground">Optional</span> : null}
      </div>
      <Slot
        id={id}
        aria-describedby={describedBy || undefined}
        aria-invalid={hasError ? true : undefined}
      >
        {children}
      </Slot>
      {hasError ? (
        <p
          id={errorId}
          role="alert"
          className="text-[13px] font-medium text-destructive-subtle-foreground"
        >
          {error}
        </p>
      ) : null}
      {hint ? (
        <p id={hintId} className="text-[13px] text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
