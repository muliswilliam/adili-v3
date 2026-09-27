import { Alert02Icon, Clock01Icon, Tick02Icon } from '@hugeicons/core-free-icons';
import { cva } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';
import { formatCalendarDate, formatDate } from '../lib/format-date';
import { Icon } from './icon';

export type DeadlineState = 'due' | 'soon' | 'today' | 'late';

export interface DeadlineStatus {
  state: DeadlineState;
  /** Calendar days from today to the deadline in Kenyan time; negative once it has passed. */
  days: number;
}

const DAY_MS = 86_400_000;

/** Days before a deadline from which it shows as due soon, unless the caller sets its own. */
const DEFAULT_SOON_DAYS = 5;

/**
 * Where a deadline stands today, counted in whole calendar days in Kenyan time: late only once
 * its day has passed, and due soon from `soonDays` days before (the first reminder).
 */
export function deadlineStatus(
  due: string,
  { now = Date.now(), soonDays = DEFAULT_SOON_DAYS }: { now?: number; soonDays?: number } = {},
): DeadlineStatus {
  const days = Math.round(
    (Date.parse(formatCalendarDate(due)) - Date.parse(formatCalendarDate(now))) / DAY_MS,
  );
  const state = days < 0 ? 'late' : days === 0 ? 'today' : days <= soonDays ? 'soon' : 'due';
  return { state, days };
}

const deadlineChipVariants = cva(
  'inline-flex h-6 w-fit shrink-0 items-center gap-[5px] rounded-full pr-[9px] pl-[7px] text-[12.5px] font-semibold whitespace-nowrap tabular-nums [&_svg]:size-[13px]',
  {
    variants: {
      state: {
        due: 'bg-muted text-secondary-foreground',
        soon: 'bg-warning-subtle text-warning',
        today: 'bg-warning-subtle text-warning',
        late: 'bg-destructive-subtle text-destructive',
        met: 'bg-success-subtle text-success',
      },
    },
  },
);

const days = (count: number) => `${String(count)} ${count === 1 ? 'day' : 'days'}`;

export type DeadlineChipProps = Omit<ComponentProps<'time'>, 'children' | 'dateTime'> & {
  /** The deadline, an ISO date-time. */
  due: string;
  /** Names the deadline for screen readers and the hover title, e.g. "Decision due". */
  label?: string;
  /** Days before the deadline from which it shows as due soon: the first reminder. */
  soonDays?: number;
  /** Shown on the deadline's own day, e.g. "Ends today". */
  todayText?: string;
  /** When set, the deadline was met: shows this text, e.g. "Decided 26 Sep", with a tick. */
  met?: string;
  /** Epoch milliseconds to count from; defaults to now. */
  now?: number;
};

/**
 * A deadline as a small pill: days left, due soon (amber) from the first reminder, due today,
 * then days late (red), or a green tick once met. The visible text is short; screen readers
 * hear the label, the date and the days left instead, e.g. "Decision due 12 Oct 2026, 3 days
 * left", so the state never relies on colour.
 */
export function DeadlineChip({
  due,
  label = 'Due',
  soonDays = DEFAULT_SOON_DAYS,
  todayText = 'Due today',
  met,
  now,
  className,
  ...props
}: DeadlineChipProps) {
  const title = `${label} ${formatDate(due)}`;

  if (met) {
    return (
      <time
        {...props}
        dateTime={formatCalendarDate(due)}
        title={title}
        data-state="met"
        className={cn(deadlineChipVariants({ state: 'met' }), className)}
      >
        <Icon icon={Tick02Icon} strokeWidth={2.4} />
        <span className="sr-only">{`${title}, met: ${met}`}</span>
        <span aria-hidden="true">{met}</span>
      </time>
    );
  }

  const { state, days: left } = deadlineStatus(due, { now, soonDays });
  const text =
    state === 'late' ? `${days(-left)} late` : state === 'today' ? todayText : `${days(left)} left`;
  // Mid-sentence after the date: "Decision due 26 Sep 2026, due today".
  const spoken = state === 'today' ? todayText.toLowerCase() : text;

  return (
    <time
      {...props}
      dateTime={formatCalendarDate(due)}
      title={title}
      data-state={state}
      className={cn(deadlineChipVariants({ state }), className)}
    >
      <Icon icon={state === 'late' ? Alert02Icon : Clock01Icon} strokeWidth={2.2} />
      <span className="sr-only">{`${title}, ${spoken}`}</span>
      <span aria-hidden="true">{text}</span>
    </time>
  );
}
