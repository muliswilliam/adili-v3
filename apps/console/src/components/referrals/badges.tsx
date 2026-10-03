import { Badge, type BadgeProps, Icon, type IconProps } from '@adili/ui';
import {
  Cancel01Icon,
  Clock01Icon,
  RefreshIcon,
  SentIcon,
  SquareLock02Icon,
} from '@hugeicons/core-free-icons';

import { type ReferralPhase, referralPhase } from '../../referral/view';
import type { Referral, ReferralGrounds } from '../../server/review/types';
import { messages as t } from './messages';

const PHASES: Record<ReferralPhase, { variant: BadgeProps['variant']; icon: IconProps['icon'] }> =
  {
    proposed: { variant: 'warning', icon: Clock01Icon },
    assembling: { variant: 'info', icon: RefreshIcon },
    sent: { variant: 'success', icon: SentIcon },
    declined: { variant: 'destructive', icon: Cancel01Icon },
  };

/** Where a referral stands: awaiting approval, assembling, sent to EACC or declined. */
export function ReferralStatusBadge({ referral }: { referral: Pick<Referral, 'status'> }) {
  const phase = referralPhase(referral);
  const { variant, icon } = PHASES[phase];
  return (
    <Badge variant={variant}>
      <Icon icon={icon} strokeWidth={2} />
      {t.phases[phase]}
    </Badge>
  );
}

/** A referral's grounds, in the brand tint as the prototype has them. */
export function GroundsBadge({ grounds }: { grounds: ReferralGrounds }) {
  return <Badge variant="brand">{t.grounds[grounds]}</Badge>;
}

/** The ADR-010 classification of everything about a referral (the prototype's `.cls`). */
export function ConfidentialBadge() {
  return (
    <span className="inline-flex h-5 items-center gap-1 rounded-[5px] bg-destructive-subtle px-[7px] text-[11px] font-semibold tracking-[0.04em] text-destructive uppercase">
      <Icon icon={SquareLock02Icon} className="size-[11px]" strokeWidth={2.2} />
      {t.confidential}
    </span>
  );
}
