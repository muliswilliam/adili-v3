import { type ComponentProps, useId, useLayoutEffect, useRef, useState } from 'react';

import { cn } from '../lib/cn';
import { formatMoney, type MoneyInvalidReason, parseMoney, shapeMoneyText } from '../lib/money';
import { describedBy } from './form-field';
import { Input } from './input';

export type MoneyInputProps = Omit<
  ComponentProps<'input'>,
  'value' | 'defaultValue' | 'onChange' | 'type' | 'inputMode' | 'ref'
> & {
  /** The amount in integer cents, or null when the field is empty. */
  value: number | null;
  /**
   * Called as the user types, with the amount in cents (null when empty or not a valid amount)
   * and the text shown, so a form can tell an empty field from an invalid one.
   */
  onValueChange: (
    cents: number | null,
    details: { text: string; invalid: boolean; reason?: MoneyInvalidReason },
  ) => void;
  /** Shown before the amount and read after the label. Defaults to KES. */
  currency?: string;
};

function textFor(cents: number | null) {
  return cents === null ? '' : formatMoney(cents);
}

function centsOf(text: string) {
  const parsed = parseMoney(text);
  return parsed.status === 'valid' ? parsed.cents : null;
}

// Where the caret goes after reshaping: after the same number of digits and points as before.
function caretAfter(text: string, significantBefore: number) {
  let seen = 0;
  let index = 0;
  while (index < text.length && seen < significantBefore) {
    if (/[\d.]/.test(text.charAt(index))) seen += 1;
    index += 1;
  }
  return index;
}

/**
 * An amount of money that stores integer cents. Thousands separators are added as the user
 * types and at most two decimals are kept. A negative is refused, not changed: the minus stays
 * in the field and the change reports it invalid (reason `negative`) so the form can say why.
 * The currency is shown before the field and linked to it as a description. Other props go to
 * the input, so it works inside a FormField.
 */
export function MoneyInput({
  value,
  onValueChange,
  currency = 'KES',
  id,
  className,
  placeholder = '0',
  onBlur,
  'aria-describedby': ariaDescribedBy,
  ...inputProps
}: MoneyInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const currencyId = `${inputId}-currency`;
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const [text, setText] = useState(() => textFor(value));

  // Follow a value set from outside, e.g. a reset or a reload after a conflict.
  const [seenValue, setSeenValue] = useState(value);
  if (seenValue !== value) {
    setSeenValue(value);
    if (value !== centsOf(text)) setText(textFor(value));
  }

  useLayoutEffect(() => {
    const caret = pendingCaret.current;
    if (caret === null || document.activeElement !== inputRef.current) return;
    pendingCaret.current = null;
    inputRef.current?.setSelectionRange(caret, caret);
  });

  return (
    <div className={cn('relative w-full', className)}>
      <span
        id={currencyId}
        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[13.5px] font-semibold text-muted-foreground"
      >
        {currency}
      </span>
      <Input
        {...inputProps}
        ref={inputRef}
        id={inputId}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder={placeholder}
        aria-describedby={describedBy(ariaDescribedBy, currencyId)}
        value={text}
        onChange={(event) => {
          const raw = event.target.value;
          const caret = event.target.selectionStart ?? raw.length;
          const significant = raw.slice(0, caret).replace(/[^\d.]/g, '').length;
          const next = shapeMoneyText(raw);
          pendingCaret.current = caretAfter(next, significant);
          setText(next);
          const parsed = parseMoney(next);
          const cents = parsed.status === 'valid' ? parsed.cents : null;
          setSeenValue(cents);
          onValueChange(
            cents,
            parsed.status === 'invalid'
              ? { text: next, invalid: true, reason: parsed.reason }
              : { text: next, invalid: false },
          );
        }}
        onBlur={(event) => {
          onBlur?.(event);
          // Tidy "1,250." to "1,250" once the user leaves the field.
          const cents = centsOf(text);
          if (cents !== null) setText(formatMoney(cents));
        }}
        className="tabular-nums"
        // Clears the currency whatever its length.
        style={{ paddingLeft: `calc(${String(currency.length)}ch + 1.5rem)` }}
      />
    </div>
  );
}
