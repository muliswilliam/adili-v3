import { UserIcon } from '@hugeicons/core-free-icons';
import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';
import { Avatar } from './avatar';
import { Icon } from './icon';

export interface AssigneeChipMessages {
  unassigned: string;
  /** After the signed-in user's name, e.g. "(you)". */
  you: string;
  /** The signed-in user in a compact chip, instead of their name. */
  youCompact: string;
}

export const ASSIGNEE_CHIP_MESSAGES: AssigneeChipMessages = {
  unassigned: 'Unassigned',
  you: '(you)',
  youCompact: 'You',
};

export type AssigneeChipProps = Omit<ComponentProps<'span'>, 'children'> & {
  /** The officer holding the case; null or left out when nobody does. */
  name?: string | null;
  /** The officer is the signed-in user. */
  current?: boolean;
  /** For table cells: the signed-in user reads "You", with their name on hover. */
  compact?: boolean;
  /** Replaces any of the default words. */
  messages?: Partial<AssigneeChipMessages>;
};

/**
 * Who holds a case: an avatar with the officer's initials and their name. The signed-in user
 * gets the brand avatar and "(you)" after their name, or just "You" when `compact`. Nobody: a
 * dashed "Unassigned" pill with a person icon.
 */
export function AssigneeChip({
  name,
  current = false,
  compact = false,
  messages,
  className,
  ...props
}: AssigneeChipProps) {
  const copy = { ...ASSIGNEE_CHIP_MESSAGES, ...messages };
  const base = 'inline-flex items-center text-[13.5px] font-medium whitespace-nowrap';

  if (!name) {
    return (
      <span
        data-assignee="none"
        className={cn(
          base,
          'h-[26px] gap-1.5 rounded-full border border-dashed border-input px-2.5 text-muted-foreground',
          className,
        )}
        {...props}
      >
        <Icon icon={UserIcon} className="size-[13px]" />
        {copy.unassigned}
      </span>
    );
  }

  return (
    <span
      data-assignee={current ? 'current' : 'other'}
      title={compact && current ? name : undefined}
      className={cn(base, 'gap-[7px] text-foreground', className)}
      {...props}
    >
      <Avatar name={name} current={current} />
      {compact && current ? (
        copy.youCompact
      ) : (
        <span>
          {name}
          {current ? <span className="font-normal text-muted-foreground"> {copy.you}</span> : null}
        </span>
      )}
    </span>
  );
}
