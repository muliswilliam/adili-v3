import {
  type ClipboardEvent,
  Fragment,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

import { cn } from '../lib/cn';
import { describedBy, FieldError, FieldHint } from './form-field';
import { Input } from './input';
import { Label } from './label';

export interface OtpInputProps {
  /** Names the group, e.g. "Verification code". */
  label: ReactNode;
  hint?: ReactNode;
  /** When set, the boxes are marked invalid and the message is announced. */
  error?: ReactNode;
  /**
   * The digits entered so far, at most `length` long. A box cleared in the middle of the code
   * leaves a gap on screen; the value is then the remaining digits without the gap.
   */
  value: string;
  /** Called once per edit (typing, paste, delete) with the whole code so far. */
  onChange: (value: string) => void;
  /**
   * Called with the code when it becomes complete, e.g. to submit it: when the last empty box is
   * filled, or when a full code is pasted. Replacing a digit of a code that is already complete
   * does not call it again.
   */
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

/** One entry per box, each a digit or '' when the box is empty. */
function slotsOf(value: string, length: number): string[] {
  const digits = digitsOf(value).slice(0, length);
  return Array.from({ length }, (_, index) => digits.charAt(index));
}

/**
 * The digits a change put in a box. Typing into a box that already holds a digit (with the
 * caret beside it rather than selecting it) yields two characters; keep the new one.
 */
function typedDigits(raw: string, previous: string): string {
  const digits = digitsOf(raw);
  if (previous === '' || digits.length !== 2) return digits;
  return digits.startsWith(previous) ? digits.slice(1) : digits.slice(0, 1);
}

/**
 * A one-time code entered in single-digit boxes. Each box is its own slot: typing overwrites
 * the box and moves to the next, Backspace clears the box (or, in an empty box, moves back and
 * clears the previous one), and Delete clears the box without moving anything. Pasting (or the
 * phone's code autofill) a full code fills every box at once; a paste longer than the code is
 * ignored, since it is not the code.
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

  // The boxes, gaps included. `value` has no gaps, so the slots are kept here and only reset
  // when `value` no longer matches them, e.g. the code is cleared from outside after an error.
  const [slots, setSlots] = useState(() => slotsOf(value, length));
  const code = slots.join('');
  if (slots.length !== length || digitsOf(value).slice(0, length) !== code) {
    setSlots(slotsOf(value, length));
  }
  const firstEmpty = slots.indexOf('');
  // The box after the last digit: ArrowRight and End go no further.
  const end = slots.findLastIndex((slot) => slot !== '') + 1;

  useEffect(() => {
    if (autoFocus) inputs.current[0]?.focus();
  }, [autoFocus]);

  function focusBox(index: number) {
    const box = inputs.current[Math.min(Math.max(index, 0), length - 1)];
    box?.focus();
    box?.select();
  }

  /** `fullCode` marks a whole code pasted or autofilled at once, which always completes. */
  function commit(next: string[], fullCode = false) {
    const nextCode = next.join('');
    setSlots(next);
    if (nextCode !== code) onChange(nextCode);
    const complete = nextCode.length === length;
    if (complete && (fullCode || code.length < length)) onComplete?.(nextCode);
  }

  /** Writes digits from `index` on, e.g. one typed digit or a pasted code. */
  function fill(index: number, digits: string) {
    if (digits === '' || digits.length > length) return;
    if (digits.length === length) {
      // A full code always starts at the first box, wherever the cursor was.
      commit(digits.split(''), true);
      focusBox(length - 1);
      return;
    }
    // Start early enough that every digit lands in a box.
    const start = Math.min(index, length - digits.length);
    const next = [...slots];
    next.splice(start, digits.length, ...digits.split(''));
    commit(next);
    focusBox(start + digits.length);
  }

  function clear(index: number) {
    if (slots[index] === '') return;
    commit(slots.map((slot, position) => (position === index ? '' : slot)));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>, index: number) {
    switch (event.key) {
      case 'Backspace': {
        event.preventDefault();
        if (slots[index] !== '') {
          clear(index);
        } else if (index > 0) {
          // Empty box: step back and clear the previous digit.
          clear(index - 1);
          focusBox(index - 1);
        }
        break;
      }
      case 'Delete': {
        event.preventDefault();
        clear(index);
        break;
      }
      case 'ArrowLeft': {
        event.preventDefault();
        focusBox(index - 1);
        break;
      }
      case 'ArrowRight': {
        event.preventDefault();
        if (index < end) focusBox(index + 1);
        break;
      }
      case 'Home': {
        event.preventDefault();
        focusBox(0);
        break;
      }
      case 'End': {
        event.preventDefault();
        focusBox(end);
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
      <Label asChild id={labelId}>
        <span>{label}</span>
      </Label>
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
              value={slots[index] ?? ''}
              onMouseDown={(event) => {
                // A click on an empty box past the first gap lands on that gap; filled boxes can
                // always be clicked to change them.
                if (slots[index] === '' && firstEmpty !== -1 && index > firstEmpty) {
                  event.preventDefault();
                  focusBox(firstEmpty);
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
                fill(index, typedDigits(event.target.value, slots[index] ?? ''));
              }}
              className="h-[58px] max-w-[54px] px-0 text-center text-2xl font-semibold tabular-nums"
            />
          </Fragment>
        ))}
      </div>
      {name ? <input type="hidden" name={name} value={code} /> : null}
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </div>
  );
}
