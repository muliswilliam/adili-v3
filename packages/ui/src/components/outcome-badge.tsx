import { ArrowRight02Icon, Cancel01Icon, Tick02Icon } from '@hugeicons/core-free-icons';

import { cn } from '../lib/cn';
import { Badge, type BadgeProps } from './badge';
import { Icon, type IconProps } from './icon';

/**
 * A compliance determination's outcome, as the review contract's `DeterminationOutcome`.
 * `compliant-no-issues` is the system's proposal for a low-priority case with nothing open, the
 * outcome a bulk closure approves.
 */
export type DeterminationOutcome =
  'compliant' | 'compliant-no-issues' | 'non-compliant' | 'further-action';

export const DETERMINATION_OUTCOMES: readonly DeterminationOutcome[] = [
  'compliant',
  'compliant-no-issues',
  'non-compliant',
  'further-action',
];

export type OutcomeBadgeMessages = Record<DeterminationOutcome, string>;

export const OUTCOME_BADGE_MESSAGES: OutcomeBadgeMessages = {
  compliant: 'Compliant',
  'compliant-no-issues': 'Compliant: no issues identified',
  'non-compliant': 'Non-compliant',
  'further-action': 'Further action',
};

const META: Record<
  DeterminationOutcome,
  { variant: NonNullable<BadgeProps['variant']>; icon: IconProps['icon'] }
> = {
  compliant: { variant: 'success', icon: Tick02Icon },
  'compliant-no-issues': { variant: 'success', icon: Tick02Icon },
  'non-compliant': { variant: 'destructive', icon: Cancel01Icon },
  'further-action': { variant: 'warning', icon: ArrowRight02Icon },
};

export type OutcomeBadgeProps = Omit<BadgeProps, 'children' | 'variant'> & {
  outcome: DeterminationOutcome;
  /** Replaces any of the default words. */
  messages?: Partial<OutcomeBadgeMessages>;
};

/**
 * A determination's outcome wherever it shows (an approval card, a case header, a decision
 * letter's summary): "Compliant" and "Compliant: no issues identified" (green, a tick),
 * "Non-compliant" (red, a cross) or "Further action" (amber, an arrow). Semibold, as the outcome
 * is what the row is about. The outcome is in the text, never colour alone.
 */
export function OutcomeBadge({ outcome, messages, className, ...props }: OutcomeBadgeProps) {
  const copy = { ...OUTCOME_BADGE_MESSAGES, ...messages };
  const { variant, icon } = META[outcome];
  return (
    <Badge
      variant={variant}
      data-outcome={outcome}
      className={cn('pl-[7px] font-semibold', className)}
      {...props}
    >
      <Icon icon={icon} strokeWidth={2.4} />
      {copy[outcome]}
    </Badge>
  );
}
