import { type ComponentProps, type ReactNode, useId } from 'react';

import { cn } from '../lib/cn';
import { describedBy, FieldError, FieldHint } from './form-field';

export interface SegmentedChoiceOption {
  value: string;
  label: ReactNode;
}

export type SegmentedChoiceProps = Omit<ComponentProps<'fieldset'>, 'onChange' | 'children'> & {
  /** Names the group, e.g. "Marital status". */
  legend: ReactNode;
  options: SegmentedChoiceOption[];
  /** The chosen option's value, or null when nothing is chosen yet. */
  value: string | null;
  onValueChange: (value: string) => void;
  /** Groups the radios; generated when omitted. */
  name?: string;
  hint?: ReactNode;
  /** When set, the group is marked invalid and the message is announced. */
  error?: ReactNode;
};

/**
 * A short single choice shown as a row of buttons, e.g. marital status. Built from native
 * radios in a fieldset, so arrow keys move between options and screen readers hear the legend
 * and the chosen option.
 */
export function SegmentedChoice({
  legend,
  options,
  value,
  onValueChange,
  name,
  hint,
  error,
  disabled,
  id,
  className,
  ...props
}: SegmentedChoiceProps) {
  const generatedId = useId();
  const groupId = id ?? generatedId;
  const groupName = name ?? groupId;
  const hintId = hint ? `${groupId}-hint` : undefined;
  const errorId = error ? `${groupId}-error` : undefined;

  return (
    <fieldset
      id={groupId}
      disabled={disabled}
      aria-describedby={describedBy(hintId, errorId)}
      className={cn('grid gap-1.5', className)}
      {...props}
    >
      <legend className="mb-1.5 text-sm leading-5 font-medium text-secondary-foreground">
        {legend}
      </legend>
      {hint ? <FieldHint id={hintId}>{hint}</FieldHint> : null}
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => (
          <label
            key={option.value}
            data-invalid={error ? true : undefined}
            className="relative inline-flex h-10 cursor-pointer items-center rounded-lg bg-control px-3.5 text-sm font-medium shadow-control select-none hover:shadow-control-hover has-checked:bg-primary has-checked:text-primary-foreground has-checked:shadow-none has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring has-disabled:cursor-not-allowed has-disabled:opacity-50 data-invalid:shadow-control-error"
          >
            <input
              type="radio"
              name={groupName}
              value={option.value}
              checked={value === option.value}
              aria-invalid={error ? true : undefined}
              onChange={() => {
                onValueChange(option.value);
              }}
              className="pointer-events-none absolute opacity-0"
            />
            {option.label}
          </label>
        ))}
      </div>
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </fieldset>
  );
}
