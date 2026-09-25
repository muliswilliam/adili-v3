import { type ComponentProps, type ReactNode, useId } from 'react';

import { cn } from '../lib/cn';
import { describedBy, FieldError, FieldHint } from './form-field';

export type CheckboxProps = Omit<ComponentProps<'input'>, 'type'>;

/** A native checkbox, so forms, keyboard and assistive technology work without scripting. */
export function Checkbox({ className, ...props }: CheckboxProps) {
  return (
    <input
      type="checkbox"
      className={cn(
        'peer size-4 shrink-0 cursor-pointer rounded-sm accent-primary outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50',
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
export function CheckboxItem({ label, hint, id, className, ...props }: CheckboxItemProps) {
  const generatedId = useId();
  const checkboxId = id ?? generatedId;
  const hintId = hint ? `${checkboxId}-hint` : undefined;

  return (
    <div className={cn('flex gap-3', className)}>
      <Checkbox id={checkboxId} aria-describedby={hintId} className="mt-0.5" {...props} />
      <div className="grid gap-1">
        <label
          htmlFor={checkboxId}
          className="text-sm leading-5 select-none peer-disabled:cursor-not-allowed peer-disabled:opacity-60"
        >
          {label}
        </label>
        {hint ? <FieldHint id={hintId}>{hint}</FieldHint> : null}
      </div>
    </div>
  );
}

export type CheckboxGroupProps = ComponentProps<'fieldset'> & {
  legend: ReactNode;
  hint?: ReactNode;
  /** When set, the message is announced and linked to the group. */
  error?: ReactNode;
};

export function CheckboxGroup({
  legend,
  hint,
  error,
  id,
  className,
  children,
  ...props
}: CheckboxGroupProps) {
  const generatedId = useId();
  const groupId = id ?? generatedId;
  const hintId = hint ? `${groupId}-hint` : undefined;
  const errorId = error ? `${groupId}-error` : undefined;

  return (
    <fieldset
      id={groupId}
      aria-describedby={describedBy(hintId, errorId)}
      className={cn('grid gap-3', className)}
      {...props}
    >
      <legend className="mb-1 text-sm leading-none font-medium">{legend}</legend>
      {hint ? <FieldHint id={hintId}>{hint}</FieldHint> : null}
      <div className="grid gap-3">{children}</div>
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </fieldset>
  );
}
