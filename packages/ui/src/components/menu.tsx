import { MoreVerticalIcon } from '@hugeicons/core-free-icons';
import {
  type ComponentProps,
  createContext,
  type KeyboardEvent,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

import { cn } from '../lib/cn';
import { Button } from './button';
import { Icon, type IconProps } from './icon';

const MenuContext = createContext<{ close: () => void } | null>(null);

const ITEM = '[role="menuitem"]';

function items(menu: HTMLElement | null): HTMLElement[] {
  return menu ? Array.from(menu.querySelectorAll<HTMLElement>(ITEM)) : [];
}

export type MenuProps = Omit<ComponentProps<'div'>, 'children'> & {
  /** Names the trigger button, and the menu, e.g. "Actions for logbook-KCB782M.pdf". */
  label: string;
  /** The trigger's icon. Defaults to a vertical ellipsis. */
  icon?: IconProps['icon'];
  /** MenuItem and MenuNote entries. */
  children: ReactNode;
  /** Which edge of the trigger the menu lines up with. Defaults to the end (right). */
  align?: 'start' | 'end';
  disabled?: boolean;
};

/**
 * A small action menu behind an icon button, e.g. the actions on an attachment row. Follows the
 * menu button pattern: the trigger has `aria-haspopup="menu"` and `aria-expanded`; opening it
 * (click, Enter, Space or the arrow keys) moves focus into the menu; arrows, Home and End move
 * between entries; Esc closes it and returns focus to the trigger; Tab or a click outside
 * closes it. Choosing an entry closes the menu and returns focus to the trigger before its
 * `onSelect` runs, so a dialog it opens returns focus there too.
 */
export function Menu({
  label,
  icon = MoreVerticalIcon,
  children,
  align = 'end',
  disabled = false,
  className,
  ...props
}: MenuProps) {
  const [open, setOpen] = useState(false);
  const [focusOn, setFocusOn] = useState<'first' | 'last'>('first');
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerId = useId();
  const menuId = useId();

  function show(target: 'first' | 'last') {
    setFocusOn(target);
    setOpen(true);
  }

  function close(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    const entries = items(menuRef.current);
    (focusOn === 'first' ? entries[0] : entries.at(-1))?.focus();

    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open, focusOn]);

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const entries = items(menuRef.current);
    const index = entries.indexOf(document.activeElement as HTMLElement);
    const move = (next: number) => {
      event.preventDefault();
      entries[(next + entries.length) % entries.length]?.focus();
    };
    switch (event.key) {
      case 'ArrowDown':
        move(index + 1);
        break;
      case 'ArrowUp':
        move(index - 1);
        break;
      case 'Home':
        move(0);
        break;
      case 'End':
        move(entries.length - 1);
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        close(true);
        break;
      case 'Tab':
        setOpen(false);
        break;
    }
  }

  return (
    <MenuContext
      value={{
        close: () => {
          close(true);
        },
      }}
    >
      <div ref={rootRef} className={cn('relative inline-flex', className)} {...props}>
        <Button
          ref={triggerRef}
          id={triggerId}
          type="button"
          variant="ghost"
          size="icon"
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          disabled={disabled}
          onClick={() => {
            if (open) close(false);
            else show('first');
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              show(event.key === 'ArrowDown' ? 'first' : 'last');
            }
          }}
        >
          <Icon icon={icon} />
        </Button>
        {open ? (
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-labelledby={triggerId}
            onKeyDown={onMenuKeyDown}
            className={cn(
              'absolute top-full z-50 mt-1 grid w-max max-w-[300px] min-w-[200px] rounded-xl bg-card p-1.5 text-card-foreground shadow-pop',
              align === 'end' ? 'right-0' : 'left-0',
            )}
          >
            {children}
          </div>
        ) : null}
      </div>
    </MenuContext>
  );
}

export type MenuItemProps = Omit<ComponentProps<'button'>, 'onSelect' | 'role'> & {
  /** Runs after the menu has closed and focus is back on its trigger. */
  onSelect: () => void;
  icon?: IconProps['icon'];
  /** `destructive` for removals. `ai` tints the icon for AI-assisted actions. */
  tone?: 'default' | 'destructive' | 'ai';
};

/** One action in a Menu. A disabled entry stays reachable with the arrows but does nothing. */
export function MenuItem({
  onSelect,
  icon,
  tone = 'default',
  disabled = false,
  className,
  children,
  ...props
}: MenuItemProps) {
  const menu = useContext(MenuContext);

  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      aria-disabled={disabled || undefined}
      className={cn(
        'flex min-h-9 w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm outline-none select-none hover:bg-muted focus:bg-muted aria-disabled:pointer-events-none aria-disabled:opacity-50',
        tone === 'destructive' && 'text-destructive',
        className,
      )}
      onClick={() => {
        if (disabled) return;
        menu?.close();
        onSelect();
      }}
      {...props}
    >
      {icon ? <Icon icon={icon} className={cn('size-4', tone === 'ai' && 'text-ai')} /> : null}
      {children}
    </button>
  );
}

export type MenuNoteProps = Omit<ComponentProps<'div'>, 'role'> & {
  icon?: IconProps['icon'];
};

/**
 * Explains an action that is not available, in place of its entry, e.g. "Read into the form: not
 * enabled for your Commission". A disabled menu item, so screen readers reach it with the arrows
 * and hear it as unavailable.
 */
export function MenuNote({ icon, className, children, ...props }: MenuNoteProps) {
  return (
    <div
      role="menuitem"
      tabIndex={-1}
      aria-disabled="true"
      className={cn(
        'flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-[13px] leading-snug text-muted-foreground outline-none focus:bg-muted',
        className,
      )}
      {...props}
    >
      {icon ? <Icon icon={icon} className="mt-px size-[15px]" /> : null}
      <span>{children}</span>
    </div>
  );
}
