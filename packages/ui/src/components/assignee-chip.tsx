import { UserIcon } from '@hugeicons/core-free-icons';
import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';
import { Icon } from './icon';

/** A staff member as the review service names them (review.yaml `Assignee`). */
export interface Assignee {
  /** Their Keycloak subject. */
  subject: string;
  name: string;
}

/** "Faith Achieng Otieno" → "FO": the first and last names' initials, or one for a single name. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0] ?? '';
  const last = words.length > 1 ? (words.at(-1) ?? '') : '';
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
}

export type AssigneeAvatarProps = Omit<ComponentProps<'span'>, 'children'> & {
  name: string;
  /** The signed-in officer, in the brand gradient. */
  me?: boolean;
};

/**
 * A 24px circle with an officer's initials, violet, or the brand gradient for the signed-in
 * officer. Decorative: always put the name beside it.
 */
export function AssigneeAvatar({ name, me = false, className, ...props }: AssigneeAvatarProps) {
  return (
    <span
      aria-hidden="true"
      data-me={me ? '' : undefined}
      className={cn(
        'grid size-6 shrink-0 place-items-center rounded-full text-[10px] font-bold',
        me
          ? 'bg-linear-to-br from-brand/45 to-brand text-primary-foreground'
          : 'bg-avatar text-avatar-foreground',
        className,
      )}
      {...props}
    >
      {initialsOf(name)}
    </span>
  );
}

export interface AssigneeChipMessages {
  unassigned: string;
  /** After the signed-in officer's name: "(you)". */
  youSuffix: string;
  /** The signed-in officer's name when `compact`. */
  you: string;
}

const DEFAULT_MESSAGES: AssigneeChipMessages = {
  unassigned: 'Unassigned',
  youSuffix: '(you)',
  you: 'You',
};

export type AssigneeChipProps = Omit<ComponentProps<'span'>, 'children'> & {
  /** Who holds the case; null when nobody does. */
  assignee: Assignee | null;
  /** The signed-in officer's subject, to mark their own cases. */
  viewerSubject?: string | null;
  /**
   * For table cells and cards: the signed-in officer reads "You" (full name on hover and for
   * screen readers).
   */
  compact?: boolean;
  messages?: Partial<AssigneeChipMessages>;
};

/**
 * Who holds a review case: initials and name; for the signed-in officer, brand initials and
 * "Faith Achieng (you)"; or a person icon and "Unassigned" in a dashed pill.
 */
export function AssigneeChip({
  assignee,
  viewerSubject,
  compact = false,
  messages,
  className,
  ...props
}: AssigneeChipProps) {
  const copy = { ...DEFAULT_MESSAGES, ...messages };
  const chip =
    'inline-flex max-w-full items-center gap-[7px] text-[13.5px] font-medium whitespace-nowrap text-foreground';

  if (!assignee) {
    return (
      <span
        data-assignee="none"
        className={cn(
          chip,
          'h-[26px] rounded-full border border-dashed border-input px-2.5 text-muted-foreground',
          className,
        )}
        {...props}
      >
        <Icon icon={UserIcon} className="size-[13px]" strokeWidth={2} />
        {copy.unassigned}
      </span>
    );
  }

  const me = Boolean(viewerSubject) && assignee.subject === viewerSubject;
  return (
    <span
      data-assignee={me ? 'me' : 'other'}
      title={me && compact ? assignee.name : undefined}
      className={cn(chip, className)}
      {...props}
    >
      <AssigneeAvatar name={assignee.name} me={me} />
      {me && compact ? (
        <>
          <span aria-hidden="true">{copy.you}</span>
          <span className="sr-only">{`${assignee.name} ${copy.youSuffix}`}</span>
        </>
      ) : (
        <span className="truncate">
          {assignee.name}
          {me ? <span className="font-normal text-muted-foreground"> {copy.youSuffix}</span> : null}
        </span>
      )}
    </span>
  );
}
