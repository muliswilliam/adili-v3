import { Tick02Icon } from '@hugeicons/core-free-icons';
import * as MenuPrimitive from '@radix-ui/react-dropdown-menu';
import { type ComponentProps, createContext, useContext, useMemo, useRef } from 'react';

import { cn } from '../lib/cn';
import { Icon, type IconProps } from './icon';

/** Holds the picked item's action until the menu has closed and focus is back on the trigger. */
interface PendingAction {
  hold: (action: () => void) => void;
  /** The held action, once; null when nothing was picked. */
  take: () => (() => void) | null;
}

const PendingContext = createContext<PendingAction | null>(null);

/**
 * A menu of actions opened from a button (the kit's `.menu`). Arrow keys, Home and End move
 * between items, Enter or Space picks one, Esc closes and returns focus to the trigger. Picking an
 * item closes the menu and returns focus to the trigger before its `onSelect` runs, so a dialog it
 * opens returns focus there too.
 *
 * @example
 * <Menu>
 *   <MenuTrigger asChild><Button variant="secondary">Download template</Button></MenuTrigger>
 *   <MenuContent>
 *     <MenuItem onSelect={() => download('csv')}>CSV template (.csv)</MenuItem>
 *   </MenuContent>
 * </Menu>
 */
export function Menu(props: ComponentProps<typeof MenuPrimitive.Root>) {
  const held = useRef<(() => void) | null>(null);
  const pending = useMemo<PendingAction>(
    () => ({
      hold: (action) => {
        held.current = action;
      },
      take: () => {
        const action = held.current;
        held.current = null;
        return action;
      },
    }),
    [],
  );
  return (
    <PendingContext value={pending}>
      <MenuPrimitive.Root {...props} />
    </PendingContext>
  );
}

export const MenuTrigger = MenuPrimitive.Trigger;

export function MenuContent({
  className,
  align = 'end',
  sideOffset = 6,
  onCloseAutoFocus,
  ...props
}: ComponentProps<typeof MenuPrimitive.Content>) {
  const pending = useContext(PendingContext);
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event);
          const run = pending?.take();
          // Radix focuses the trigger after this handler; run the action once it has.
          if (run) queueMicrotask(run);
        }}
        className={cn(
          'z-50 flex max-w-[300px] min-w-[200px] flex-col rounded-xl bg-card p-1.5 text-card-foreground shadow-pop',
          className,
        )}
        {...props}
      />
    </MenuPrimitive.Portal>
  );
}

export type MenuItemProps = Omit<ComponentProps<typeof MenuPrimitive.Item>, 'onSelect'> & {
  /** Runs after the menu has closed and focus is back on its trigger. */
  onSelect?: () => void;
  icon?: IconProps['icon'];
  /** `destructive` for removals. `ai` tints the icon for AI-assisted actions. */
  tone?: 'default' | 'destructive' | 'ai';
};

/** One action in a Menu. A disabled item is skipped by the arrows and does nothing. */
export function MenuItem({
  className,
  onSelect,
  icon,
  tone = 'default',
  children,
  ...props
}: MenuItemProps) {
  const pending = useContext(PendingContext);
  return (
    <MenuPrimitive.Item
      className={cn(
        'flex min-h-9 cursor-default items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-muted [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground',
        tone === 'destructive' && 'text-destructive [&_svg]:text-destructive',
        tone === 'ai' && '[&_svg]:text-ai',
        className,
      )}
      onSelect={() => {
        if (!onSelect) return;
        if (pending) pending.hold(onSelect);
        else onSelect();
      }}
      {...props}
    >
      {icon ? <Icon icon={icon} /> : null}
      {children}
    </MenuPrimitive.Item>
  );
}

export type MenuNoteProps = Omit<
  ComponentProps<typeof MenuPrimitive.Item>,
  'onSelect' | 'disabled'
> & {
  icon?: IconProps['icon'];
};

/**
 * Explains an action that is not available, in place of its item, e.g. "Read into the form: not
 * enabled for your Commission". Reachable with the arrows and heard as unavailable; picking it
 * does nothing and leaves the menu open.
 */
export function MenuNote({ icon, className, children, ...props }: MenuNoteProps) {
  return (
    <MenuPrimitive.Item
      aria-disabled="true"
      onSelect={(event) => {
        event.preventDefault();
      }}
      className={cn(
        'flex w-full cursor-default items-start gap-2.5 rounded-md px-2.5 py-2 text-[13px] leading-snug text-muted-foreground outline-none select-none data-highlighted:bg-muted [&_svg]:mt-px [&_svg]:size-[15px] [&_svg]:shrink-0',
        className,
      )}
      {...props}
    >
      {icon ? <Icon icon={icon} /> : null}
      <span>{children}</span>
    </MenuPrimitive.Item>
  );
}

export const MenuRadioGroup = MenuPrimitive.RadioGroup;

/**
 * One choice in a `MenuRadioGroup`, heard as a radio item, with a tick on the chosen one. Picking
 * it sets the group's value and closes the menu.
 */
export function MenuRadioItem({
  className,
  icon,
  children,
  ...props
}: ComponentProps<typeof MenuPrimitive.RadioItem> & { icon?: IconProps['icon'] }) {
  return (
    <MenuPrimitive.RadioItem
      className={cn(
        'flex min-h-9 cursor-default items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm outline-none select-none data-highlighted:bg-muted [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground',
        className,
      )}
      {...props}
    >
      {icon ? <Icon icon={icon} /> : null}
      <span className="flex-1">{children}</span>
      <MenuPrimitive.ItemIndicator>
        <Icon icon={Tick02Icon} className="text-brand!" />
      </MenuPrimitive.ItemIndicator>
    </MenuPrimitive.RadioItem>
  );
}
