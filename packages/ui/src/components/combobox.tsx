import { Search01Icon, Tick02Icon } from '@hugeicons/core-free-icons';
import {
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useState,
} from 'react';

import { cn } from '../lib/cn';
import { Icon } from './icon';
import { Input } from './input';

export interface ComboboxOption {
  value: string;
  /** Shown in the list and in the input once chosen. */
  label: string;
  /** A short code shown as a chip before the label in the list, e.g. an issuer code. Also searched. */
  description?: string;
  /** Supporting information shown beneath the option label. */
  secondaryText?: string;
}

export type ComboboxProps = Omit<
  ComponentProps<'input'>,
  'value' | 'defaultValue' | 'onChange' | 'type' | 'role' | 'children'
> & {
  options: ComboboxOption[];
  /** The chosen option's value, or null. */
  value: string | null;
  onValueChange: (value: string | null) => void;
  /** Shown when nothing matches the typed text. */
  emptyText?: ReactNode;
  /** Decides whether an option matches the typed text. Defaults to a case-insensitive substring match on label and description. */
  filter?: (option: ComboboxOption, query: string) => boolean;
  /**
   * The chosen option, shown when `value` is not (yet) among `options`, e.g. while they load.
   * Ignored when its value is not `value`.
   */
  selectedOption?: ComboboxOption;
  onOpenChange?: (open: boolean) => void;
};

function defaultFilter(option: ComboboxOption, query: string) {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  return (
    option.label.toLowerCase().includes(needle) ||
    (option.description?.toLowerCase().includes(needle) ?? false)
  );
}

/**
 * A text input that filters a list of options, for picking one from a list too long to scan
 * (e.g. Commissions). Follows the ARIA combobox pattern: arrow keys move through the list,
 * Enter picks, Esc closes. Other props go to the input, so it works inside a FormField.
 */
export function Combobox({
  options,
  value,
  onValueChange,
  emptyText = 'No matches',
  filter = defaultFilter,
  selectedOption,
  onOpenChange,
  id,
  className,
  disabled,
  onBlur,
  onKeyDown,
  ...inputProps
}: ComboboxProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const listId = `${inputId}-listbox`;
  const selected =
    options.find((option) => option.value === value) ??
    (value !== null && selectedOption?.value === value ? selectedOption : null);
  const [query, setQuery] = useState(selected?.label ?? '');
  // Whether the text was typed since the last choice. Only text the user emptied clears the
  // choice on blur, not text that is empty because the chosen option has not loaded.
  const [edited, setEdited] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  // Typing filters; once an option is chosen the input shows it and the full list returns.
  const showingSelection = selected !== null && query === selected.label;
  const matches = showingSelection ? options : options.filter((option) => filter(option, query));
  const activeOption = matches[active];
  const optionId = (index: number) => `${inputId}-option-${String(index)}`;

  // Follow a value set from outside, e.g. a reset.
  const selectedLabel = selected?.label ?? '';
  const [shownLabel, setShownLabel] = useState(selectedLabel);
  if (shownLabel !== selectedLabel) {
    setShownLabel(selectedLabel);
    setQuery(selectedLabel);
    setEdited(false);
  }

  useEffect(() => {
    if (!open || active < 0) return;
    document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' });
  });

  function changeOpen(next: boolean) {
    setOpen(next);
    onOpenChange?.(next);
  }

  function close() {
    changeOpen(false);
    setActive(-1);
  }

  function choose(option: ComboboxOption) {
    setQuery(option.label);
    setEdited(false);
    close();
    if (option.value !== value) onValueChange(option.value);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    switch (event.key) {
      case 'ArrowDown': {
        event.preventDefault();
        changeOpen(true);
        setActive((current) => (matches.length === 0 ? -1 : (current + 1) % matches.length));
        break;
      }
      case 'ArrowUp': {
        event.preventDefault();
        changeOpen(true);
        setActive((current) =>
          matches.length === 0 ? -1 : (current <= 0 ? matches.length : current) - 1,
        );
        break;
      }
      case 'Enter': {
        if (open && activeOption) {
          event.preventDefault();
          choose(activeOption);
        }
        break;
      }
      case 'Escape': {
        if (open) {
          event.preventDefault();
          close();
        }
        break;
      }
    }
  }

  return (
    <div className={cn('relative w-full', className)}>
      <Input
        {...inputProps}
        id={inputId}
        type="text"
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && activeOption ? optionId(active) : undefined}
        disabled={disabled}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setEdited(true);
          changeOpen(true);
          setActive(-1);
        }}
        onClick={() => {
          changeOpen(true);
        }}
        onBlur={(event) => {
          onBlur?.(event);
          close();
          setEdited(false);
          // Clearing the text clears the choice; any other half-typed text reverts to it.
          if (edited && query.trim() === '') {
            if (value !== null) onValueChange(null);
          } else {
            setQuery(selected?.label ?? '');
          }
        }}
        onKeyDown={handleKeyDown}
        className="pl-10"
      />
      <Icon
        icon={Search01Icon}
        className="pointer-events-none absolute top-1/2 left-3 size-[17px] -translate-y-1/2 text-muted-foreground"
      />
      <ul
        id={listId}
        role="listbox"
        hidden={!open}
        // Keep focus in the input, so picking an option or scrolling the list does not blur it.
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        className="absolute inset-x-0 top-full z-50 mt-2 max-h-80 overflow-y-auto rounded-xl bg-card p-1.5 text-card-foreground shadow-pop"
      >
        {matches.length === 0 ? (
          <li role="presentation" className="px-3 py-4 text-sm text-muted-foreground">
            {emptyText}
          </li>
        ) : (
          matches.map((option, index) => (
            <li
              key={option.value}
              id={optionId(index)}
              role="option"
              aria-selected={option.value === value}
              data-active={index === active || undefined}
              onClick={() => {
                choose(option);
              }}
              onMouseMove={() => {
                setActive(index);
              }}
              className="flex cursor-default items-center gap-3 rounded-tile p-2.5 text-[14.5px] leading-snug font-medium select-none data-active:bg-muted"
            >
              <span className="min-w-0 flex-1">
                {option.label}
                {option.secondaryText ? (
                  <span className="block text-[13px] font-normal text-muted-foreground">
                    {option.secondaryText}
                  </span>
                ) : null}
              </span>
              {/* After the label in the DOM so the option is named by it, shown before it. */}
              {option.description ? (
                <span className="order-first grid h-[26px] min-w-[58px] shrink-0 place-items-center rounded-sm bg-brand-subtle px-1.5 font-mono text-[11.5px] font-semibold tracking-[0.02em] text-brand-subtle-foreground">
                  {option.description}
                </span>
              ) : null}
              {option.value === value ? (
                <Icon icon={Tick02Icon} strokeWidth={2.4} className="shrink-0" />
              ) : null}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
