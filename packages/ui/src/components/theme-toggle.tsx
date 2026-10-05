import { ComputerIcon, Moon02Icon, Sun03Icon } from '@hugeicons/core-free-icons';
import { useContext, useEffect, useState } from 'react';

import { cn } from '../lib/cn';
import { applyThemePreference, type ThemePreference } from '../lib/theme';
import { Button } from './button';
import { Icon } from './icon';
import { ThemePreferenceContext } from './theme-preference';

const ORDER = [
  { value: 'system', label: 'System', icon: ComputerIcon },
  { value: 'light', label: 'Light', icon: Sun03Icon },
  { value: 'dark', label: 'Dark', icon: Moon02Icon },
] as const satisfies readonly { value: ThemePreference; label: string; icon: unknown }[];

export interface ThemeToggleProps {
  /** The server-read preference; defaults to `ThemePreferenceContext`. */
  initial?: ThemePreference;
  className?: string;
}

/**
 * `ThemeSwitcher`'s choices as one button that steps System, Light, Dark, for pages with a tight
 * script budget (the verify app): no menu to load. Same ghost control, same shared cookie.
 */
export function ThemeToggle({ initial, className }: ThemeToggleProps) {
  const provided = useContext(ThemePreferenceContext);
  const [preference, setPreference] = useState<ThemePreference>(initial ?? provided);
  const index = ORDER.findIndex((option) => option.value === preference);
  const current = ORDER[index] ?? ORDER[0];
  const next = ORDER[(index + 1) % ORDER.length] ?? ORDER[0];
  useEffect(() => {
    if (!document.documentElement.dataset.theme) applyThemePreference(preference);
  }, [preference]);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={`Theme: ${current.label}. Switch to ${next.label}`}
      title={`Theme: ${current.label}`}
      className={cn('size-[34px] shrink-0 text-muted-foreground hover:text-foreground', className)}
      onClick={() => {
        setPreference(next.value);
        applyThemePreference(next.value);
      }}
    >
      <Icon icon={current.icon} />
    </Button>
  );
}
