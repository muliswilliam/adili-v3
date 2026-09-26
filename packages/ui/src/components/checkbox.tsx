import { type ComponentProps, type ReactNode, useId } from 'react';

import { cn } from '../lib/cn';
import { Label } from './label';

/** Native checkbox, so it submits with forms and keeps built-in keyboard and screen reader support. */
export function Checkbox({ className, ...props }: Omit<ComponentProps<'input'>, 'type'>) {
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

export type CheckboxItemProps = Omit<ComponentProps<'input'>, 'type'> & {
  label: ReactNode;
  /** Secondary text under the label, linked to the checkbox with `aria-describedby`. */
  description?: ReactNode;
};

/** A checkbox with its label and optional description. */
export function CheckboxItem({ label, description, id, className, ...props }: CheckboxItemProps) {
  const generatedId = useId();
  const checkboxId = id ?? generatedId;
  const descriptionId = `${checkboxId}-description`;

  return (
    <div className={cn('flex items-start gap-3', className)}>
      <Checkbox
        id={checkboxId}
        aria-describedby={description ? descriptionId : undefined}
        className="mt-0.5"
        {...props}
      />
      <div className="grid gap-1">
        <Label htmlFor={checkboxId} className="cursor-pointer leading-5 font-normal">
          {label}
        </Label>
        {description ? (
          <p id={descriptionId} className="text-[13px] text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export type CheckboxGroupProps = ComponentProps<'fieldset'> & {
  legend: ReactNode;
  hint?: ReactNode;
  /** Validation message for the group, announced when it appears. */
  error?: ReactNode;
  optional?: boolean;
};

/** A fieldset of related `CheckboxItem`s with a legend, hint and error. */
export function CheckboxGroup({
  legend,
  hint,
  error,
  optional = false,
  className,
  children,
  ...props
}: CheckboxGroupProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const hasError = error != null && error !== false && error !== '';
  const describedBy = [hint ? hintId : null, hasError ? errorId : null].filter(Boolean).join(' ');

  return (
    <fieldset
      aria-describedby={describedBy || undefined}
      className={cn('m-0 grid min-w-0 gap-2 border-0 p-0', className)}
      {...props}
    >
      <legend className="float-left flex w-full items-baseline justify-between gap-2 p-0 text-sm leading-none font-medium">
        <span>{legend}</span>
        {optional ? (
          <span className="text-[13px] font-normal text-muted-foreground">Optional</span>
        ) : null}
      </legend>
      {hint ? (
        <p id={hintId} className="text-[13px] text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {hasError ? (
        <p
          id={errorId}
          role="alert"
          className="text-[13px] font-medium text-destructive-subtle-foreground"
        >
          {error}
        </p>
      ) : null}
      <div className="grid gap-3 pt-1">{children}</div>
    </fieldset>
  );
}
