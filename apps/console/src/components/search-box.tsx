import { cn, Icon, Input } from '@adili/ui';
import { Search01Icon } from '@hugeicons/core-free-icons';
import { useEffect, useEffectEvent, useState } from 'react';

/** Wait this long after the last keystroke before searching (spec 01). */
export const SEARCH_DEBOUNCE_MS = 300;

/**
 * A list toolbar's search input that applies its text 300 ms after the last keystroke, or at
 * once on Enter or blur. Follows `applied` (the URL) when that changes from elsewhere, e.g.
 * "Clear filters".
 */
export function SearchBox({
  id,
  label,
  placeholder,
  maxLength,
  applied,
  disabled = false,
  className,
  onSearch,
}: {
  id: string;
  label: string;
  placeholder: string;
  maxLength: number;
  applied: string;
  disabled?: boolean;
  className?: string;
  onSearch: (value: string) => void;
}) {
  const [text, setText] = useState(applied);
  const [seen, setSeen] = useState(applied);
  if (applied !== seen) {
    setSeen(applied);
    if (applied !== text.trim()) setText(applied);
  }

  const apply = (value: string) => {
    if (value.trim() !== applied) onSearch(value.trim());
  };

  // The latest `applied` and `onSearch`, so the timer restarts on keystrokes only.
  const applyLatest = useEffectEvent((value: string) => {
    apply(value);
  });
  useEffect(() => {
    const timer = setTimeout(() => {
      applyLatest(text);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [text]);

  return (
    <form
      className={cn('relative max-w-[360px] min-w-[220px] flex-1', className)}
      onSubmit={(event) => {
        event.preventDefault();
        apply(text);
      }}
    >
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Icon
        icon={Search01Icon}
        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        id={id}
        type="search"
        placeholder={placeholder}
        value={text}
        maxLength={maxLength}
        disabled={disabled}
        onChange={(event) => {
          setText(event.target.value);
        }}
        onBlur={() => {
          apply(text);
        }}
        className="h-9 pl-9 text-sm"
      />
    </form>
  );
}
