import { Slot } from '@radix-ui/react-slot';
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

const tabRow =
  'flex gap-0.5 overflow-x-auto border-b [scrollbar-width:none] [&::-webkit-scrollbar]:hidden';
const tab = cn(
  // Inset, so the ring is not clipped by the scrolling tab row.
  focusRingInset,
  '-mb-px inline-flex h-10 shrink-0 items-center gap-2 rounded-t-md border-b-2 border-transparent px-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground',
);

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
      className={cn(tabRow, className)}
      style={{ ...scrollEdgeFade(edges), ...style }}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        tab,
        'disabled:pointer-events-none disabled:opacity-50 data-[state=active]:border-foreground data-[state=active]:text-foreground',
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

/**
 * Links between pages that look like tabs (Tabs are for panels on one page): a `nav` with its
 * row of `TabsLink`s. Name it with `aria-label`.
 */
export function TabsNav({ className, children, ...props }: ComponentProps<'nav'>) {
  return (
    <nav className={className} {...props}>
      <ul className={tabRow}>{children}</ul>
    </nav>
  );
}

/**
 * One page in a `TabsNav`, underlined when `current` (and marked `aria-current="page"`). Pass the
 * app's router link as the child with `asChild`.
 */
export function TabsLink({
  asChild = false,
  current = false,
  className,
  ...props
}: ComponentProps<'a'> & { asChild?: boolean; current?: boolean }) {
  const Component = asChild ? Slot : 'a';
  return (
    <li>
      <Component
        aria-current={current ? 'page' : undefined}
        className={cn(
          tab,
          'aria-[current=page]:border-foreground aria-[current=page]:text-foreground',
          className,
        )}
        {...props}
      />
    </li>
  );
}
