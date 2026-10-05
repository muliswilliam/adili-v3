import { ComputerIcon, Moon02Icon, Sun03Icon } from '@hugeicons/core-free-icons';
import { useContext, useEffect, useRef, useState } from 'react';

import { cn } from '../lib/cn';
import { applyThemePreference, parseThemePreference, type ThemePreference } from '../lib/theme';
import { Button } from './button';
import { Icon } from './icon';
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from './menu';
import { ThemePreferenceContext } from './theme-preference';

const OPTIONS = [
  { value: 'system', label: 'System', icon: ComputerIcon },
  { value: 'light', label: 'Light', icon: Sun03Icon },
  { value: 'dark', label: 'Dark', icon: Moon02Icon },
] as const satisfies readonly { value: ThemePreference; label: string; icon: unknown }[];

export interface ThemeSwitcherProps {
  /** The server-read preference; defaults to `ThemePreferenceContext`. */
  initial?: ThemePreference;
  className?: string;
}

/**
 * Picks the colour theme: System (the device's), Light or Dark. The choice is kept in a cookie
 * the portal, console and verify share, and applies at once without a reload.
 */
export function ThemeSwitcher({ initial, className }: ThemeSwitcherProps) {
  const provided = useContext(ThemePreferenceContext);
  const [preference, setPreference] = useState<ThemePreference>(initial ?? provided);
  const pickedWithPointer = useRef(false);
  const current = OPTIONS.find((option) => option.value === preference) ?? OPTIONS[0];
  // The head script set the theme before the first paint; if React rendered <html> afresh
  // since (a client-rendered shell), set it again.
  useEffect(() => {
    if (!document.documentElement.dataset.theme) applyThemePreference(preference);
  }, [preference]);
  return (
    <Menu>
      {/* The language picker's ghost control, icon only and the same 34px height. */}
      <MenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Theme: ${current.label}`}
          title={`Theme: ${current.label}`}
          className={cn(
            'size-[34px] shrink-0 text-muted-foreground hover:text-foreground',
            className,
          )}
        >
          <Icon icon={current.icon} />
        </Button>
      </MenuTrigger>
      <MenuContent
        className="min-w-[160px]"
        onCloseAutoFocus={(event) => {
          // Picked with the pointer: leave focus where it is rather than drawing the keyboard ring
          // on the trigger. With the keyboard, Radix returns focus to the trigger as usual.
          if (pickedWithPointer.current) event.preventDefault();
          pickedWithPointer.current = false;
        }}
        onPointerDown={() => {
          pickedWithPointer.current = true;
        }}
        onKeyDown={() => {
          pickedWithPointer.current = false;
        }}
      >
        <p className="px-2.5 pt-1.5 pb-1 text-[11.5px] font-semibold tracking-[0.04em] text-muted-foreground uppercase">
          Theme
        </p>
        <MenuRadioGroup
          value={preference}
          onValueChange={(value) => {
            const next = parseThemePreference(value);
            setPreference(next);
            applyThemePreference(next);
          }}
        >
          {OPTIONS.map((option) => (
            <MenuRadioItem key={option.value} value={option.value} icon={option.icon}>
              {option.label}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}
