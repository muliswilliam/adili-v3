import { ArrowLeft01Icon, ArrowRight01Icon, Calendar03Icon } from '@hugeicons/core-free-icons';
import { type ComponentProps, useEffect, useId, useRef, useState } from 'react';

import { cn } from '../lib/cn';
import {
  daysInMonth,
  formatDayMonthYear,
  parseDayMonthYear,
  shapeDateText,
} from '../lib/date-input';
import { Button } from './button';
import { Icon } from './icon';
import { Input } from './input';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

export type DateInputProps = Omit<
  ComponentProps<'input'>,
  'value' | 'defaultValue' | 'onChange' | 'type' | 'inputMode' | 'min' | 'max'
> & {
  /** The date as ISO `YYYY-MM-DD`, or null when the field is empty or not a real date. */
  value: string | null;
  /**
   * Called as the user types or picks, with the ISO date (null while the text is not a real
   * date) and the text shown, so a form can tell an empty field from an invalid one.
   */
  onValueChange: (value: string | null, details: { text: string; invalid: boolean }) => void;
  /** Earliest year in the picker. Defaults to 1900. */
  minYear?: number;
  /** Latest year in the picker. Defaults to five years after today. */
  maxYear?: number;
  /** Today as ISO `YYYY-MM-DD`; marks today in the picker and opens it there. Defaults to the device date. */
  today?: string;
  /** Names the button that opens the picker. */
  pickerLabel?: string;
};

interface Month {
  year: number;
  month: number; // 1-12
}

function localToday() {
  const now = new Date();
  return `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function monthOf(iso: string): Month {
  return { year: Number(iso.slice(0, 4)), month: Number(iso.slice(5, 7)) };
}

function isoOf(year: number, month: number, day: number) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * A date typed as DD/MM/YYYY, with a calendar picker as an alternative. Typing never needs the
 * picker: slashes are added as the user types and impossible dates such as 31/02/2026 are not
 * accepted. The picker is a small non-modal dialog; Esc closes it and returns focus to its
 * button. Other props go to the input, so it works inside a FormField.
 */
export function DateInput({
  value,
  onValueChange,
  minYear = 1900,
  maxYear,
  today: todayProp,
  pickerLabel = 'Choose a date from the calendar',
  id,
  className,
  disabled,
  readOnly,
  placeholder = 'DD/MM/YYYY',
  ...inputProps
}: DateInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const pickerId = `${inputId}-picker`;
  const today = todayProp ?? localToday();
  const lastYear = maxYear ?? monthOf(today).year + 5;
  const inputRef = useRef<HTMLInputElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState(() => (value ? formatDayMonthYear(value) : ''));
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState<Month>(() => monthOf(value ?? today));

  // Follow a value set from outside, e.g. a reset or a reload after a conflict.
  const [seenValue, setSeenValue] = useState(value);
  if (seenValue !== value) {
    setSeenValue(value);
    if (value !== parseDayMonthYear(text)) setText(value ? formatDayMonthYear(value) : '');
  }

  // Close when the pointer goes down outside the field and picker.
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [open]);

  // On opening, move focus to the chosen day, else today, else the first of the month.
  useEffect(() => {
    if (!open) return;
    const target =
      pickerRef.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]') ??
      pickerRef.current?.querySelector<HTMLButtonElement>('[aria-current="date"]') ??
      pickerRef.current?.querySelector<HTMLButtonElement>('[data-day]');
    target?.focus();
  }, [open]);

  function commit(nextText: string) {
    setText(nextText);
    const iso = parseDayMonthYear(nextText);
    setSeenValue(iso);
    onValueChange(iso, { text: nextText, invalid: nextText !== '' && iso === null });
  }

  function openPicker() {
    const start = monthOf(value ?? today);
    setShown({ year: Math.min(Math.max(start.year, minYear), lastYear), month: start.month });
    setOpen(true);
  }

  function closePicker() {
    setOpen(false);
    toggleRef.current?.focus();
  }

  function step(delta: number) {
    setShown(({ year, month }) => {
      const index = year * 12 + (month - 1) + delta;
      const next = { year: Math.floor(index / 12), month: (index % 12) + 1 };
      return next.year < minYear || next.year > lastYear ? { year, month } : next;
    });
  }

  function pick(day: number) {
    commit(formatDayMonthYear(isoOf(shown.year, shown.month, day)));
    setOpen(false);
    inputRef.current?.focus();
  }

  const leading = (new Date(Date.UTC(shown.year, shown.month - 1, 1)).getUTCDay() + 6) % 7;
  const dayCount = daysInMonth(shown.year, shown.month);
  const years: number[] = [];
  for (let year = lastYear; year >= minYear; year -= 1) years.push(year);
  const canInteract = !disabled && !readOnly;

  return (
    <div ref={wrapperRef} className={cn('relative w-full', className)}>
      <Input
        {...inputProps}
        ref={inputRef}
        id={inputId}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        maxLength={10}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
        value={text}
        onChange={(event) => {
          const native = event.nativeEvent as InputEvent;
          const inserting = native.inputType ? native.inputType.startsWith('insert') : true;
          commit(shapeDateText(event.target.value, inserting));
        }}
        className="pr-12 tabular-nums"
      />
      <Button
        ref={toggleRef}
        type="button"
        variant="ghost"
        size="icon"
        aria-label={pickerLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? pickerId : undefined}
        disabled={!canInteract}
        onClick={() => {
          if (open) closePicker();
          else openPicker();
        }}
        className="absolute top-1/2 right-1 -translate-y-1/2"
      >
        <Icon icon={Calendar03Icon} />
      </Button>
      {open ? (
        <div
          ref={pickerRef}
          id={pickerId}
          role="dialog"
          aria-label="Choose a date"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              closePicker();
            }
          }}
          className="absolute top-full right-0 z-50 mt-2 w-[296px] rounded-xl bg-card p-3 text-card-foreground shadow-pop"
        >
          <div className="mb-2 flex items-center gap-1.5">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Previous month"
              onClick={() => {
                step(-1);
              }}
            >
              <Icon icon={ArrowLeft01Icon} />
            </Button>
            <select
              aria-label="Month"
              value={shown.month}
              onChange={(event) => {
                setShown({ year: shown.year, month: Number(event.target.value) });
              }}
              className="h-9 min-w-0 flex-1 rounded-md bg-control px-1.5 text-sm shadow-control outline-none focus-visible:shadow-control-focus"
            >
              {MONTHS.map((name, index) => (
                <option key={name} value={index + 1}>
                  {name}
                </option>
              ))}
            </select>
            <select
              aria-label="Year"
              value={shown.year}
              onChange={(event) => {
                setShown({ year: Number(event.target.value), month: shown.month });
              }}
              className="h-9 w-[76px] rounded-md bg-control px-1.5 text-sm shadow-control outline-none focus-visible:shadow-control-focus"
            >
              {years.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Next month"
              onClick={() => {
                step(1);
              }}
            >
              <Icon icon={ArrowRight01Icon} />
            </Button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center">
            {WEEKDAYS.map((weekday) => (
              <span
                key={weekday}
                aria-hidden="true"
                className="py-1 text-xs font-medium text-muted-foreground"
              >
                {weekday}
              </span>
            ))}
            {Array.from({ length: leading }, (_, index) => (
              <span key={`blank-${String(index)}`} />
            ))}
            {Array.from({ length: dayCount }, (_, index) => {
              const day = index + 1;
              const iso = isoOf(shown.year, shown.month, day);
              return (
                <button
                  key={iso}
                  type="button"
                  data-day
                  aria-label={`${String(day)} ${MONTHS[shown.month - 1] ?? ''} ${String(shown.year)}`}
                  aria-pressed={iso === value}
                  aria-current={iso === today ? 'date' : undefined}
                  onClick={() => {
                    pick(day);
                  }}
                  className="h-9 rounded-md text-sm tabular-nums outline-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-[current=date]:font-semibold aria-[current=date]:underline"
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
