import { Cancel01Icon } from '@hugeicons/core-free-icons';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { type ComponentProps, createContext, useContext } from 'react';

import { cn } from '../lib/cn';
import { focusRing } from '../lib/focus';
import { Icon } from './icon';
import { isInToastViewport } from './toast';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;

const DialogBusyContext = createContext(false);

/** Set on the built-in close button (as data-dialog-dismiss) so initial focus can skip it. */
const DISMISS_ATTRIBUTE = 'data-dialog-dismiss';
const FOCUSABLE = 'a[href], button, input:not([type="hidden"]), select, textarea, [tabindex]';

/**
 * Whether an element can take initial focus: it is not the built-in close button, not disabled,
 * not taken out of the tab order, not inside a hidden or inert subtree and not hidden by CSS. Walks up the tree with
 * getComputedStyle rather than using getClientRects, which is empty for everything in jsdom.
 */
function isInitialFocusTarget(element: HTMLElement, container: HTMLElement): boolean {
  if (element.tabIndex < 0 || element.matches(':disabled')) return false;
  if (element.hasAttribute(DISMISS_ATTRIBUTE)) return false;
  if (element.closest('[hidden], [inert]')) return false;
  const view = element.ownerDocument.defaultView;
  if (!view) return false;
  if (view.getComputedStyle(element).visibility === 'hidden') return false;
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    if (view.getComputedStyle(node).display === 'none') return false;
    if (node === container) break;
  }
  return true;
}

/** Closes the dialog. Disabled, and does nothing, while the DialogContent is busy. */
export function DialogClose({
  disabled,
  onClick,
  ...props
}: ComponentProps<typeof DialogPrimitive.Close>) {
  const busy = useContext(DialogBusyContext);
  return (
    <DialogPrimitive.Close
      {...props}
      disabled={busy || disabled}
      onClick={(event) => {
        onClick?.(event);
        if (busy) event.preventDefault();
      }}
    />
  );
}

export type DialogContentProps = ComponentProps<typeof DialogPrimitive.Content> & {
  /**
   * Set while a submit is in flight. Esc and outside clicks are ignored and every DialogClose
   * (including the built-in close button) is disabled, so the dialog cannot disappear under a
   * pending request. A controlled `open` can still be set to false by the caller.
   */
  busy?: boolean;
};

/**
 * Modal content: a bottom sheet on phones, a centred 560px panel from `sm`. Compose it from
 * DialogHeader, DialogBody (which scrolls) and DialogFooter. On open, focus moves to the first
 * visible, enabled focusable element in DOM order other than the close button: usually the first
 * field, or the first footer button when nothing before it can take focus. It goes to the close
 * button only when nothing else can. Focus is trapped while open and returns to the trigger on
 * close. Always render a DialogTitle; pass `aria-describedby={undefined}` if there is no
 * DialogDescription.
 */
export function DialogContent({
  busy = false,
  className,
  children,
  onEscapeKeyDown,
  onInteractOutside,
  onOpenAutoFocus,
  ...props
}: DialogContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-scrim" />
      <DialogPrimitive.Content
        aria-busy={busy || undefined}
        onOpenAutoFocus={(event) => {
          onOpenAutoFocus?.(event);
          if (event.defaultPrevented || !(event.target instanceof HTMLElement)) return;
          // The close button comes first in the DOM so it is first in focus order; start on
          // the content instead, as Radix would if the button were last. If nothing else can
          // take focus, Radix's default (the close button) runs.
          const container = event.target;
          const first = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).find(
            (element) => isInitialFocusTarget(element, container),
          );
          if (!first) return;
          first.focus();
          if (container.ownerDocument.activeElement === first) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
          onEscapeKeyDown?.(event);
        }}
        onInteractOutside={(event) => {
          // Toasts sit above the dialog; dismissing one should not close it.
          if (busy || isInToastViewport(event.target)) event.preventDefault();
          onInteractOutside?.(event);
        }}
        className={cn(
          'fixed inset-x-0 bottom-0 z-50 flex max-h-[94dvh] flex-col overflow-hidden rounded-t-[22px] bg-card text-card-foreground shadow-pop outline-none sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:max-h-[calc(100dvh-3rem)] sm:w-[calc(100%-3rem)] sm:max-w-[560px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[20px]',
          className,
        )}
        {...props}
      >
        <DialogBusyContext value={busy}>
          <div
            aria-hidden="true"
            className="mx-auto mt-2 h-[5px] w-10 shrink-0 rounded-full bg-input sm:hidden"
          />
          {/* Before the content in the DOM, so focus order matches its top-right position. */}
          <DialogClose
            {...{ [DISMISS_ATTRIBUTE]: '' }}
            className={cn(
              focusRing,
              'absolute top-[33px] right-5 flex size-9 items-center justify-center rounded-md text-secondary-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50 sm:top-6 sm:right-6',
            )}
          >
            <Icon icon={Cancel01Icon} className="size-[18px]" />
            <span className="sr-only">Close</span>
          </DialogClose>
          {children}
        </DialogBusyContext>
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
