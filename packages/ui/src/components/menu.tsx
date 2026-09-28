import * as MenuPrimitive from '@radix-ui/react-dropdown-menu';
import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';

/**
 * A menu of actions opened from a button (the kit's `.menu`). Arrow keys move between items,
 * Enter or Space picks one, Esc closes and returns focus to the trigger.
 *
 * @example
 * <Menu>
 *   <MenuTrigger asChild><Button variant="secondary">Download template</Button></MenuTrigger>
 *   <MenuContent>
 *     <MenuItem onSelect={() => download('csv')}>CSV template (.csv)</MenuItem>
 *   </MenuContent>
 * </Menu>
 */
export const Menu = MenuPrimitive.Root;

export const MenuTrigger = MenuPrimitive.Trigger;

export function MenuContent({
  className,
  align = 'end',
  sideOffset = 6,
  ...props
}: ComponentProps<typeof MenuPrimitive.Content>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'z-50 flex min-w-[200px] flex-col rounded-xl bg-card p-1.5 text-card-foreground shadow-pop',
          className,
        )}
        {...props}
      />
    </MenuPrimitive.Portal>
  );
}

export function MenuItem({ className, ...props }: ComponentProps<typeof MenuPrimitive.Item>) {
  return (
    <MenuPrimitive.Item
      className={cn(
        'flex h-9 cursor-default items-center gap-2.5 rounded-md px-2.5 text-sm whitespace-nowrap outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-muted [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}
