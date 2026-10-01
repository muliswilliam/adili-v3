import { Button, cn, Icon, Input } from '@adili/ui';
import { Search01Icon, Tick02Icon } from '@hugeicons/core-free-icons';
import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';

import type { OnboardingCommission } from '../../server/directory/types';

/** Commissions whose name or code contains the typed text, ignoring case. */
export function matchCommissions(
  commissions: OnboardingCommission[],
  query: string,
): OnboardingCommission[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return commissions;
  return commissions.filter(
    (entry) =>
      entry.name.toLowerCase().includes(needle) || entry.issuerCode.toLowerCase().includes(needle),
  );
}

export interface CommissionPickerProps {
  commissions: OnboardingCommission[];
  /** The chosen Commission's slug, or null. */
  value: string | null;
  onValueChange: (slug: string) => void;
  /** Whether the search and list show; otherwise the chosen Commission shows as a card. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** From FormField, for the search input. */
  id?: string;
  'aria-describedby'?: string;
}

/**
 * Search for the Responsible Commission (the prototype's `.combo`). The list shows under the
 * search rather than over the page, since picking is all the step asks. Once picked it collapses
 * to a card with a Change button. Follows the ARIA combobox pattern: arrow keys move through the
 * list, Enter picks, Esc goes back to the chosen Commission.
 */
export function CommissionPicker({
  commissions,
  value,
  onValueChange,
  open,
  onOpenChange,
  id,
  'aria-describedby': describedBy,
}: CommissionPickerProps) {
  const listId = useId();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const changeRef = useRef<HTMLButtonElement>(null);
  // Moves focus along when the picker opens or closes, but not on the first render.
  const focusNext = useRef(false);

  const selected = commissions.find((entry) => entry.slug === value);
  const matches = matchCommissions(commissions, query);
  const optionId = (index: number) => `${listId}-${String(index)}`;

  useEffect(() => {
    if (!focusNext.current) return;
    focusNext.current = false;
    if (open) inputRef.current?.focus();
    else changeRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (active >= 0)
      document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' });
  });

  function pick(entry: OnboardingCommission) {
    onValueChange(entry.slug);
    setQuery('');
    setActive(-1);
    focusNext.current = true;
    onOpenChange(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case 'ArrowDown': {
        event.preventDefault();
        setActive((current) => (matches.length === 0 ? -1 : (current + 1) % matches.length));
        break;
      }
      case 'ArrowUp': {
        event.preventDefault();
        setActive((current) =>
          matches.length === 0 ? -1 : (current <= 0 ? matches.length : current) - 1,
        );
        break;
      }
      case 'Enter': {
        // One match left is as good as choosing it.
        const entry = matches[active] ?? (matches.length === 1 ? matches[0] : undefined);
        if (entry) {
          event.preventDefault();
          pick(entry);
        }
        break;
      }
      case 'Escape': {
        event.preventDefault();
        if (selected) {
          setQuery('');
          focusNext.current = true;
          onOpenChange(false);
        } else {
          setQuery('');
          setActive(-1);
        }
        break;
      }
    }
  }

  if (!open && selected) {
    return (
      <div className="flex items-center gap-3 rounded-lg bg-card px-3.5 py-3 ring-[1.5px] ring-foreground">
        <CodeChip code={selected.issuerCode} className="h-[30px] rounded-sm text-xs" />
        <p className="min-w-0 flex-1 leading-[1.3] font-semibold">{selected.name}</p>
        <Button
          ref={changeRef}
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            focusNext.current = true;
            onOpenChange(true);
          }}
        >
          Change<span className="sr-only"> Responsible Commission</span>
        </Button>
      </div>
    );
  }

  return (
    <div>
      <div className="relative">
        <Input
          ref={inputRef}
          id={id}
          aria-describedby={describedBy}
          type="text"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={active >= 0 ? optionId(active) : undefined}
          placeholder="Search, e.g. Teachers"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(-1);
          }}
          onKeyDown={handleKeyDown}
          className="pl-10"
        />
        <Icon
          icon={Search01Icon}
          className="pointer-events-none absolute top-1/2 left-3 size-[17px] -translate-y-1/2 text-muted-foreground"
        />
      </div>
      <ul
        id={listId}
        role="listbox"
        aria-label="Commissions"
        // Keeps focus in the search while a click picks an option or scrolls the list.
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        className="mt-2 max-h-80 overflow-y-auto rounded-xl bg-card p-1.5 shadow-pop"
      >
        {matches.length === 0 ? (
          <li role="presentation" className="px-3 py-4 text-sm text-muted-foreground">
            No match for "{query.trim()}". Try its short name, e.g. TSC.
          </li>
        ) : (
          matches.map((entry, index) => (
            <li
              key={entry.slug}
              id={optionId(index)}
              role="option"
              aria-selected={entry.slug === value}
              data-active={index === active || undefined}
              onClick={() => {
                pick(entry);
              }}
              onMouseMove={() => {
                setActive(index);
              }}
              className="flex cursor-pointer items-center gap-3 rounded-md p-2.5 select-none hover:bg-muted data-active:bg-muted aria-selected:bg-muted"
            >
              <CodeChip code={entry.issuerCode} className="h-[26px] rounded-sm text-[11.5px]" />
              <span className="min-w-0 flex-1 text-[14.5px] leading-[1.3] font-medium">
                {entry.name}
                {entry.hasRoster ? null : (
                  <span className="block text-[13px] font-normal text-muted-foreground">
                    Roster not imported yet
                  </span>
                )}
              </span>
              {entry.slug === value ? (
                <Icon icon={Tick02Icon} strokeWidth={2.4} className="shrink-0" />
              ) : null}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

function CodeChip({ code, className }: { code: string; className?: string }) {
  return (
    <span
      className={cn(
        'grid min-w-[58px] shrink-0 place-items-center bg-brand-subtle px-1.5 font-mono font-semibold tracking-[0.02em] text-brand-subtle-foreground',
        className,
      )}
    >
      {code}
    </span>
  );
}

/** The chosen Commission as a pill, on the steps after the Commission step. */
export function CommissionChip({ commission }: { commission: OnboardingCommission }) {
  return (
    <span className="inline-flex max-w-full items-center gap-2 rounded-full bg-card py-1.5 pr-2 pl-1.5 text-[13.5px] font-medium shadow-control">
      <span className="grid h-[22px] shrink-0 place-items-center rounded-full bg-brand-subtle px-[7px] font-mono text-[11px] font-semibold text-brand-subtle-foreground">
        {commission.issuerCode}
      </span>
      <span className="truncate">{commission.name}</span>
    </span>
  );
}
