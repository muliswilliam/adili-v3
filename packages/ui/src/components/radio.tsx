import { type ComponentProps, type ReactNode, useId } from 'react';

import { cn } from '../lib/cn';

export type RadioCardProps = Omit<ComponentProps<'input'>, 'type'> & {
  label: ReactNode;
  /** Secondary text under the label, linked to the radio with `aria-describedby`. */
  description?: ReactNode;
  /** Decorative icon at the end of the card, e.g. a lucide-react icon. */
  icon?: ReactNode;
};

/**
 * One choice of a `RadioGroup`, drawn as a card whose whole surface selects it. A native radio,
 * so arrow keys move between choices and it submits with forms.
 */
export function RadioCard({
  label,
  description,
  icon,
  id,
  className,
  disabled,
  ...props
}: RadioCardProps) {
  const generatedId = useId();
  const radioId = id ?? generatedId;
  const labelId = `${radioId}-label`;
  const descriptionId = `${radioId}-description`;

  return (
    <label
      htmlFor={radioId}
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-lg border bg-card px-4 py-3 transition-colors hover:border-input has-checked:border-primary has-checked:bg-primary-subtle/40 has-checked:ring-1 has-checked:ring-primary has-focus-visible:ring-2 has-focus-visible:ring-ring has-disabled:cursor-not-allowed has-disabled:opacity-60 has-disabled:hover:border-border',
        className,
      )}
    >
      <input
        type="radio"
        id={radioId}
        disabled={disabled}
        // The card label also holds the description; name the radio by its label text only.
        aria-labelledby={labelId}
        aria-describedby={description ? descriptionId : undefined}
        className="mt-0.5 size-4 shrink-0 cursor-pointer accent-primary outline-none disabled:cursor-not-allowed"
        {...props}
      />
      <span className="grid flex-1 gap-0.5">
        <span id={labelId} className="text-sm leading-5 font-medium">
          {label}
        </span>
        {description ? (
          <span id={descriptionId} className="text-[13px] text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
      {icon ? (
        <span aria-hidden="true" className="mt-0.5 text-muted-foreground [&_svg]:size-4">
          {icon}
        </span>
      ) : null}
    </label>
  );
}

export type RadioGroupProps = ComponentProps<'fieldset'> & {
  legend: ReactNode;
  hint?: ReactNode;
  /** Validation message for the group, announced when it appears. */
  error?: ReactNode;
};

/**
 * A fieldset of `RadioCard`s sharing one `name`, with a legend, hint and error. The fieldset is
 * a `radiogroup`; it is marked invalid while an error is shown.
 */
export function RadioGroup({
  legend,
  hint,
  error,
  className,
  children,
  ...props
}: RadioGroupProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const hasError = error != null && error !== false && error !== '';
  const describedBy = [hint ? hintId : null, hasError ? errorId : null].filter(Boolean).join(' ');

  return (
    <fieldset
      role="radiogroup"
      aria-describedby={describedBy || undefined}
      aria-invalid={hasError ? true : undefined}
      className={cn('m-0 grid min-w-0 gap-2 border-0 p-0', className)}
      {...props}
    >
      <legend className="float-left w-full p-0 text-sm leading-none font-medium">{legend}</legend>
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
      <div className="grid gap-2 pt-1">{children}</div>
    </fieldset>
  );
}
