import { type ContactChannel, maskContact } from '@adili/contacts';
import { Tick02Icon } from '@hugeicons/core-free-icons';
import type { ComponentProps, ReactNode } from 'react';

import { cn } from '../lib/cn';
import { Badge } from './badge';
import { Icon } from './icon';

export type MaskedContactProps = Omit<ComponentProps<'span'>, 'children'> & {
  kind: ContactChannel;
  /** The contact, masked or not. It is always masked before rendering. */
  value: string;
  /** Shows a "Verified" badge. */
  verified?: boolean;
  /** Read after the value by screen readers. */
  privacyHint?: ReactNode;
  verifiedLabel?: ReactNode;
};

/**
 * An email or phone number with most of it hidden, e.g. where a one-time code was sent. The
 * full value is never rendered, even when it is passed in unmasked.
 */
export function MaskedContact({
  kind,
  value,
  verified = false,
  privacyHint = '(partially hidden for privacy)',
  verifiedLabel = 'Verified',
  className,
  ...props
}: MaskedContactProps) {
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-2', className)} {...props}>
      <span>
        <span className="font-semibold whitespace-nowrap tabular-nums">
          {maskContact(kind, value)}
        </span>
        <span className="sr-only"> {privacyHint}</span>
      </span>
      {verified ? (
        <Badge variant="success">
          <Icon icon={Tick02Icon} strokeWidth={2.5} />
          {verifiedLabel}
        </Badge>
      ) : null}
    </span>
  );
}
