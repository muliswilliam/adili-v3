import { Cancel01Icon } from '@hugeicons/core-free-icons';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';
import { Icon } from './icon';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export type DialogContentProps = ComponentProps<typeof DialogPrimitive.Content> & {
  /**
   * Set while a submit is in flight. Esc, outside clicks and the close button are ignored so
   * the dialog cannot disappear under a pending request.
   */
  busy?: boolean;
};

/**
 * Modal content: a bottom sheet on phones, a centred 560px panel from `sm`. Compose it from
 * DialogHeader, DialogBody (which scrolls) and DialogFooter. Focus moves in on open, is trapped
 * while open and returns to the trigger on close. Always render a DialogTitle; pass
 * `aria-describedby={undefined}` if there is no DialogDescription.
 */
export function DialogContent({
  busy = false,
  className,
  children,
  onEscapeKeyDown,
  onInteractOutside,
  ...props
}: DialogContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-scrim" />
      <DialogPrimitive.Content
        aria-busy={busy || undefined}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
          onEscapeKeyDown?.(event);
        }}
        onInteractOutside={(event) => {
          if (busy) event.preventDefault();
          onInteractOutside?.(event);
        }}
        className={cn(
          'fixed inset-x-0 bottom-0 z-50 flex max-h-[94dvh] flex-col overflow-hidden rounded-t-[22px] bg-card text-card-foreground shadow-pop outline-none sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:max-h-[calc(100dvh-3rem)] sm:w-[calc(100%-3rem)] sm:max-w-[560px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[20px]',
          className,
        )}
        {...props}
      >
        <div
          aria-hidden="true"
          className="mx-auto mt-2 h-[5px] w-10 shrink-0 rounded-full bg-input sm:hidden"
        />
        {children}
        <DialogPrimitive.Close
          disabled={busy}
          className="absolute top-[33px] right-5 flex size-9 items-center justify-center rounded-md text-secondary-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 sm:top-6 sm:right-6"
        >
          <Icon icon={Cancel01Icon} className="size-[18px]" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex shrink-0 flex-col gap-[3px] px-5 pt-5 pr-16 pb-3 sm:px-6 sm:pt-6 sm:pr-[72px]',
        className,
      )}
      {...props}
    />
  );
}

/** The dialog's content, with fields 18px apart. Scrolls when the dialog is taller than the screen. */
export function DialogBody({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto px-5 pt-2 pb-5 sm:px-6 sm:pb-6',
        className,
      )}
      {...props}
    />
  );
}

/** Actions under a hairline: equal width on phones, right-aligned from `sm`. Put the main action last. */
export function DialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex shrink-0 gap-2.5 border-t px-5 pt-3.5 pb-5 *:flex-1 sm:justify-end sm:px-6 sm:pt-4 sm:pb-6 sm:*:flex-none',
        className,
      )}
      {...props}
    />
  );
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn('text-[19px] leading-7 font-semibold tracking-[-0.015em]', className)}
      {...props}
    />
  );
}

export function DialogDescription({
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
