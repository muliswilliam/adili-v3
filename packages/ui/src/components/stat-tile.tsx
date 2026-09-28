import type { ReactNode } from 'react';

import { cn } from '../lib/cn';

const NUMBER = new Intl.NumberFormat('en');

export interface StatTileBreakdownItem {
  label: string;
  value: number;
}

export type StatTileTone = 'default' | 'warning';

export interface StatTileProps {
  label: string;
  value: number;
  /** Parts of the value, e.g. per declaration type. Listed on the tile and in its title. */
  breakdown?: readonly StatTileBreakdownItem[];
  /** Names the breakdown list for screen readers; defaults to "{label} by type". */
  breakdownLabel?: string;
  /** A short line under the value. */
  description?: ReactNode;
  /** `warning` tints the tile and its value amber, for a count that needs action. */
  tone?: StatTileTone;
  /** A small decorative dot or icon before the label. */
  marker?: ReactNode;
  /** With `onPressedChange`, the tile is a toggle (e.g. filtering a list by its status). */
  pressed?: boolean;
  onPressedChange?: (pressed: boolean) => void;
  className?: string;
}

/**
 * A summary count on a card: label, a large tabular value and an optional breakdown. The
 * breakdown is always listed on the tile (a named list, so nothing depends on hover) and also
 * sits in the hover title. With `onPressedChange` the label and value are a toggle button whose
 * hit area covers the whole tile; the breakdown stays outside it so it reads as a list.
 */
export function StatTile({
  label,
  value,
  breakdown,
  breakdownLabel,
  description,
  tone = 'default',
  marker,
  pressed = false,
  onPressedChange,
  className,
}: StatTileProps) {
  const title = breakdown?.length
    ? `${label}: ${breakdown.map((item) => `${item.label} ${NUMBER.format(item.value)}`).join(', ')}`
    : undefined;
  const heading = (
    <>
      <span className="flex items-center gap-[7px] text-[13px] font-medium text-muted-foreground [&_svg]:size-[15px]">
        {marker}
        {label}
      </span>{' '}
      <span
        className={cn(
          'block text-[28px] leading-[1.15] font-semibold tracking-[-0.02em] tabular-nums',
          tone === 'warning' && 'text-warning-subtle-foreground',
        )}
      >
        {NUMBER.format(value)}
      </span>
    </>
  );

  return (
    <div
      title={title}
      data-tone={tone}
      className={cn(
        'relative flex flex-col gap-1 rounded-2xl bg-card p-4 text-card-foreground shadow-card',
        tone === 'warning' && 'bg-linear-to-b from-warning-subtle/70 to-card',
        onPressedChange && 'transition-shadow hover:shadow-control-hover',
        onPressedChange && pressed && 'shadow-control-selected hover:shadow-control-selected',
        className,
      )}
    >
      {onPressedChange ? (
        <button
          type="button"
          aria-pressed={pressed}
          onClick={() => {
            onPressedChange(!pressed);
          }}
          className="flex cursor-pointer flex-col gap-1 text-left outline-none after:absolute after:inset-0 after:rounded-2xl focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-ring"
        >
          {heading}
        </button>
      ) : (
        <div className="flex flex-col gap-1">{heading}</div>
      )}
      {description ? <p className="text-[12.5px] text-muted-foreground">{description}</p> : null}
      {breakdown?.length ? (
        <ul
          aria-label={breakdownLabel ?? `${label} by type`}
          className="mt-1.5 grid gap-0.5 border-t pt-2 text-[12.5px] text-muted-foreground"
        >
          {breakdown.map((item) => (
            <li key={item.label} className="flex justify-between gap-2">
              <span>{item.label}</span>
              <span className="font-semibold text-secondary-foreground tabular-nums">
                {NUMBER.format(item.value)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
