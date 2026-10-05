import { AlertCircleIcon } from '@hugeicons/core-free-icons';
import { cloneElement, type ComponentProps, type ReactElement, type ReactNode } from 'react';

import { cn } from '../lib/cn';
import { useFieldIds } from '../lib/use-field-ids';
import { Icon } from './icon';
import { Label } from './label';

export { joinIds } from '../lib/use-field-ids';

export function FieldHint({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('text-[13px] text-muted-foreground', className)} {...props} />;
}

/**
 * Announced as soon as it appears, so screen reader users hear new validation errors. The icon
 * means the error does not rely on colour alone.
 */
export function FieldError({ className, children, ...props }: ComponentProps<'p'>) {
  return (
    <p
      role="alert"
      className={cn('flex items-start gap-1.5 text-[13px] font-medium text-destructive', className)}
      {...props}
    >
      <Icon icon={AlertCircleIcon} className="mt-px size-[15px]" />
      <span>{children}</span>
    </p>
  );
}

interface ControlProps {
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: ComponentProps<'input'>['aria-invalid'];
}

export type FormFieldProps = Omit<ComponentProps<'div'>, 'children'> & {
  label: ReactNode;
  hint?: ReactNode;
  /** When set, the control is marked invalid and described by the message. */
  error?: ReactNode;
  /** Id for the control; falls back to the control's own id, then a generated one. */
  controlId?: string;
  /**
   * A single control, e.g. Input or Textarea. It receives id, aria-invalid and
   * aria-describedby; its own aria-describedby is kept ahead of the hint and error.
   */
  children: ReactElement<ControlProps>;
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
  const { id, hintId, errorId, describedBy } = useFieldIds({
    id: controlId ?? children.props.id,
    hint,
    error,
    ownDescribedBy: children.props['aria-describedby'],
  });

  // Two parts, header and body, so a parent grid can line up the controls of fields in one row
  // with `row-span-2 grid-rows-subgrid` when only some of them have a hint.
  return (
    <div className={cn('grid content-start gap-1.5', className)} {...props}>
      <div className="grid content-start gap-1.5">
        <Label htmlFor={id}>{label}</Label>
        {hint ? <FieldHint id={hintId}>{hint}</FieldHint> : null}
      </div>
      <div className="grid content-start gap-1.5">
        {cloneElement(children, {
          id,
          'aria-describedby': describedBy,
          ...(error ? { 'aria-invalid': true } : {}),
        })}
        {error ? <FieldError id={errorId}>{error}</FieldError> : null}
      </div>
    </div>
  );
}
