import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import type { ComponentProps, ReactNode } from 'react';

import { cn } from '../lib/cn';

/** Mount once near the app root so tooltips share one open delay. */
export const TooltipProvider = TooltipPrimitive.Provider;

export type TooltipProps = Omit<ComponentProps<typeof TooltipPrimitive.Root>, 'children'> & {
  /** Supplementary text. Never put information here that the user needs to complete a task. */
  content: ReactNode;
  /**
   * One focusable element. A disabled button cannot take focus or hover, so wrap it in a
   * `<span tabIndex={0}>` to explain why it is disabled.
   */
  children: ReactNode;
  side?: ComponentProps<typeof TooltipPrimitive.Content>['side'];
  className?: string;
};

/**
 * Shows short text on hover and keyboard focus, dismissed with Esc. The trigger is described
 * by the tooltip text while it is open.
 */
export function Tooltip({ content, children, side = 'top', className, ...props }: TooltipProps) {
  return (
    <TooltipPrimitive.Root {...props}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className={cn(
            'z-50 max-w-xs rounded-md bg-primary px-2.5 py-1.5 text-[13px] leading-5 text-primary-foreground shadow-md',
            className,
          )}
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
