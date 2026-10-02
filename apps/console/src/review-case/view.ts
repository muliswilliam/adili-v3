import { calendarDaysUntil, type IconProps } from '@adili/ui';
import {
  CheckmarkCircle02Icon,
  Clock01Icon,
  DocumentValidationIcon,
  File02Icon,
  Flag02Icon,
  Message01Icon,
  MessageCancel01Icon,
  MessageQuestionIcon,
  PencilEdit02Icon,
  RefreshIcon,
  Search01Icon,
  Shield01Icon,
  UserSwitchIcon,
} from '@hugeicons/core-free-icons';

import type { Tone } from '../clarification/labels';
import type { CaseData } from '../server/review-case.server';
import type { CaseListItem, CaseStatus, TimelineEntry } from '../server/review/types';
import { CASE_COPY } from './messages';

/**
 * What the case view shows and offers (spec 07a FE-3), worked out from the case and who is
 * looking: the status's words, the clarification window, the assignment actions in the header
 * and whether the viewer may act on the case, and the timeline's icons.
 */

export const CASE_STATUSES = {
  unassigned: { label: 'Unassigned', tone: 'neutral' },
  assigned: { label: 'Assigned', tone: 'info' },
  'awaiting-clarification': { label: 'Awaiting clarification', tone: 'warning' },
  clarified: { label: 'Clarified', tone: 'success' },
  'ready-for-determination': { label: 'Ready for determination', tone: 'success' },
  'sample-review': { label: 'Sample review', tone: 'brand' },
  'further-action': { label: 'Further action', tone: 'destructive' },
  determined: { label: 'Determined', tone: 'neutral' },
} satisfies Record<CaseStatus, { label: string; tone: Tone }>;

export interface WindowLine {
  text: string;
  open: boolean;
  /** Three weeks or less left: the line turns amber. */
  closing: boolean;
}

/** "Window closes 12 Oct 2026 · 16 days left", or "Window closed ..." once it has. */
export function windowLine(windowEndsAt: string, now: number): WindowLine {
  const open = now <= Date.parse(windowEndsAt);
  if (!open) return { text: CASE_COPY.windowClosed(windowEndsAt), open, closing: false };
  const daysLeft = Math.max(0, calendarDaysUntil(windowEndsAt, now));
  return { text: CASE_COPY.windowOpen(windowEndsAt, daysLeft), open, closing: daysLeft <= 21 };
}

/** Who is looking at the case. */
export interface CaseViewer {
  subject: string;
  supervisor: boolean;
}

/**
 * The header's assignment actions, in order. Claim: nobody holds the case. Release: the viewer
 * holds it. Reassign and Unassign: a supervisor, someone holds it. Assign: a supervisor, nobody
 * does. Later slices add theirs (a registry re-check, propose determination) after these.
 */
export type AssignmentAction = 'claim' | 'release' | 'reassign' | 'unassign' | 'assign';

export function assignmentActions(item: CaseListItem, viewer: CaseViewer): AssignmentAction[] {
  const held = item.assignee !== null;
  const mine = item.assignee?.subject === viewer.subject;
  const actions: AssignmentAction[] = [];
  if (item.status === 'determined') return actions;
  if (!held) actions.push('claim');
  if (mine) actions.push('release');
  if (viewer.supervisor && held) actions.push('reassign', 'unassign');
  if (viewer.supervisor && !held) actions.push('assign');
  return actions;
}

/** The viewer holds the case, so its flags and clarifications are theirs to act on. */
export function holdsCase(item: CaseListItem, viewer: CaseViewer): boolean {
  return item.assignee?.subject === viewer.subject;
}

/** The note under the header when the viewer cannot act on the case; null when they can. */
export function readOnlyNote(item: CaseListItem, viewer: CaseViewer): string | null {
  if (holdsCase(item, viewer)) return null;
  // A supervisor's actions are in the header, as is Claim on a case nobody holds.
  if (viewer.supervisor || !item.assignee) return null;
  return CASE_COPY.readOnly(item.assignee.name);
}

/** A supervisor who held the case cannot approve its determination (separation of duties). */
export function separationCue(
  detail: Pick<CaseData, 'reviewerHistory'>,
  viewer: CaseViewer,
): boolean {
  return (
    viewer.supervisor && detail.reviewerHistory.some((each) => each.subject === viewer.subject)
  );
}

/** The latest version, when the case has been amended: for the header's "Version 2 of 2" note. */
export function versionNote(detail: Pick<CaseData, 'versions' | 'case'>): string | null {
  const latest = detail.versions.at(-1);
  if (!latest || detail.case.currentVersion < 2) return null;
  return CASE_COPY.versionNote(latest.submittedAt, detail.case.currentVersion - 1);
}

const TIMELINE_ICONS: Record<
  string,
  { icon: IconProps['icon']; tone: 'default' | 'success' | 'warning' | 'info' | 'destructive' }
> = {
  'case-created': { icon: File02Icon, tone: 'default' },
  'version-processed': { icon: RefreshIcon, tone: 'info' },
  assigned: { icon: UserSwitchIcon, tone: 'info' },
  'flag-reviewed': { icon: CheckmarkCircle02Icon, tone: 'success' },
  'note-added': { icon: PencilEdit02Icon, tone: 'default' },
  'clarification-issued': { icon: Message01Icon, tone: 'info' },
  'clarification-responded': { icon: MessageQuestionIcon, tone: 'success' },
  'clarification-resolved': { icon: CheckmarkCircle02Icon, tone: 'success' },
  'clarification-withdrawn': { icon: MessageCancel01Icon, tone: 'default' },
  'clarification-follow-up': { icon: Message01Icon, tone: 'info' },
  'clarification-overdue': { icon: Clock01Icon, tone: 'destructive' },
  'clarification-reminder-sent': { icon: Clock01Icon, tone: 'warning' },
  'status-changed': { icon: Flag02Icon, tone: 'default' },
  'sampled-for-review': { icon: Search01Icon, tone: 'info' },
  'registry-checked': { icon: Shield01Icon, tone: 'default' },
  'registry-rechecked': { icon: Shield01Icon, tone: 'info' },
  'determination-proposed': { icon: DocumentValidationIcon, tone: 'info' },
  'determination-approved': { icon: DocumentValidationIcon, tone: 'success' },
  'determination-returned': { icon: DocumentValidationIcon, tone: 'warning' },
  'determination-withdrawn': { icon: DocumentValidationIcon, tone: 'default' },
};

/** A timeline entry's icon and tint; a kind this console does not know yet gets a plain dot. */
export function timelineIcon(kind: TimelineEntry['kind']) {
  return TIMELINE_ICONS[kind] ?? { icon: Flag02Icon, tone: 'default' as const };
}
