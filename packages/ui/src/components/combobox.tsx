import { ArrowDown01Icon, Tick02Icon } from '@hugeicons/core-free-icons';
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
  /** Secondary text in the list, e.g. an issuer code. Also searched. */
  description?: string;
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
  const selected = options.find((option) => option.value === value) ?? null;
  const [query, setQuery] = useState(selected?.label ?? '');
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
  }

  useEffect(() => {
    if (!open || active < 0) return;
    document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' });
  });

  function choose(option: ComboboxOption) {
    setQuery(option.label);
    setOpen(false);
    setActive(-1);
    if (option.value !== value) onValueChange(option.value);
  }

  function close() {
    setOpen(false);
    setActive(-1);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    switch (event.key) {
      case 'ArrowDown': {
        event.preventDefault();
        setOpen(true);
        setActive((current) => (matches.length === 0 ? -1 : (current + 1) % matches.length));
        break;
      }
      case 'ArrowUp': {
        event.preventDefault();
        setOpen(true);
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
          setOpen(true);
          setActive(-1);
        }}
        onClick={() => {
          setOpen(true);
        }}
        onBlur={(event) => {
          onBlur?.(event);
          close();
          // Clearing the text clears the choice; any other half-typed text reverts to it.
          if (query.trim() === '') {
            if (value !== null) onValueChange(null);
          } else {
            setQuery(selected?.label ?? '');
          }
        }}
        onKeyDown={handleKeyDown}
        className="pr-8"
      />
      <Icon
        icon={ArrowDown01Icon}
        className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-muted-foreground"
      />
      <ul
        id={listId}
        role="listbox"
        hidden={!open}
        // Keep focus in the input, so picking an option or scrolling the list does not blur it.
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        className="absolute inset-x-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-lg border bg-card p-1 text-card-foreground shadow-md"
      >
        {matches.length === 0 ? (
          <li role="presentation" className="px-2 py-1.5 text-sm text-muted-foreground">
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
              className="relative flex cursor-default flex-col gap-0.5 rounded-md py-1.5 pr-8 pl-2 text-sm select-none data-active:bg-secondary-hover"
            >
              <span>{option.label}</span>
              {option.description ? (
                <span className="font-mono text-xs text-muted-foreground">
                  {option.description}
                </span>
              ) : null}
              {option.value === value ? (
                <Icon icon={Tick02Icon} className="absolute top-2 right-2" />
              ) : null}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
