import { type ComponentProps, type ReactNode, useId } from 'react';

import { cn } from '../lib/cn';
import { focusRingWithin } from '../lib/focus';
import { FieldError, FieldHint, joinIds } from './form-field';

export interface SegmentedChoiceOption {
  value: string;
  label: ReactNode;
}

export type SegmentedChoiceProps = Omit<ComponentProps<'fieldset'>, 'onChange' | 'children'> & {
  /** Names the group, e.g. "Marital status". */
  legend: ReactNode;
  options: readonly SegmentedChoiceOption[];
  /** The chosen option's value, or null when nothing is chosen yet. */
  value: string | null;
  onValueChange: (value: string) => void;
  /** Groups the radios; generated when omitted. */
  name?: string;
} & (
    | {
        /** `buttons` (default): a form question, the legend shown above 40px buttons. */
        variant?: 'buttons';
        hint?: ReactNode;
        /** When set, the group is marked invalid and the message is announced. */
        error?: ReactNode;
      }
    | {
        /**
         * `track`: a compact filter in a toolbar (the kit's `.seg`), 30px options on a muted
         * track, the chosen one raised; the legend is for screen readers only. A filter has no
         * hint or error.
         */
        variant: 'track';
        hint?: never;
        error?: never;
      }
  );

/**
 * A short single choice shown as a row of buttons, e.g. marital status, or as a compact track
 * of options in a toolbar (`variant="track"`), e.g. an Any / Onboarded / Not onboarded filter.
 * Built from native radios in a fieldset, so arrow keys move between options and screen readers
 * hear the legend and the chosen option.
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
  variant = 'buttons',
  ...props
}: SegmentedChoiceProps) {
  const generatedId = useId();
  const groupId = id ?? generatedId;
  const groupName = name ?? groupId;
  const hintId = hint ? `${groupId}-hint` : undefined;
  const errorId = error ? `${groupId}-error` : undefined;

  const radio = (option: SegmentedChoiceOption) => (
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
  );

  if (variant === 'track') {
    return (
      <fieldset
        id={groupId}
        disabled={disabled}
        className={cn('flex w-fit shrink-0 gap-0.5 rounded-lg bg-muted p-0.75', className)}
        {...props}
      >
        <legend className="sr-only">{legend}</legend>
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              'relative flex h-7.5 cursor-pointer items-center rounded-md px-3 text-[13.5px] font-medium whitespace-nowrap text-secondary-foreground select-none',
              'has-checked:bg-card has-checked:text-foreground has-checked:shadow-card',
              'has-disabled:cursor-default has-disabled:opacity-50',
              focusRingWithin,
            )}
          >
            {radio(option)}
            {option.label}
          </label>
        ))}
      </fieldset>
    );
  }

  return (
    <fieldset
      id={groupId}
      disabled={disabled}
      aria-describedby={joinIds(hintId, errorId)}
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
            className={cn(
              'relative inline-flex h-10 cursor-pointer items-center rounded-lg bg-control px-3.5 text-sm font-medium shadow-control select-none hover:shadow-control-hover has-checked:bg-primary has-checked:text-primary-foreground has-checked:shadow-none has-disabled:cursor-not-allowed has-disabled:opacity-50 data-invalid:shadow-control-error',
              focusRingWithin,
            )}
          >
            {radio(option)}
            {option.label}
          </label>
        ))}
      </div>
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </fieldset>
  );
}
