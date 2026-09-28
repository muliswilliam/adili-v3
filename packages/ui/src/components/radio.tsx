import type { ComponentProps, ReactNode } from 'react';

import { cn } from '../lib/cn';
import { useFieldIds } from '../lib/use-field-ids';
import { FieldError, FieldHint } from './form-field';

export type RadioCardProps = Omit<ComponentProps<'input'>, 'type'> & {
  label: ReactNode;
  /** Secondary text under the label, linked to the radio with `aria-describedby`. */
  description?: ReactNode;
  /** Decorative icon at the end of the card, e.g. an `Icon`. */
  icon?: ReactNode;
};

/**
 * One choice of a `RadioGroup`, drawn as the prototype kit's `.choice` card: the whole surface
 * selects it. A native radio, so arrow keys move between choices and it submits with forms.
 */
export function RadioCard({
  label,
  description,
  icon,
  id,
  className,
  disabled,
  'aria-describedby': ownDescribedBy,
  ...props
}: RadioCardProps) {
  const fieldIds = useFieldIds({ id, hint: description, describedBy: ownDescribedBy });
  const labelId = `${fieldIds.id}-label`;

  return (
    <label
      htmlFor={fieldIds.id}
      className={cn(
        'relative flex min-h-11 cursor-pointer items-start gap-2.5 rounded-lg bg-control px-3 py-2.5 text-[14.5px] font-medium shadow-control transition-shadow select-none hover:shadow-control-hover has-checked:shadow-control-selected has-focus-visible:outline-3 has-focus-visible:outline-ring/15 has-disabled:cursor-not-allowed has-disabled:opacity-50',
        className,
      )}
    >
      <input
        type="radio"
        id={fieldIds.id}
        disabled={disabled}
        // The card label also holds the description; name the radio by its label text only.
        aria-labelledby={labelId}
        aria-describedby={fieldIds.describedBy}
        className="peer pointer-events-none absolute opacity-0"
        {...props}
      />
      <span
        aria-hidden="true"
        className="mt-0.5 size-[18px] shrink-0 rounded-full bg-control shadow-[inset_0_0_0_1.5px_var(--input)] transition-shadow peer-checked:shadow-[inset_0_0_0_5px_var(--primary)]"
      />
      <span className="grid flex-1 gap-0.5">
        <span id={labelId}>{label}</span>
        {description ? (
          <FieldHint id={fieldIds.hintId} className="font-normal">
            {description}
          </FieldHint>
        ) : null}
      </span>
      {icon ? (
        <span aria-hidden="true" className="mt-0.5 flex text-muted-foreground">
          {icon}
        </span>
      ) : null}
    </label>
  );
}

export type RadioGroupProps = ComponentProps<'fieldset'> & {
  legend: ReactNode;
  hint?: ReactNode;
  /** When set, the group is marked invalid and described by the message. */
  error?: ReactNode;
};

/**
 * A fieldset of `RadioCard`s sharing one `name`, with a legend, hint and error, laid out like
 * `CheckboxGroup`. The fieldset is a `radiogroup`; it is marked invalid while an error is shown.
 */
export function RadioGroup({
  legend,
  hint,
  error,
  id,
  className,
  children,
  'aria-describedby': ownDescribedBy,
  ...props
}: RadioGroupProps) {
  const fieldIds = useFieldIds({ id, hint, error, describedBy: ownDescribedBy });

  return (
    <fieldset
      role="radiogroup"
      {...props}
      id={fieldIds.id}
      aria-describedby={fieldIds.describedBy}
      aria-invalid={error ? true : props['aria-invalid']}
      className={cn('grid min-w-0 gap-1.5', className)}
    >
      <legend className="mb-1 text-sm leading-5 font-medium text-secondary-foreground">
        {legend}
      </legend>
      {hint ? <FieldHint id={fieldIds.hintId}>{hint}</FieldHint> : null}
      <div className="grid gap-2">{children}</div>
      {error ? <FieldError id={fieldIds.errorId}>{error}</FieldError> : null}
    </fieldset>
  );
}
