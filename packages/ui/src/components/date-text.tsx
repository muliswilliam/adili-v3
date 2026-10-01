import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';
import {
  calendarDaysUntil,
  formatCalendarDate,
  formatDate,
  formatLongDate,
} from '../lib/format-date';
import { useToday } from '../lib/use-today';

export type DateTextKind = 'due' | 'opens';

export type DateTextState = 'upcoming' | 'due' | 'today' | 'overdue';

const dayCount = (count: number) => `${String(count)} ${count === 1 ? 'day' : 'days'}`;

/** Calendar days until a due date as a phrase: "Due in 12 days", "Due today", "3 days overdue". */
export function duePhrase(days: number): string {
  if (days > 0) return `Due in ${dayCount(days)}`;
  if (days === 0) return 'Due today';
  return `${dayCount(-days)} overdue`;
}

export type DateTextProps = Omit<ComponentProps<'time'>, 'children' | 'dateTime'> & {
  /** An ISO date (`2027-12-31`) or date-time, read as its calendar day in Kenyan time. */
  date: string;
  /**
   * `due` (default): days left or overdue, counted in calendar days ("Due in 12 days", "Due
   * today", "3 days overdue"). `opens`: when an upcoming duty opens ("Opens 1 November 2027").
   */
  kind?: DateTextKind;
  /** Names the date in the title and for screen readers; defaults to "Due" or "Opens". */
  label?: string;
  /** Epoch milliseconds to count from; defaults to now, moving on at each Kenyan midnight. */
  now?: number;
};

/**
 * A date as a relative phrase, such as "Due in 12 days" or "3 days overdue", with the absolute
 * date in the `title` and read out after the phrase, so neither hover nor sight is needed.
 * Days are whole calendar days in Kenyan time, so month ends and the year end count right.
 * Overdue text takes the warning colour; `data-state` (upcoming, due, today, overdue) lets
 * callers style the rest.
 */
export function DateText({ date, kind = 'due', label, now, className, ...props }: DateTextProps) {
  const today = useToday(now);
  const name = label ?? (kind === 'opens' ? 'Opens' : 'Due');
  const title = `${name} ${formatDate(date)}`;

  if (kind === 'opens') {
    return (
      <time
        {...props}
        dateTime={formatCalendarDate(date)}
        title={title}
        data-state="upcoming"
        className={className}
      >
        {`${name} ${formatLongDate(date)}`}
      </time>
    );
  }

  const days = calendarDaysUntil(date, today);
  const state: DateTextState = days < 0 ? 'overdue' : days === 0 ? 'today' : 'due';

  return (
    <time
      {...props}
      dateTime={formatCalendarDate(date)}
      title={title}
      data-state={state}
      className={cn(state === 'overdue' && 'font-medium text-warning-subtle-foreground', className)}
      // The day can differ between server and browser around midnight; useToday corrects it.
      suppressHydrationWarning
    >
      <span suppressHydrationWarning>{duePhrase(days)}</span>
      <span className="sr-only">{` (${title.charAt(0).toLowerCase()}${title.slice(1)})`}</span>
    </time>
  );
}
