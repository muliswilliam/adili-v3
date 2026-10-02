import type { ComponentProps, ReactNode } from 'react';

import { cn } from '../lib/cn';
import { formatCalendarDate, formatDate, formatTime } from '../lib/format-date';
import { type Tone, toneClassNames } from '../lib/tone';
import { useToday } from '../lib/use-today';
import { Icon, type IconProps } from './icon';

export interface TimelineIconProps {
  icon: IconProps['icon'];
  tone?: Tone;
  /** `sm` 28px for a vertical timeline, `md` 32px for flush list rows. */
  size?: 'sm' | 'md';
}

/** An event's icon on its tint, in a circle. */
export function TimelineIcon({ icon, tone = 'default', size = 'sm' }: TimelineIconProps) {
  return (
    <span
      data-tone={tone}
      className={cn(
        'grid shrink-0 place-items-center rounded-full',
        toneClassNames[tone],
        size === 'sm' ? 'size-7' : 'size-8',
      )}
    >
      <Icon icon={icon} className={size === 'sm' ? 'size-3.5' : undefined} strokeWidth={2} />
    </span>
  );
}

export type TimelineItemProps = Omit<ComponentProps<'li'>, 'title'> &
  Pick<TimelineIconProps, 'icon' | 'tone'> & {
    title: ReactNode;
    /** The line under the title: who acted and when. */
    meta: ReactNode;
    /** A line of detail under the meta. */
    summary?: ReactNode;
  };

/**
 * One event of a vertical timeline: the icon, a hairline down to the next event, the title,
 * then the meta line and an optional summary. Put it in an `ol`.
 */
export function TimelineItem({
  icon,
  tone,
  title,
  meta,
  summary,
  className,
  ...props
}: TimelineItemProps) {
  return (
    <li
      className={cn(
        'relative grid grid-cols-[28px_minmax(0,1fr)] gap-2.5 pb-4 before:absolute before:top-[26px] before:bottom-0 before:left-[13px] before:w-[1.5px] before:bg-border last:pb-0 last:before:hidden',
        className,
      )}
      {...props}
    >
      <TimelineIcon icon={icon} tone={tone} />
      <div className="min-w-0">
        <div className="pt-1 text-sm leading-[1.35] font-medium">{title}</div>
        <div className="mt-px text-[12.5px] text-muted-foreground">{meta}</div>
        {summary ? (
          <div className="mt-[3px] text-[13.5px] text-secondary-foreground">{summary}</div>
        ) : null}
      </div>
    </li>
  );
}

export interface TimelineEntry extends Pick<TimelineIconProps, 'icon' | 'tone'> {
  id: string;
  /** When it happened, an ISO date-time. */
  at: string;
  /** What happened, e.g. "Claimed by Faith Achieng". */
  title: ReactNode;
  /** Who acted; null for the system, which reads "System". */
  actor: string | null;
  /** A line of detail under the time and actor. */
  summary?: ReactNode;
  /** The event's kind, set as `data-kind`, e.g. for tests. */
  kind?: string;
}

export interface TimelineMessages {
  /** The actor of an entry without one. */
  system: string;
  /** The heading of the current day. */
  today: string;
  /** Names each day's list for screen readers, e.g. "Events on 25 Sep 2026". */
  day: (date: string) => string;
}

export const TIMELINE_MESSAGES: TimelineMessages = {
  system: 'System',
  today: 'Today',
  day: (date) => `Events on ${date}`,
};

export type HeadingLevel = 2 | 3 | 4;

export type TimelineProps = Omit<ComponentProps<'div'>, 'children'> & {
  entries: TimelineEntry[];
  /** Names the timeline for screen readers. */
  label?: string;
  /** Level of the day headings, to fit the page's outline. */
  headingLevel?: HeadingLevel;
  /** Now in epoch milliseconds, for the "Today" heading; defaults to the clock. */
  now?: number;
  /** Replaces any of the default words. */
  messages?: Partial<TimelineMessages>;
};

/**
 * Dated events with who acted, newest first, grouped by day in Kenyan time: an uppercase day
 * heading ("Today" for the current day), then a list per day whose entries show the icon, what
 * happened and "{time} · {actor}" ("System" without one). The time is text in a `time`
 * element.
 */
export function Timeline({
  entries,
  label = 'Timeline',
  headingLevel = 3,
  now,
  messages: overrides,
  className,
  ...props
}: TimelineProps) {
  const messages = { ...TIMELINE_MESSAGES, ...overrides };
  const today = formatCalendarDate(useToday(now));
  const Heading = `h${String(headingLevel)}` as 'h2' | 'h3' | 'h4';

  const days: { day: string; entries: TimelineEntry[] }[] = [];
  for (const entry of [...entries].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))) {
    const day = formatCalendarDate(entry.at);
    const last = days.at(-1);
    if (last?.day === day) last.entries.push(entry);
    else days.push({ day, entries: [entry] });
  }

  return (
    <div role="group" aria-label={label} className={cn('grid gap-[22px]', className)} {...props}>
      {days.map(({ day, entries: onDay }) => {
        const date = formatDate(onDay[0]?.at ?? day);
        return (
          <div key={day}>
            <Heading className="mb-2 text-xs font-semibold tracking-[0.03em] text-muted-foreground uppercase">
              {day === today ? messages.today : date}
            </Heading>
            <ol aria-label={messages.day(date)}>
              {onDay.map((entry) => (
                <TimelineItem
                  key={entry.id}
                  data-kind={entry.kind}
                  icon={entry.icon}
                  tone={entry.tone}
                  title={entry.title}
                  meta={
                    <>
                      <time dateTime={entry.at}>{formatTime(entry.at)}</time>
                      {' · '}
                      {entry.actor ?? messages.system}
                    </>
                  }
                  summary={entry.summary}
                />
              ))}
            </ol>
          </div>
        );
      })}
    </div>
  );
}
