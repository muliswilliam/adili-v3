import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { type ComponentProps, createContext, type ReactNode, useContext } from 'react';

import { cn } from '../lib/cn';

const HasProvider = createContext(false);

/**
 * Optional. Mount near the app root so tooltips share one open delay and skip the delay when
 * moving between triggers. Without it each Tooltip mounts its own provider with the defaults.
 */
export function TooltipProvider(props: ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <HasProvider value={true}>
      <TooltipPrimitive.Provider {...props} />
    </HasProvider>
  );
}

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
 * by the tooltip text while it is open. Works on its own; inside a TooltipProvider it uses
 * that provider's delays.
 */
export function Tooltip({ content, children, side = 'top', className, ...props }: TooltipProps) {
  const hasProvider = useContext(HasProvider);
  const root = (
    <TooltipPrimitive.Root {...props}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={8}
          className={cn(
            'z-50 max-w-[280px] rounded-md bg-primary px-2.5 py-2 text-[12.5px] leading-[1.45] font-medium text-primary-foreground shadow-pop',
            className,
          )}
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
  // Radix throws when Root has no provider above it.
  return hasProvider ? root : <TooltipPrimitive.Provider>{root}</TooltipPrimitive.Provider>;
}
