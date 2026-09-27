import {
  type ClipboardEvent,
  Fragment,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
} from 'react';

import { cn } from '../lib/cn';
import { describedBy, FieldError, FieldHint } from './form-field';
import { Input } from './input';

export interface OtpInputProps {
  /** Names the group, e.g. "Verification code". */
  label: ReactNode;
  hint?: ReactNode;
  /** When set, the boxes are marked invalid and the message is announced. */
  error?: ReactNode;
  /** The digits entered so far, at most `length` long. */
  value: string;
  /** Called once per edit (typing, paste, delete) with the whole code so far. */
  onChange: (value: string) => void;
  /** Called with the code when the last digit is filled, e.g. to submit it. */
  onComplete?: (value: string) => void;
  /** Defaults to 6. */
  length?: number;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Posts the whole code under this name, for plain HTML forms such as the Keycloak theme. */
  name?: string;
  /** Accessible name of each box. Defaults to "Digit N of 6". */
  digitLabel?: (position: number, length: number) => string;
  id?: string;
  className?: string;
}

function digitsOf(text: string): string {
  return text.replace(/\D/g, '');
}

/**
 * The digits a change put in a box. Typing into a box that already holds a digit (with the
 * caret beside it rather than selecting it) yields two characters; keep the new one.
 */
function typedDigits(raw: string, previous: string | undefined): string {
  const digits = digitsOf(raw);
  if (previous === undefined || digits.length !== 2) return digits;
  return digits.startsWith(previous) ? digits.slice(1) : digits.slice(0, 1);
}

/**
 * A one-time code entered in single-digit boxes. Typing moves to the next box, Backspace on an
 * empty box moves back, and pasting (or the phone's code autofill) fills every box at once.
 */
export function OtpInput({
  label,
  hint,
  error,
  value,
  onChange,
  onComplete,
  length = 6,
  disabled = false,
  autoFocus = false,
  name,
  digitLabel = (position, total) => `Digit ${String(position)} of ${String(total)}`,
  id,
  className,
}: OtpInputProps) {
  const generatedId = useId();
  const groupId = id ?? generatedId;
  const labelId = `${groupId}-label`;
  const hintId = hint ? `${groupId}-hint` : undefined;
  const errorId = error ? `${groupId}-error` : undefined;
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const code = digitsOf(value).slice(0, length);

  useEffect(() => {
    if (autoFocus) inputs.current[0]?.focus();
  }, [autoFocus]);

  function focusBox(index: number) {
    const box = inputs.current[Math.min(Math.max(index, 0), length - 1)];
    box?.focus();
    box?.select();
  }

  function commit(next: string) {
    const trimmed = next.slice(0, length);
    if (trimmed === code) return;
    onChange(trimmed);
    if (trimmed.length === length) onComplete?.(trimmed);
  }

  /** Writes digits from `index` on, e.g. one typed digit or a pasted code. */
  function fill(index: number, digits: string) {
    if (digits === '') return;
    // A full code always starts at the first box, wherever the cursor was.
    const start = digits.length >= length ? 0 : Math.min(index, code.length);
    const next = (code.slice(0, start) + digits + code.slice(start + digits.length)).slice(
      0,
      length,
    );
    commit(next);
    focusBox(Math.min(start + digits.length, length - 1));
  }

  function remove(index: number) {
    commit(code.slice(0, index) + code.slice(index + 1));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>, index: number) {
    switch (event.key) {
      case 'Backspace': {
        event.preventDefault();
        if (code[index] === undefined) {
          // Empty box: step back and clear the previous digit.
          if (index > 0) {
            remove(index - 1);
            focusBox(index - 1);
          }
        } else {
          remove(index);
        }
        break;
      }
      case 'Delete': {
        event.preventDefault();
        remove(index);
        break;
      }
      case 'ArrowLeft': {
        event.preventDefault();
        focusBox(index - 1);
        break;
      }
      case 'ArrowRight': {
        event.preventDefault();
        focusBox(Math.min(index + 1, code.length));
        break;
      }
      case 'Home': {
        event.preventDefault();
        focusBox(0);
        break;
      }
      case 'End': {
        event.preventDefault();
        focusBox(code.length);
        break;
      }
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLInputElement>, index: number) {
    event.preventDefault();
    fill(index, digitsOf(event.clipboardData.getData('text')));
  }

  return (
    <div
      role="group"
      id={groupId}
      aria-labelledby={labelId}
      aria-describedby={describedBy(hintId, errorId)}
      className={cn('grid gap-1.5', className)}
    >
      <span id={labelId} className="text-sm leading-5 font-medium text-secondary-foreground">
        {label}
      </span>
      {hint ? <FieldHint id={hintId}>{hint}</FieldHint> : null}
      <div className="flex gap-2">
        {Array.from({ length }, (_, index) => (
          <Fragment key={index}>
            {/* A gap splits the code in two halves, e.g. 482 913, so it is easier to read back. */}
            {index > 0 && index === Math.ceil(length / 2) ? (
              <span aria-hidden="true" className="w-2.5 shrink-0" />
            ) : null}
            <Input
              ref={(element) => {
                inputs.current[index] = element;
              }}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              // Lets iOS and Android offer the code from the SMS; it lands in the first box.
              autoComplete={index === 0 ? 'one-time-code' : 'off'}
              aria-label={digitLabel(index + 1, length)}
              aria-invalid={error ? true : undefined}
              disabled={disabled}
              value={code[index] ?? ''}
              onMouseDown={(event) => {
                // Keep the code gapless: a click past the last digit lands on the next empty box.
                if (index > code.length) {
                  event.preventDefault();
                  focusBox(code.length);
                }
              }}
              onFocus={(event) => {
                event.target.select();
              }}
              onKeyDown={(event) => {
                handleKeyDown(event, index);
              }}
              onPaste={(event) => {
                handlePaste(event, index);
              }}
              onChange={(event) => {
                fill(index, typedDigits(event.target.value, code[index]));
              }}
              className="h-[58px] max-w-[54px] px-0 text-center text-2xl font-semibold tabular-nums focus-visible:shadow-[0_0_0_1.5px_var(--ring),0_0_0_5px_color-mix(in_oklch,var(--ring)_8%,transparent)]"
            />
          </Fragment>
        ))}
      </div>
      {name ? <input type="hidden" name={name} value={code} /> : null}
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </div>
  );
}
