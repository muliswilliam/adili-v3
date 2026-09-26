import * as DialogPrimitive from '@radix-ui/react-dialog';
import { type ComponentProps, createContext, useContext } from 'react';

import { CloseIcon } from '../lib/close-icon';
import { cn } from '../lib/cn';

const DialogBusyContext = createContext(false);

/**
 * Modal dialog. While open, focus moves into the dialog and Tab is trapped inside it; on close,
 * focus returns to the element that opened it (the `DialogTrigger`, or whatever had focus).
 */
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;

export type DialogContentProps = ComponentProps<typeof DialogPrimitive.Content> & {
  /**
   * Set while a submission is in flight. Esc, clicks outside and every `DialogClose` are ignored,
   * so the dialog cannot be dismissed half-way through the action.
   */
  busy?: boolean;
  /** Hide the corner close button, e.g. when the footer already has a Cancel `DialogClose`. */
  hideCloseButton?: boolean;
};

export function DialogContent({
  busy = false,
  hideCloseButton = false,
  onEscapeKeyDown,
  onInteractOutside,
  className,
  children,
  ...props
}: DialogContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/45" />
      <DialogPrimitive.Content
        aria-busy={busy || undefined}
        onEscapeKeyDown={(event) => {
          onEscapeKeyDown?.(event);
          if (busy) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          onInteractOutside?.(event);
          if (busy) event.preventDefault();
        }}
        className={cn(
          'fixed top-1/2 left-1/2 z-50 grid max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-5 overflow-y-auto rounded-xl border bg-card p-6 text-card-foreground shadow-lg outline-none',
          className,
        )}
        {...props}
      >
        <DialogBusyContext.Provider value={busy}>
          {children}
          {hideCloseButton ? null : (
            <DialogClose
              aria-label="Close"
              className="absolute top-4 right-4 inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
            >
              <CloseIcon />
            </DialogClose>
          )}
        </DialogBusyContext.Provider>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/** Closes the dialog. Disabled automatically while the dialog is busy. */
export function DialogClose({ disabled, ...props }: ComponentProps<typeof DialogPrimitive.Close>) {
  const busy = useContext(DialogBusyContext);
  return <DialogPrimitive.Close disabled={(disabled ?? false) || busy} {...props} />;
}

export function DialogHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-1.5 pr-8', className)} {...props} />;
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn('text-lg leading-7 font-semibold tracking-tight', className)}
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

export function DialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  );
}
