import { BanIcon, Pulse01Icon, Tick02Icon } from '@hugeicons/core-free-icons';

import { Badge, type BadgeProps } from './badge';
import { Icon, type IconProps } from './icon';

/**
 * A registry's circuit breaker. `closed`: calls go through. `open`: after repeated failures no
 * calls are sent. `half-open`: a few calls test whether the registry has recovered.
 */
export type BreakerState = 'closed' | 'half-open' | 'open';

export const BREAKER_STATES: readonly BreakerState[] = ['closed', 'half-open', 'open'];

export type BreakerBadgeMessages = Record<BreakerState, string>;

export const BREAKER_BADGE_MESSAGES: BreakerBadgeMessages = {
  closed: 'Closed',
  'half-open': 'Half-open',
  open: 'Open',
};

const META: Record<
  BreakerState,
  { variant: NonNullable<BadgeProps['variant']>; icon: IconProps['icon'] }
> = {
  closed: { variant: 'success', icon: Tick02Icon },
  'half-open': { variant: 'warning', icon: Pulse01Icon },
  open: { variant: 'destructive', icon: BanIcon },
};

export type BreakerBadgeProps = Omit<BadgeProps, 'children' | 'variant'> & {
  state: BreakerState;
  /** Replaces any of the default words. */
  messages?: Partial<BreakerBadgeMessages>;
};

/**
 * A registry's circuit breaker state on the Integrations page: "Closed" (green, a tick),
 * "Half-open" (amber, a pulse) or "Open" (red, a ban sign). The state is in the text, never
 * colour alone.
 */
export function BreakerBadge({ state, messages, ...props }: BreakerBadgeProps) {
  const copy = { ...BREAKER_BADGE_MESSAGES, ...messages };
  const { variant, icon } = META[state];
  return (
    <Badge variant={variant} data-state={state} {...props}>
      <Icon icon={icon} strokeWidth={2.2} />
      {copy[state]}
    </Badge>
  );
}
