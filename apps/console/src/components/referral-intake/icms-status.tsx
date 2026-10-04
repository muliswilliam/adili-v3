import {
  Badge,
  type BadgeProps,
  Button,
  type ButtonProps,
  Icon,
  type IconProps,
  Spinner,
} from '@adili/ui';
import { AlertCircleIcon, RefreshIcon, SentIcon, Tick02Icon } from '@hugeicons/core-free-icons';

import type { IcmsStatus, ReferralIntakeItem } from '../../server/reporting/types';
import { messages as t } from './messages';

interface StatusView {
  variant: BadgeProps['variant'];
  /** The badge's mark: a dot, a spinner (waiting) or an icon. */
  mark: 'dot' | 'spinner' | IconProps['icon'];
  /** What pushing reads as in this status; null where it cannot be pushed. */
  push: { label: string; icon: IconProps['icon']; variant: ButtonProps['variant'] } | null;
}

/**
 * Each ICMS status as the intake shows it: Not pushed (grey, a dot) offers Push to ICMS; Pushed
 * (blue, a spinner: ICMS accepted it and its case number follows); Registered (green, a tick);
 * Failed (red, an alert) offers Retry.
 */
const STATUS_VIEWS: Record<IcmsStatus, StatusView> = {
  'not-pushed': {
    variant: 'default',
    mark: 'dot',
    push: { label: t.list.push, icon: SentIcon, variant: 'default' },
  },
  pushed: { variant: 'info', mark: 'spinner', push: null },
  registered: { variant: 'success', mark: Tick02Icon, push: null },
  'push-failed': {
    variant: 'destructive',
    mark: AlertCircleIcon,
    push: { label: t.list.retry, icon: RefreshIcon, variant: 'secondary' },
  },
};

/** What pushing the referral reads as, or null when it cannot be pushed (pushed, registered). */
export function pushAction(referral: Pick<ReferralIntakeItem, 'icmsStatus'>) {
  return STATUS_VIEWS[referral.icmsStatus].push;
}

/** Where a referral's hand-off to ICMS stands. The status is in the text, never colour alone. */
export function IcmsStatusBadge({ status }: { status: IcmsStatus }) {
  const { variant, mark } = STATUS_VIEWS[status];
  return (
    <Badge variant={variant} data-status={status} className="pl-[7px]">
      {mark === 'dot' ? (
        <span aria-hidden="true" className="size-1.5 rounded-full bg-current opacity-70" />
      ) : mark === 'spinner' ? (
        <Spinner className="size-2.5 border-[1.5px]" />
      ) : (
        <Icon icon={mark} strokeWidth={2.4} />
      )}
      {t.status[status]}
    </Badge>
  );
}

/** Push to ICMS, or Retry after a failed push; nothing where the referral cannot be pushed. */
export function PushButton({
  referral,
  onPush,
  size,
  variant,
}: {
  referral: ReferralIntakeItem;
  onPush: (referral: ReferralIntakeItem) => void;
  size?: ButtonProps['size'];
  /** Defaults to the status's: primary to push, secondary to retry, as on the prototype's rows. */
  variant?: ButtonProps['variant'];
}) {
  const action = pushAction(referral);
  if (!action) return null;
  return (
    <Button
      size={size}
      variant={variant ?? action.variant}
      onClick={() => {
        onPush(referral);
      }}
    >
      <Icon icon={action.icon} />
      {action.label}
    </Button>
  );
}
