import { cn } from '../lib/cn';
import { focusRing } from '../lib/focus';
import { Badge, type BadgeProps } from './badge';
import { Tooltip } from './tooltip';

/** A review case's priority band, from its indicator score (review.yaml `band`). */
export type Priority = 'low' | 'medium' | 'high';

export const PRIORITIES: readonly Priority[] = ['high', 'medium', 'low'];

export interface PriorityBadgeMessages {
  bands: Record<Priority, string>;
  /** The accessible name before the indicator note, e.g. "High priority". */
  label: (band: string) => string;
  /** What the priority means, in the tooltip and the accessible name. */
  indicator: string;
}

export const PRIORITY_BADGE_MESSAGES: PriorityBadgeMessages = {
  bands: { high: 'High', medium: 'Medium', low: 'Low' },
  label: (band) => `${band} priority`,
  indicator: 'Indicator for ordering only. Not a finding.',
};

const META: Record<Priority, { variant: NonNullable<BadgeProps['variant']>; bars: number }> = {
  high: { variant: 'destructive', bars: 3 },
  medium: { variant: 'warning', bars: 2 },
  low: { variant: 'default', bars: 1 },
};

/** Three rising bars, `lit` of them solid and the rest faint, like a signal meter. Decorative. */
export function SignalBars({ lit }: { lit: number }) {
  const bars = [
    { x: 0.5, y: 7, height: 4.5 },
    { x: 4.5, y: 4, height: 7.5 },
    { x: 8.5, y: 0.5, height: 11 },
  ];
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true">
      {bars.map((bar, index) => (
        <rect
          key={bar.x}
          {...bar}
          width={3}
          rx={1}
          fill="currentColor"
          opacity={index < lit ? 1 : 0.25}
        />
      ))}
    </svg>
  );
}

export type PriorityBadgeProps = Omit<BadgeProps, 'children' | 'variant'> & {
  priority: Priority;
  /**
   * Shows the indicator note on hover and keyboard focus (default). Turn it off where the note
   * is already on screen, e.g. in the flags banner; the accessible name still carries it.
   */
  tooltip?: boolean;
  /** Replaces any of the default words. */
  messages?: Partial<Omit<PriorityBadgeMessages, 'bands'>> & {
    bands?: Partial<PriorityBadgeMessages['bands']>;
  };
};

/**
 * A case's priority: bars plus the word, never colour alone. High is red with three bars,
 * medium amber with two, low grey with one. Its accessible name is "High priority. Indicator
 * for ordering only. Not a finding.", and the same note shows in a tooltip on hover or focus,
 * since a priority is not a finding.
 */
export function PriorityBadge({
  priority,
  tooltip = true,
  messages: overrides,
  className,
  ...props
}: PriorityBadgeProps) {
  const messages = {
    ...PRIORITY_BADGE_MESSAGES,
    ...overrides,
    bands: { ...PRIORITY_BADGE_MESSAGES.bands, ...overrides?.bands },
  };
  const { variant, bars } = META[priority];
  const word = messages.bands[priority];

  const badge = (
    <Badge
      variant={variant}
      role="img"
      tabIndex={tooltip ? 0 : undefined}
      aria-label={`${messages.label(word)}. ${messages.indicator}`}
      data-priority={priority}
      className={cn(
        'gap-1.5 pr-[9px] pl-[7px] font-semibold [&_svg]:size-3',
        tooltip && focusRing,
        className,
      )}
      {...props}
    >
      <SignalBars lit={bars} />
      {word}
    </Badge>
  );

  return tooltip ? <Tooltip content={messages.indicator}>{badge}</Tooltip> : badge;
}
