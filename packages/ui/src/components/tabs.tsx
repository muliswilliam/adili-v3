import * as TabsPrimitive from '@radix-ui/react-tabs';
import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';
import { focusRing } from '../lib/focus';

/**
 * Tabs switch between panels on one page. Arrow keys move between tabs and Tab moves into the
 * panel. For navigation between pages use links, not Tabs.
 */
export const Tabs = TabsPrimitive.Root;

/** An underlined row of tabs that scrolls sideways when it does not fit. */
export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        'flex gap-0.5 overflow-x-auto border-b [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        focusRing,
        // Inset, so the ring is not clipped by the scrolling tab list.
        '-mb-px inline-flex h-10 shrink-0 items-center gap-2 rounded-t-md border-b-2 border-transparent px-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground focus-visible:-outline-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:border-foreground data-[state=active]:text-foreground',
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
