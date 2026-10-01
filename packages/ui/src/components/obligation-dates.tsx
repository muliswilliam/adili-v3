import { InformationCircleIcon } from '@hugeicons/core-free-icons';
import type { ReactNode } from 'react';

import { cn } from '../lib/cn';
import { focusRing } from '../lib/focus';
import type { ObligationStatus } from '../lib/obligations';
import { DateText } from './date-text';
import { Icon } from './icon';
import { Tooltip } from './tooltip';

export interface ObligationCountdownProps {
  obligation: { status: ObligationStatus; statementDate: string; dueDate: string };
  /** Epoch milliseconds to count from; defaults to now. */
  now?: number;
  className?: string;
}

/**
 * How an obligation's date stands, by status: an upcoming one says when it opens ("Opens 1
 * November 2027"), a due or overdue one counts down to its due date ("Due in 12 days", "3 days
 * overdue"). Nothing for a filed or cancelled one: its due date no longer counts.
 */
export function ObligationCountdown({ obligation, now, className }: ObligationCountdownProps) {
  switch (obligation.status) {
    case 'upcoming':
      return (
        <DateText date={obligation.statementDate} kind="opens" now={now} className={className} />
      );
    case 'due':
    case 'overdue':
      return <DateText date={obligation.dueDate} now={now} className={className} />;
    case 'filed':
    case 'cancelled':
      return null;
  }
}

/**
 * Whether `ObligationCountdown` shows anything for the status: callers leave out the separator
 * or pill around it otherwise.
 */
export function hasCountdown(status: ObligationStatus): boolean {
  return status !== 'filed' && status !== 'cancelled';
}

export interface StatementDateTermProps {
  /** The term, e.g. "Statement date". */
  children: ReactNode;
  /** What it means, in the reader's words: shown in a tooltip. */
  hint: ReactNode;
}

/**
 * The term "Statement date" with its meaning in a tooltip: dotted underline and an info icon,
 * focusable so the meaning is reachable by keyboard.
 */
export function StatementDateTerm({ children, hint }: StatementDateTermProps) {
  return (
    <Tooltip content={hint} side="bottom">
      <span
        tabIndex={0}
        className={cn(
          'inline-flex cursor-help items-center gap-1 rounded-sm underline decoration-current/40 decoration-dotted underline-offset-[3px]',
          focusRing,
        )}
      >
        {children}
        <Icon icon={InformationCircleIcon} className="size-[13px]" aria-hidden="true" />
      </span>
    </Tooltip>
  );
}
