import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';
import { focusRing } from '../lib/focus';
import { Badge } from './badge';
import { Tooltip } from './tooltip';

/** A review case's priority band (review.yaml `PriorityBand`). */
export const PRIORITY_BANDS = ['low', 'medium', 'high'] as const;

export type PriorityBand = (typeof PRIORITY_BANDS)[number];

export interface PriorityBadgeMessages {
  /** The badge's text per band. */
  bands: Record<PriorityBand, string>;
  /** `High` → "High priority", the start of the accessible name. */
  label: (band: string) => string;
  /** What the band is for, in the tooltip and the accessible name. */
  note: string;
}

/** What the priority indicator is, as the queue's column header and the flags banner say it. */
export const PRIORITY_NOTE = 'Indicator for ordering only. Not a finding.';

const DEFAULT_MESSAGES: PriorityBadgeMessages = {
  bands: { low: 'Low', medium: 'Medium', high: 'High' },
  label: (band) => `${band} priority`,
  note: PRIORITY_NOTE,
};

const LOOK: Record<PriorityBand, { tone: 'default' | 'warning' | 'destructive'; bars: number }> = {
  low: { tone: 'default', bars: 1 },
  medium: { tone: 'warning', bars: 2 },
  high: { tone: 'destructive', bars: 3 },
};

/** Three rising bars, the first `lit` solid and the rest faint. */
function Bars({ lit }: { lit: number }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="shrink-0">
      <rect x="0.5" y="7" width="3" height="4.5" rx="1" fill="currentColor" />
      <rect
        x="4.5"
        y="4"
        width="3"
        height="7.5"
        rx="1"
        fill="currentColor"
        opacity={lit < 2 ? 0.25 : 1}
      />
      <rect
        x="8.5"
        y="0.5"
        width="3"
        height="11"
        rx="1"
        fill="currentColor"
        opacity={lit < 3 ? 0.25 : 1}
      />
    </svg>
  );
}

export type PriorityBadgeProps = Omit<ComponentProps<'span'>, 'children'> & {
  band: PriorityBand;
  /**
   * Shows the note in a tooltip on hover and focus, which makes the badge a tab stop. Turn it off
   * where the note is already on screen (a column header's tooltip, the flags banner); the
   * accessible name keeps the note either way.
   */
  tooltip?: boolean;
  messages?: Partial<PriorityBadgeMessages>;
};

/**
 * A review case's priority: rising bars and the band in text ("High"), never colour alone; high is
 * red, medium amber, low grey. Its accessible name, "High priority. Indicator for ordering only.
 * Not a finding.", carries the same note as its tooltip. Needs no TooltipProvider, but shares one
 * when mounted.
 */
export function PriorityBadge({
  band,
  tooltip = true,
  messages,
  className,
  ...props
}: PriorityBadgeProps) {
  const copy = { ...DEFAULT_MESSAGES, ...messages };
  const look = LOOK[band];
  const text = copy.bands[band];

  const badge = (
    <Badge
      variant={look.tone}
      role="img"
      tabIndex={tooltip ? 0 : undefined}
      aria-label={`${copy.label(text)}. ${copy.note}`}
      data-band={band}
      className={cn(
        'gap-1.5 pr-[9px] pl-[7px] font-semibold',
        tooltip && cn(focusRing, 'cursor-help'),
        className,
      )}
      {...props}
    >
      <Bars lit={look.bars} />
      {text}
    </Badge>
  );

  return tooltip ? <Tooltip content={copy.note}>{badge}</Tooltip> : badge;
}
