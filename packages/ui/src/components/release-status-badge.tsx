import { BanIcon, Tick02Icon, ViewIcon } from '@hugeicons/core-free-icons';

import type { BadgeProps } from './badge';
import { KeyedStatusBadge, type StatusBadgeLook } from './keyed-status-badge';

/** Where an open-data release stands, as the reporting contract's `OpenDataRelease.status`. */
export type ReleaseStatus = 'preview' | 'published' | 'withdrawn';

export const RELEASE_STATUSES: readonly ReleaseStatus[] = ['preview', 'published', 'withdrawn'];

export type ReleaseStatusBadgeMessages = Record<ReleaseStatus, string>;

export const RELEASE_STATUS_BADGE_MESSAGES: ReleaseStatusBadgeMessages = {
  preview: 'Preview',
  published: 'Published',
  withdrawn: 'Withdrawn',
};

const LOOKS: Record<ReleaseStatus, StatusBadgeLook> = {
  preview: { variant: 'info', icon: ViewIcon },
  published: { variant: 'success', icon: Tick02Icon, strokeWidth: 2.4 },
  withdrawn: { variant: 'destructive', icon: BanIcon, strokeWidth: 2.2 },
};

export type ReleaseStatusBadgeProps = Omit<BadgeProps, 'children' | 'variant'> & {
  status: ReleaseStatus;
  /** Replaces any of the default words, e.g. the Swahili ones on the portal. */
  messages?: Partial<ReleaseStatusBadgeMessages>;
};

/**
 * An open-data release's status: "Preview" (blue, an eye: built, seen only by EACC and each
 * Commission for its own rows), "Published" (green, a tick) or "Withdrawn" (red, a ban: kept in
 * the history with its reason). The status is in the text, never colour alone.
 */
export function ReleaseStatusBadge({ status, messages, ...props }: ReleaseStatusBadgeProps) {
  return (
    <KeyedStatusBadge
      status={status}
      looks={LOOKS}
      words={{ ...RELEASE_STATUS_BADGE_MESSAGES, ...messages }}
      {...props}
    />
  );
}
