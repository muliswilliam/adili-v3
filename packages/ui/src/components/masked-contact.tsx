import type { ComponentProps, ReactNode } from 'react';

import { cn } from '../lib/cn';
import { Badge } from './badge';

export type ContactKind = 'email' | 'phone';

const MASK_CHAR = '*';

/**
 * `jane.doe@moe.go.ke` → `j***@moe.go.ke`. The local part always becomes three stars, so its
 * length is not revealed. Values that are already masked are returned unchanged.
 */
export function maskEmail(email: string): string {
  const value = email.trim();
  if (value.includes(MASK_CHAR)) return value;
  const at = value.lastIndexOf('@');
  if (at < 1) return '***';
  return `${value.charAt(0)}***${value.slice(at)}`;
}

/**
 * `+254712345678` or `0712 345 678` → `07** *** 678`. Kenyan numbers are shown in the local
 * format; others keep their first two characters. Values that are already masked are returned
 * unchanged.
 */
export function maskPhone(phone: string): string {
  const value = phone.trim();
  if (value.includes(MASK_CHAR)) return value;
  const compact = value.replace(/[\s()-]/g, '');
  const local = compact.startsWith('+254') ? `0${compact.slice(4)}` : compact;
  if (local.length < 6) return '** *** ***';
  return `${local.slice(0, 2)}** *** ${local.slice(-3)}`;
}

export function maskContact(kind: ContactKind, value: string): string {
  return kind === 'email' ? maskEmail(value) : maskPhone(value);
}

export type MaskedContactProps = Omit<ComponentProps<'span'>, 'children'> & {
  kind: ContactKind;
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
        <span className="font-medium tabular-nums">{maskContact(kind, value)}</span>
        <span className="sr-only"> {privacyHint}</span>
      </span>
      {verified ? <Badge variant="success">{verifiedLabel}</Badge> : null}
    </span>
  );
}
