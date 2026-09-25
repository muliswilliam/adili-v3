import { Slot } from '@radix-ui/react-slot';
import { type ComponentProps, type ReactElement, type ReactNode, useId } from 'react';

import { cn } from '../lib/cn';
import { Label } from './label';

export function FieldHint({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('text-[13px] text-muted-foreground', className)} {...props} />;
}

/** Announced as soon as it appears, so screen reader users hear new validation errors. */
export function FieldError({ className, ...props }: ComponentProps<'p'>) {
  return (
    <p
      role="alert"
      className={cn('text-[13px] font-medium text-destructive', className)}
      {...props}
    />
  );
}

/** Space-separated ids for aria-describedby, or undefined when there are none. */
export function describedBy(...ids: (string | undefined)[]): string | undefined {
  const joined = ids.filter(Boolean).join(' ');
  return joined === '' ? undefined : joined;
}

export type FormFieldProps = Omit<ComponentProps<'div'>, 'children'> & {
  label: ReactNode;
  hint?: ReactNode;
  /** When set, the control is marked invalid and the message is announced. */
  error?: ReactNode;
  /** Id for the control; generated when omitted. */
  controlId?: string;
  /** A single control, e.g. Input or Textarea. It receives id and aria attributes. */
  children: ReactElement;
};

export function FormField({
  label,
  hint,
  error,
  controlId,
  className,
  children,
  ...props
}: FormFieldProps) {
  const generatedId = useId();
  const id = controlId ?? generatedId;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  return (
    <div className={cn('grid gap-2', className)} {...props}>
      <Label htmlFor={id}>{label}</Label>
      {hint ? <FieldHint id={hintId}>{hint}</FieldHint> : null}
      <Slot
        id={id}
        aria-describedby={describedBy(hintId, errorId)}
        aria-invalid={error ? true : undefined}
      >
        {children}
      </Slot>
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </div>
  );
}
