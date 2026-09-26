import * as TabsPrimitive from '@radix-ui/react-tabs';
import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';

/**
 * Tabs switch between panels on one page. Arrow keys move between tabs and Tab moves into the
 * panel. For navigation between pages use links, not Tabs.
 */
export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn('inline-flex items-center gap-1 border-b border-border', className)}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        '-mb-px inline-flex h-9 items-center gap-2 rounded-t-lg border-b-2 border-transparent px-3 text-sm whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:pointer-events-none disabled:opacity-60 data-[state=active]:border-primary data-[state=active]:font-medium data-[state=active]:text-foreground',
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn(
        'mt-4 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        className,
      )}
      {...props}
    />
  );
}
