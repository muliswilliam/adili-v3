import * as TabsPrimitive from '@radix-ui/react-tabs';
import { type ComponentProps, useCallback } from 'react';

import { cn } from '../lib/cn';
import { focusRing, focusRingInset } from '../lib/focus';
import { scrollEdgeFade, useScrollEdges } from '../lib/use-scroll-edges';

/**
 * Tabs switch between panels on one page. Arrow keys move between tabs and Tab moves into the
 * panel. For navigation between pages use links, not Tabs.
 */
export const Tabs = TabsPrimitive.Root;

/**
 * An underlined row of tabs that scrolls sideways when it does not fit, fading out at an edge
 * with more tabs past it (the scrollbar is hidden, so the fade is what says there are more).
 */
export function TabsList({
  className,
  style,
  ref,
  ...props
}: ComponentProps<typeof TabsPrimitive.List>) {
  const [measure, edges] = useScrollEdges<HTMLDivElement>();
  const attach = useCallback(
    (element: HTMLDivElement | null) => {
      const cleanup = measure(element);
      if (typeof ref === 'function') ref(element);
      else if (ref) ref.current = element;
      return () => {
        cleanup?.();
        if (typeof ref === 'function') ref(null);
        else if (ref) ref.current = null;
      };
    },
    [measure, ref],
  );
  return (
    <TabsPrimitive.List
      ref={attach}
      data-more-before={edges.start || undefined}
      data-more-after={edges.end || undefined}
      className={cn(
        'flex gap-0.5 overflow-x-auto border-b [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
      style={{ ...scrollEdgeFade(edges), ...style }}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        // Inset, so the ring is not clipped by the scrolling tab list.
        focusRingInset,
        '-mb-px inline-flex h-10 shrink-0 items-center gap-2 rounded-t-md border-b-2 border-transparent px-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50 data-[state=active]:border-foreground data-[state=active]:text-foreground',
        className,
      )}
      {...props}
    />
  );
}

/** A count after a tab's label, e.g. `<TabsTrigger>Exited <TabsCount>3</TabsCount></TabsTrigger>`. */
export function TabsCount({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      className={cn(
        'grid h-[18px] min-w-[18px] place-items-center rounded-full bg-muted px-[5px] text-xs text-secondary-foreground tabular-nums',
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content className={cn(focusRing, 'mt-4 rounded-lg', className)} {...props} />
  );
}
