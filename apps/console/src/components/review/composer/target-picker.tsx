import { cn, focusRing, Icon, Input } from '@adili/ui';
import {
  ArrowDown01Icon,
  CircleIcon,
  LeftToRightListBulletIcon,
  Search01Icon,
} from '@hugeicons/core-free-icons';
import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';

import type { ClarificationTarget } from '../../../clarification/targets';
import { messages as t } from './messages';

/**
 * Picks what a clarification item is about (spec 07a FE-4: "a listbox with search"): a button
 * showing the choice, which opens a filter field over the sections, statements and items of the
 * current version, grouped by person. Arrow keys move through the matches, Enter picks, Esc
 * closes and returns to the button.
 */
export function TargetPicker({
  targets,
  value,
  onChange,
  invalid = false,
  labelledBy,
  describedBy,
  defaultOpen = false,
}: {
  targets: readonly ClarificationTarget[];
  value: ClarificationTarget | null;
  onChange: (target: ClarificationTarget) => void;
  invalid?: boolean;
  /** The id of the field's label. */
  labelledBy: string;
  describedBy?: string;
  /** Open on mount, e.g. for a new item. */
  defaultOpen?: boolean;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const [open, setOpen] = useState(defaultOpen);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const root = useRef<HTMLDivElement>(null);
  const filter = useRef<HTMLInputElement>(null);

  const needle = query.trim().toLowerCase();
  const matches = targets.filter(
    (target) => !needle || target.label.toLowerCase().includes(needle),
  );
  const groups = [...new Set(matches.map((target) => target.group))];
  const optionId = (index: number) => `${id}-option-${String(index)}`;

  useEffect(() => {
    if (!open) return;
    filter.current?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  useEffect(() => {
    if (open && active >= 0) {
      document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' });
    }
  });

  function close(refocus: boolean) {
    setOpen(false);
    setQuery('');
    setActive(-1);
    if (refocus) document.getElementById(`${id}-button`)?.focus();
  }

  function choose(target: ClarificationTarget) {
    onChange(target);
    close(true);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (matches.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((current) => (current + step + matches.length) % matches.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const target = matches[active] ?? (matches.length === 1 ? matches[0] : undefined);
      if (target) choose(target);
    } else if (event.key === 'Escape') {
      // Closes the list; the drawer around it ignores this Esc (see `isInOpenPicker`).
      event.preventDefault();
      close(true);
    }
  }

  return (
    <div ref={root} className="relative" data-target-picker={open ? 'open' : undefined}>
      <button
        id={`${id}-button`}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-labelledby={`${labelledBy} ${id}-value`}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        onClick={() => {
          if (open) close(false);
          else setOpen(true);
        }}
        className={cn(
          'flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-lg bg-control px-3 py-2 text-left text-[14.5px] transition-shadow',
          invalid ? 'shadow-control-error' : 'shadow-control hover:shadow-control-hover',
          focusRing,
        )}
      >
        <Icon icon={Search01Icon} className="size-4 shrink-0 text-muted-foreground" />
        <span
          id={`${id}-value`}
          className={cn('min-w-0 flex-1', value ? 'text-foreground' : 'text-placeholder')}
        >
          {value?.label ?? t.targetPlaceholder}
        </span>
        <Icon icon={ArrowDown01Icon} className="size-4 shrink-0 text-muted-foreground" />
      </button>
      {open ? (
        <div className="absolute inset-x-0 top-full z-20 mt-1.5 grid gap-1.5 rounded-xl bg-card p-2 shadow-pop">
          <Input
            ref={filter}
            type="search"
            role="combobox"
            aria-label={t.targetFilter}
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 ? optionId(active) : undefined}
            placeholder={t.targetFilter}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(-1);
            }}
            onKeyDown={onKeyDown}
            className="h-[38px] text-sm"
          />
          <ul
            id={listId}
            role="listbox"
            aria-label={t.targetList}
            className="m-0 max-h-[260px] list-none overflow-auto p-0"
          >
            {matches.length === 0 ? (
              <li role="presentation" className="px-2 pt-2 pb-1 text-sm text-muted-foreground">
                {t.targetNone}
              </li>
            ) : (
              groups.map((group) => (
                <li key={group} role="presentation">
                  <p
                    aria-hidden="true"
                    className="px-2 pt-2 pb-1 text-[11.5px] font-semibold tracking-[0.04em] text-muted-foreground uppercase"
                  >
                    {group}
                  </p>
                  <ul role="group" aria-label={group} className="m-0 list-none p-0">
                    {matches.map((target, index) =>
                      target.group === group ? (
                        <li
                          key={target.key}
                          id={optionId(index)}
                          role="option"
                          aria-selected={value?.key === target.key}
                          onPointerDown={(event) => {
                            // Keep focus in the filter until the choice is made.
                            event.preventDefault();
                          }}
                          onClick={() => {
                            choose(target);
                          }}
                          onPointerMove={() => {
                            setActive(index);
                          }}
                          className={cn(
                            'flex cursor-pointer items-center gap-2 rounded-lg px-2 py-[7px] text-[13.5px]',
                            index === active && 'bg-muted',
                            value?.key === target.key && 'font-semibold',
                          )}
                        >
                          <span
                            aria-hidden="true"
                            className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground"
                          >
                            <Icon
                              icon={target.kind === 'item' ? CircleIcon : LeftToRightListBulletIcon}
                              className={
                                target.kind === 'item' ? 'size-1.5 fill-current' : 'size-3.5'
                              }
                            />
                          </span>
                          <span className="min-w-0">{target.label}</span>
                        </li>
                      ) : null,
                    )}
                  </ul>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** Whether a key event comes from an open picker, whose Esc closes the list and nothing else. */
export function isInOpenPicker(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-target-picker="open"]') !== null;
}
