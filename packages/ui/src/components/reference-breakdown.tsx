import * as PopoverPrimitive from '@radix-ui/react-popover';
import type { ReactElement, ReactNode } from 'react';

import type { ReferencePart } from './reference-chip';

export interface ReferenceBreakdownProps {
  /** Renders the chip with the given explain button in it; the popover lines up with it. */
  chip: (explain: ReactNode) => ReactElement;
  /** The explain button, which toggles the popover. */
  trigger: ReactElement;
  segments: readonly string[];
  parts: readonly ReferencePart[];
  heading: string;
}

/**
 * The popover of a `ReferenceChip`: what each part of the reference means. Loaded on demand
 * by the chip, and mounted open, since it mounts when the explain button is pressed.
 */
export default function ReferenceBreakdown({
  chip,
  trigger,
  segments,
  parts,
  heading,
}: ReferenceBreakdownProps) {
  return (
    <PopoverPrimitive.Root defaultOpen>
      {/* The breakdown lines up with the chip, not with its button. */}
      <PopoverPrimitive.Anchor asChild>
        {chip(
          <>
            <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
            <PopoverPrimitive.Portal>
              <PopoverPrimitive.Content
                align="start"
                sideOffset={8}
                collisionPadding={8}
                aria-label={heading}
                className="z-50 w-[320px] max-w-[calc(100vw-16px)] rounded-xl bg-card p-3.5 text-card-foreground shadow-pop outline-none"
              >
                <p className="mb-2 text-[11.5px] font-semibold tracking-[0.05em] text-muted-foreground uppercase">
                  {heading}
                </p>
                <dl className="grid grid-cols-[auto_auto_1fr] gap-x-3 text-[13px]">
                  {parts.map((part, index) => (
                    <div
                      // Parts are positional; a label or value may repeat.
                      key={index}
                      className="col-span-3 grid grid-cols-subgrid border-b border-border py-1.5 last:border-b-0"
                    >
                      <dt className="contents">
                        <span className="font-mono font-semibold whitespace-nowrap">
                          {segments[index]}
                        </span>
                        <span className="whitespace-nowrap text-muted-foreground">
                          {part.label}
                        </span>
                      </dt>
                      <dd>{part.meaning}</dd>
                    </div>
                  ))}
                </dl>
              </PopoverPrimitive.Content>
            </PopoverPrimitive.Portal>
          </>,
        )}
      </PopoverPrimitive.Anchor>
    </PopoverPrimitive.Root>
  );
}
