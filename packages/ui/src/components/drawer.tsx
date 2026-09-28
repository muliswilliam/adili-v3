import { Cancel01Icon } from '@hugeicons/core-free-icons';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cva, type VariantProps } from 'class-variance-authority';
import { type ComponentProps, useRef } from 'react';

import { cn } from '../lib/cn';
import { Icon } from './icon';
import { isInToastViewport } from './toast';

export const Drawer = DialogPrimitive.Root;
export const DrawerTrigger = DialogPrimitive.Trigger;
export const DrawerClose = DialogPrimitive.Close;

export const drawerVariants = cva(
  'fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-card text-card-foreground shadow-pop outline-none motion-safe:animate-drawer-in',
  {
    variants: {
      size: {
        default: 'max-w-[520px]',
        /** For tables, such as a reminder history. */
        wide: 'max-w-[720px]',
      },
    },
    defaultVariants: { size: 'default' },
  },
);

export type DrawerContentProps = ComponentProps<typeof DialogPrimitive.Content> &
  VariantProps<typeof drawerVariants>;

/**
 * A modal panel from the right edge, full height and full width on phones, for the detail of a
 * row. Compose it from DrawerHeader (with DrawerTitle and an optional DrawerDescription),
 * DrawerBody (which scrolls) and an optional DrawerFooter. Focus moves to the close button on
 * open, is trapped while open and returns on close to whatever opened it, a DrawerTrigger or,
 * for a controlled drawer, the row link or button that had focus. Esc and a click outside
 * close it. Always render a DrawerTitle; pass `aria-describedby={undefined}` if there is no
 * DrawerDescription.
 */
export function DrawerContent({
  size,
  className,
  children,
  onOpenAutoFocus,
  onCloseAutoFocus,
  onInteractOutside,
  ...props
}: DrawerContentProps) {
  // Radix returns focus to a DrawerTrigger only; remember the opener for controlled drawers.
  const opener = useRef<HTMLElement | null>(null);
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-scrim" />
      <DialogPrimitive.Content
        onOpenAutoFocus={(event) => {
          // Runs before focus moves in, so the active element is still the opener.
          opener.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
          onOpenAutoFocus?.(event);
        }}
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event);
          if (event.defaultPrevented) return;
          const target = opener.current;
          if (target?.isConnected) {
            event.preventDefault();
            target.focus();
          }
        }}
        onInteractOutside={(event) => {
          // Toasts sit above the drawer; dismissing one should not close it.
          if (isInToastViewport(event.target)) event.preventDefault();
          onInteractOutside?.(event);
        }}
        className={cn(drawerVariants({ size }), className)}
        {...props}
      >
        {/* Before the content in the DOM: the first control, so it takes focus on open. */}
        <DialogPrimitive.Close className="absolute top-4 right-4 flex size-9 items-center justify-center rounded-md text-secondary-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          <Icon icon={Cancel01Icon} className="size-[18px]" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/** Title and description under a hairline, clear of the close button. */
export function DrawerHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex shrink-0 flex-col gap-[3px] border-b px-5 pt-5 pr-16 pb-3.5', className)}
      {...props}
    />
  );
}

/** The drawer's content, sections 18px apart. Scrolls when taller than the screen. */
export function DrawerBody({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto p-5', className)}
      {...props}
    />
  );
}

/** Actions under a hairline, right-aligned. Put the main action last. */
export function DrawerFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex shrink-0 justify-end gap-2.5 border-t px-5 py-3.5', className)}
      {...props}
    />
  );
}

export function DrawerTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn('text-lg leading-7 font-semibold tracking-[-0.015em]', className)}
      {...props}
    />
  );
}

export function DrawerDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}
