import { Alert02Icon, Clock01Icon, Tick02Icon } from '@hugeicons/core-free-icons';
import { type ComponentProps, useEffect, useState } from 'react';

import { cn } from '../lib/cn';
import { formatCalendarDate, formatDate, msUntilKenyanMidnight } from '../lib/format-date';
import type { Tone } from '../lib/tone';
import { badgeVariants } from './badge';
import { Icon } from './icon';

export type DeadlineState = 'due' | 'soon' | 'today' | 'late';

export interface DeadlineStatus {
  state: DeadlineState;
  /** Calendar days from today to the deadline in Kenyan time; negative once it has passed. */
  days: number;
}

/**
 * Days before each access clock's deadline from which it shows as due soon: its first
 * reminder. A Form K decision (30 days) is reminded on days 20 and 28, a law enforcement
 * decision (14 days) on day 10; the representation window is 7 days.
 */
export const deadlineSoonDays = {
  decision: 10,
  representations: 2,
  lawEnforcement: 4,
  certifiedCopy: 4,
  download: 3,
} as const;

const DAY_MS = 86_400_000;

/**
 * Where a deadline stands today, counted in whole calendar days in Kenyan time: due soon from
 * `soonDays` days before, and late once its day has passed or when the server says so (`late`,
 * e.g. after the due hour on the day itself).
 */
export function deadlineStatus(
  due: string,
  { now = Date.now(), soonDays, late = false }: { now?: number; soonDays: number; late?: boolean },
): DeadlineStatus {
  const days = Math.round(
    (Date.parse(formatCalendarDate(due)) - Date.parse(formatCalendarDate(now))) / DAY_MS,
  );
  const state =
    late || days < 0 ? 'late' : days === 0 ? 'today' : days <= soonDays ? 'soon' : 'due';
  return { state, days };
}

/**
 * Now, or `fixed` when given. Re-read after hydration (the server may have rendered on the
 * other side of midnight) and at each Kenyan midnight, so a page left open moves on a day.
 */
function useNow(fixed: number | undefined): number {
  const [now, setNow] = useState(() => fixed ?? Date.now());
  useEffect(() => {
    if (fixed !== undefined) return;
    // Only a new calendar day changes what the chip shows, so keep the old time otherwise.
    const refresh = () => {
      setNow((previous) => {
        const current = Date.now();
        return formatCalendarDate(current) === formatCalendarDate(previous) ? previous : current;
      });
    };
    const afterHydration = setTimeout(refresh, 0);
    const atMidnight = setTimeout(refresh, msUntilKenyanMidnight(Date.now()) + 1000);
    return () => {
      clearTimeout(afterHydration);
      clearTimeout(atMidnight);
    };
  }, [fixed, now]);
  return fixed ?? now;
}

const stateTones: Record<DeadlineState | 'met', Tone> = {
  due: 'default',
  soon: 'warning',
  today: 'warning',
  late: 'destructive',
  met: 'success',
};

// A badge, with the kit's .dlc weight, figures and tighter left edge beside the icon.
const chipClassName = (state: DeadlineState | 'met', className?: string) =>
  cn(
    badgeVariants({ variant: stateTones[state] }),
    'pl-[7px] font-semibold tabular-nums',
    className,
  );

const dayCount = (count: number) => `${String(count)} ${count === 1 ? 'day' : 'days'}`;

export type DeadlineChipProps = Omit<ComponentProps<'time'>, 'children' | 'dateTime'> & {
  /** The deadline, an ISO date-time. */
  due: string;
  /**
   * Days before the deadline from which it shows as due soon: the clock's first reminder, from
   * `deadlineSoonDays`.
   */
  soonDays: number;
  /** Names the deadline for screen readers and the hover title, e.g. "Decision due". */
  label?: string;
  /** Shown on the deadline's own day, e.g. "Ends today". */
  todayText?: string;
  /** The server's late flag; late even on the due day once the due time has passed. */
  late?: boolean;
  /** When set, the deadline was met: shows this text, e.g. "Decided 26 Sep", with a tick. */
  met?: string;
  /** Epoch milliseconds to count from; defaults to now, moving on at each Kenyan midnight. */
  now?: number;
};

/**
 * A deadline on an access clock (a decision, the representation window, a download window) as
 * a small pill: days left, due soon (amber) from the first reminder, due today, then late
 * (red), or a green tick once met. The visible text is short; screen readers hear the label,
 * the date and the days left instead, e.g. "Decision due 12 Oct 2026, 3 days left", so the
 * state never relies on colour.
 */
export function DeadlineChip({
  due,
  soonDays,
  label = 'Due',
  todayText = 'Due today',
  late,
  met,
  now,
  className,
  ...props
}: DeadlineChipProps) {
  const today = useNow(now);
  const title = `${label} ${formatDate(due)}`;

  if (met) {
    return (
      <time
        {...props}
        dateTime={formatCalendarDate(due)}
        title={title}
        data-state="met"
        className={chipClassName('met', className)}
      >
        <Icon icon={Tick02Icon} strokeWidth={2.4} />
        <span className="sr-only">{`${title}, met: ${met}`}</span>
        <span aria-hidden="true">{met}</span>
      </time>
    );
  }

  const { state, days } = deadlineStatus(due, { now: today, soonDays, late });
  const text =
    state === 'late'
      ? days < 0
        ? `${dayCount(-days)} late`
        : 'Late'
      : state === 'today'
        ? todayText
        : `${dayCount(days)} left`;
  // Mid-sentence after the date: "Decision due 26 Sep 2026, due today".
  const spoken = state === 'late' || state === 'today' ? text.toLowerCase() : text;

  return (
    <time
      {...props}
      dateTime={formatCalendarDate(due)}
      title={title}
      data-state={state}
      className={chipClassName(state, className)}
      // The day can differ between server and browser around midnight; useNow corrects it.
      suppressHydrationWarning
    >
      <Icon icon={state === 'late' ? Alert02Icon : Clock01Icon} strokeWidth={2.2} />
      <span className="sr-only" suppressHydrationWarning>{`${title}, ${spoken}`}</span>
      <span aria-hidden="true" suppressHydrationWarning>
        {text}
      </span>
    </time>
  );
}
