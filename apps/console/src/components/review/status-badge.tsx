import type { Icon } from '@adili/ui';
import { type AlertProps, Badge, type BadgeProps } from '@adili/ui';
import {
  Alert02Icon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  InboxIcon,
  InformationCircleIcon,
} from '@hugeicons/core-free-icons';

import { CLARIFICATION_STATUSES, type Tone } from '../../clarification/labels';
import type { Clarification } from '../../server/review/types';

/** One tone, two components: the badge variant and the callout variant and icon. */
export const TONES: Record<
  Tone,
  {
    badge: BadgeProps['variant'];
    alert: AlertProps['variant'];
    icon: Parameters<typeof Icon>[0]['icon'];
  }
> = {
  neutral: { badge: 'default', alert: 'neutral', icon: InformationCircleIcon },
  info: { badge: 'info', alert: 'info', icon: Clock01Icon },
  brand: { badge: 'brand', alert: 'brand', icon: InboxIcon },
  success: { badge: 'success', alert: 'success', icon: CheckmarkCircle02Icon },
  warning: { badge: 'warning', alert: 'warning', icon: Clock01Icon },
  destructive: { badge: 'destructive', alert: 'destructive', icon: Alert02Icon },
};

export function StatusBadge({ status }: { status: Clarification['status'] }) {
  const { label, tone } = CLARIFICATION_STATUSES[status];
  return <Badge variant={TONES[tone].badge}>{label}</Badge>;
}
