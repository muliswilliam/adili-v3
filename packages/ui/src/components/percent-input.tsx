import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';
import { Input } from './input';

export type PercentInputProps = Omit<
  ComponentProps<'input'>,
  'value' | 'defaultValue' | 'onChange' | 'type' | 'inputMode'
> & {
  /** The whole-number percentage, or null when the field is empty. */
  value: number | null;
  /** Called as the user types, with the percentage (null when the field is empty). */
  onValueChange: (value: number | null) => void;
};

/**
 * A whole-number percentage, 0 to 999, with a "%" inside the field on the right. Only digits
 * are kept, so a range check (say, at most 100) is the form's to make and explain. Other props
 * go to the input, so it works inside a FormField.
 */
export function PercentInput({ value, onValueChange, className, ...props }: PercentInputProps) {
  return (
    <div className="relative">
      <Input
        autoComplete="off"
        maxLength={3}
        {...props}
        inputMode="numeric"
        className={cn('pr-9 tabular-nums', className)}
        value={value === null ? '' : String(value)}
        onChange={(event) => {
          const digits = event.target.value.replace(/\D/g, '');
          onValueChange(digits === '' ? null : Number(digits));
        }}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[13.5px] font-semibold text-muted-foreground"
      >
        %
      </span>
    </div>
  );
}
