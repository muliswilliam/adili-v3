import type { IconProps, TimelineEvent } from '@adili/ui';
import {
  Alert02Icon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  File02Icon,
  JusticeScale01Icon,
  Message01Icon,
  PencilEdit02Icon,
  Refresh01Icon,
  SentIcon,
  Shield01Icon,
  UserCheck01Icon,
  UserRemove01Icon,
  UserSwitchIcon,
} from '@hugeicons/core-free-icons';

import type { TimelineEntry } from '../server/review/types';

/**
 * The case's timeline entries (review.yaml `TimelineEntry`) as the Timeline primitive draws
 * them: the service's summary as the title, the actor's name (null for the system), and an icon
 * and tone by kind, as the 07a prototype marks them (claimed info, reviewed success, a new
 * version warning). Kinds the console does not know keep the clock.
 */

interface Mark {
  icon: IconProps['icon'];
  tone?: TimelineEvent['tone'];
}

const MARKS: Record<string, Mark> = {
  'case-created': { icon: File02Icon },
  'version-processed': { icon: Refresh01Icon, tone: 'warning' },
  claimed: { icon: UserCheck01Icon, tone: 'info' },
  assigned: { icon: UserSwitchIcon, tone: 'info' },
  reassigned: { icon: UserSwitchIcon, tone: 'info' },
  released: { icon: UserRemove01Icon },
  unassigned: { icon: UserRemove01Icon },
  'note-added': { icon: PencilEdit02Icon },
  'flag-reviewed': { icon: CheckmarkCircle02Icon, tone: 'success' },
  'status-changed': { icon: Clock01Icon },
  'sampled-for-review': { icon: Shield01Icon, tone: 'info' },
  'clarification-issued': { icon: SentIcon, tone: 'info' },
  'clarification-follow-up': { icon: SentIcon, tone: 'info' },
  'clarification-reminder-sent': { icon: Message01Icon },
  'clarification-responded': { icon: Message01Icon, tone: 'brand' },
  'clarification-resolved': { icon: CheckmarkCircle02Icon, tone: 'success' },
  'clarification-overdue': { icon: Alert02Icon, tone: 'destructive' },
  'clarification-withdrawn': { icon: UserRemove01Icon },
  'determination-proposed': { icon: JusticeScale01Icon, tone: 'info' },
  'determination-approved': { icon: JusticeScale01Icon, tone: 'success' },
  'determination-returned': { icon: JusticeScale01Icon, tone: 'warning' },
  'determination-withdrawn': { icon: JusticeScale01Icon },
};

/**
 * The service records every assignment change as kind `assigned`; its ref names the new holder
 * (null when the case went back to the queue), so release and unassign get their own mark.
 */
function markOf(entry: TimelineEntry): Mark {
  if (entry.kind === 'assigned') {
    if (entry.ref === null) return { icon: UserRemove01Icon };
    if (entry.summary === 'Claimed') return { icon: UserCheck01Icon, tone: 'info' };
  }
  return MARKS[entry.kind] ?? { icon: Clock01Icon };
}

export function timelineEvents(entries: TimelineEntry[]): TimelineEvent[] {
  return entries.map((entry) => ({
    id: entry.id,
    at: entry.at,
    title: entry.summary,
    actor: entry.actor?.name ?? null,
    ...markOf(entry),
  }));
}
