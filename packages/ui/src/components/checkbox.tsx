import type { ComponentProps, ReactNode } from 'react';

import { cn } from '../lib/cn';
import { focusRing } from '../lib/focus';
import { useFieldIds } from '../lib/use-field-ids';
import { FieldError, FieldHint } from './form-field';

export type CheckboxProps = Omit<ComponentProps<'input'>, 'type'>;

/** A native checkbox, so forms, keyboard and assistive technology work without scripting. */
export function Checkbox({ className, ...props }: CheckboxProps) {
  return (
    <input
      type="checkbox"
      className={cn(
        focusRing,
        'peer size-[18px] shrink-0 cursor-pointer rounded-sm accent-primary disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export type CheckboxItemProps = CheckboxProps & {
  label: ReactNode;
  hint?: ReactNode;
};

/** A checkbox with its label and optional hint, for use inside a CheckboxGroup. */
export function CheckboxItem({
  label,
  hint,
  id,
  disabled,
  className,
  'aria-describedby': ownDescribedBy,
  ...props
}: CheckboxItemProps) {
  const fieldIds = useFieldIds({ id, hint, ownDescribedBy });

  return (
    <div className={cn('flex gap-3', className)}>
      <Checkbox
        {...props}
        id={fieldIds.id}
        disabled={disabled}
        aria-describedby={fieldIds.describedBy}
        className="mt-px"
      />
      <div className="grid gap-0.5">
        {/* Styled from the prop: peer-disabled cannot reach a label that is not a sibling. */}
        <label
          htmlFor={fieldIds.id}
          className={cn(
            'text-sm leading-5 select-none',
            disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
          )}
        >
          {label}
        </label>
        {hint ? <FieldHint id={fieldIds.hintId}>{hint}</FieldHint> : null}
      </div>
    </div>
  );
}

export type CheckboxGroupProps = ComponentProps<'fieldset'> & {
  legend: ReactNode;
  hint?: ReactNode;
  /** When set, the group is marked invalid and described by the message. */
  error?: ReactNode;
};

export function CheckboxGroup({
  legend,
  hint,
  error,
  id,
  className,
  children,
  'aria-describedby': ownDescribedBy,
  ...props
}: CheckboxGroupProps) {
  const fieldIds = useFieldIds({ id, hint, error, ownDescribedBy });

  return (
    <fieldset
      {...props}
      id={fieldIds.id}
      aria-describedby={fieldIds.describedBy}
      aria-invalid={error ? true : props['aria-invalid']}
      className={cn('grid gap-3', className)}
    >
      <legend className="mb-1 text-sm leading-5 font-medium text-secondary-foreground">
        {legend}
      </legend>
      {hint ? <FieldHint id={fieldIds.hintId}>{hint}</FieldHint> : null}
      <div className="grid gap-3">{children}</div>
      {error ? <FieldError id={fieldIds.errorId}>{error}</FieldError> : null}
    </fieldset>
  );
}
