import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';

/**
 * Mount once near the root; tooltips share its open delay. The trigger must be focusable (a
 * button, link, or an element with `tabIndex={0}`) so keyboard users can open it too.
 * Tooltips add detail; never put information in them that the page needs to be understood.
 */
export function TooltipProvider({
  delayDuration = 200,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider delayDuration={delayDuration} {...props} />;
}

export const Tooltip = TooltipPrimitive.Root;

export const TooltipTrigger = TooltipPrimitive.Trigger;

export function TooltipContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          'z-50 max-w-xs rounded-md bg-foreground px-3 py-2 text-xs leading-5 text-background shadow-md',
          className,
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="fill-foreground" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}
