import type { ComponentProps, ReactNode } from 'react';

import { cn } from '../lib/cn';
import { useFieldIds } from '../lib/use-field-ids';
import { FieldError, FieldHint } from './form-field';

export type RadioCardProps = Omit<ComponentProps<'input'>, 'type'> & {
  label: ReactNode;
  /** Secondary text under the label, linked to the radio with `aria-describedby`. */
  description?: ReactNode;
  /**
   * Decorative icon, e.g. an `Icon`: at the end of the card, or in the tile at the top of a
   * `tile` card.
   */
  icon?: ReactNode;
  /**
   * `row` (default): the radio dot, then the label. `tile`: the kit's `.choice.tile`, a taller
   * card with the icon in a tile at the top that inks in when chosen, and no dot; for a few big
   * choices side by side.
   */
  layout?: 'row' | 'tile';
};

/**
 * One choice of a `RadioGroup`, drawn as the prototype kit's `.choice` card: the whole surface
 * selects it. A native radio, so arrow keys move between choices and it submits with forms.
 */
export function RadioCard({
  label,
  description,
  icon,
  layout = 'row',
  id,
  className,
  disabled,
  'aria-describedby': ownDescribedBy,
  ...props
}: RadioCardProps) {
  const fieldIds = useFieldIds({ id, hint: description, ownDescribedBy });
  const labelId = `${fieldIds.id}-label`;
  const tile = layout === 'tile';

  return (
    <label
      htmlFor={fieldIds.id}
      className={cn(
        'relative flex min-h-11 cursor-pointer items-start gap-2.5 rounded-lg bg-control px-3 py-2.5 text-[14.5px] font-medium shadow-control transition-shadow select-none hover:shadow-control-hover has-checked:shadow-control-selected has-focus-visible:outline-3 has-focus-visible:outline-ring/15 has-disabled:cursor-not-allowed has-disabled:opacity-50',
        tile && 'min-h-[78px] flex-col gap-2 p-3',
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
      {tile ? (
        <span
          aria-hidden="true"
          className="grid size-[30px] shrink-0 place-items-center rounded-lg bg-muted text-secondary-foreground transition-colors peer-checked:bg-foreground peer-checked:text-background [&_svg]:size-[17px]"
        >
          {icon}
        </span>
      ) : (
        <span
          aria-hidden="true"
          className="mt-0.5 size-[18px] shrink-0 rounded-full bg-control shadow-[inset_0_0_0_1.5px_var(--input)] transition-shadow peer-checked:shadow-[inset_0_0_0_5px_var(--primary)]"
        />
      )}
      <span className={cn('grid min-w-0 gap-0.5', !tile && 'flex-1')}>
        <span id={labelId}>{label}</span>
        {description ? (
          <FieldHint id={fieldIds.hintId} className="font-normal">
            {description}
          </FieldHint>
        ) : null}
      </span>
      {icon && !tile ? (
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
  /** Keeps the legend for screen readers only, when a heading above already asks the question. */
  legendHidden?: boolean;
  /**
   * `2` lays the choices out side by side, e.g. two `tile` cards; `3` puts three side by side
   * from `sm` and stacks them on a phone.
   */
  columns?: 1 | 2 | 3;
};

/**
 * A fieldset of `RadioCard`s sharing one `name`, with a legend, hint and error, laid out like
 * `CheckboxGroup`. The fieldset is a `radiogroup`; it is marked invalid while an error is shown.
 */
export function RadioGroup({
  legend,
  hint,
  error,
  legendHidden = false,
  columns = 1,
  id,
  className,
  children,
  'aria-describedby': ownDescribedBy,
  ...props
}: RadioGroupProps) {
  const fieldIds = useFieldIds({ id, hint, error, ownDescribedBy });

  return (
    <fieldset
      role="radiogroup"
      {...props}
      id={fieldIds.id}
      aria-describedby={fieldIds.describedBy}
      aria-invalid={error ? true : props['aria-invalid']}
      className={cn('grid min-w-0 gap-1.5', className)}
    >
      <legend
        className={cn(
          'mb-1 text-sm leading-5 font-medium text-secondary-foreground',
          legendHidden && 'sr-only',
        )}
      >
        {legend}
      </legend>
      {hint ? <FieldHint id={fieldIds.hintId}>{hint}</FieldHint> : null}
      <div
        className={cn(
          'grid gap-2',
          columns === 2 && 'grid-cols-2',
          columns === 3 && 'sm:grid-cols-3',
        )}
      >
        {children}
      </div>
      {error ? <FieldError id={fieldIds.errorId}>{error}</FieldError> : null}
    </fieldset>
  );
}
