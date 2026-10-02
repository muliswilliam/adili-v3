import { Clock01Icon } from '@hugeicons/core-free-icons';
import type { ReactNode } from 'react';

import { cn } from '../lib/cn';
import { formatCalendarDate, formatDate, formatTime } from '../lib/format-date';
import { type Tone, toneClassNames } from '../lib/tone';
import { useToday } from '../lib/use-today';
import { Icon, type IconProps } from './icon';
import type { HeadingLevel } from './register-timeline';

/** One dated event, e.g. a case's review.yaml `TimelineEntry`. */
export interface TimelineEvent {
  id: string;
  /** When it happened, an ISO date-time. */
  at: string;
  /** What happened: "Claimed by Faith Achieng". */
  title: ReactNode;
  /** Who acted; null for the system. */
  actor: string | null;
  /** Defaults to a clock. */
  icon?: IconProps['icon'];
  /** Tints the icon; defaults to grey. */
  tone?: Tone;
  /** A line of detail under the time and actor. */
  detail?: ReactNode;
}

export interface TimelineMessages {
  /** The day heading for today's events. */
  today: string;
  /** Names who acted when nobody did. */
  system: string;
  /** Names a day's list for screen readers: "Events on 2 Sep 2026". */
  dayLabel: (day: string) => string;
}

const DEFAULT_MESSAGES: TimelineMessages = {
  today: 'Today',
  system: 'System',
  dayLabel: (day) => `Events on ${day}`,
};

export interface TimelineProps {
  events: TimelineEvent[];
  /** Level of the day headings, to fit the page's outline. */
  headingLevel?: HeadingLevel;
  /** Now, in epoch ms, for the "Today" heading; defaults to the clock (`useToday`). */
  now?: number;
  messages?: Partial<TimelineMessages>;
  className?: string;
}

interface Day {
  key: string;
  at: string;
  events: TimelineEvent[];
}

function byDay(events: TimelineEvent[]): Day[] {
  const days: Day[] = [];
  const newestFirst = [...events].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  for (const event of newestFirst) {
    const key = formatCalendarDate(event.at);
    const last = days.at(-1);
    if (last?.key === key) last.events.push(event);
    else days.push({ key, at: event.at, events: [event] });
  }
  return days;
}

/**
 * Dated events newest first, one list per day under a day heading ("Today", "2 Sep 2026"), in
 * Kenyan time. Each event has an icon on a rail, what happened, and the time and who acted
 * ("14:30 · Faith Achieng", or "System").
 */
export function Timeline({ events, headingLevel = 3, now, messages, className }: TimelineProps) {
  const copy = { ...DEFAULT_MESSAGES, ...messages };
  const today = formatCalendarDate(useToday(now));
  return (
    <div className={cn('grid', className)}>
      {byDay(events).map((day) => (
        <TimelineDay
          key={day.key}
          day={day}
          heading={day.key === today ? copy.today : formatDate(day.at)}
          headingLevel={headingLevel}
          copy={copy}
        />
      ))}
    </div>
  );
}

function TimelineDay({
  day,
  heading,
  headingLevel,
  copy,
}: {
  day: Day;
  heading: string;
  headingLevel: HeadingLevel;
  copy: TimelineMessages;
}) {
  const Heading = `h${String(headingLevel)}` as 'h2' | 'h3' | 'h4';
  return (
    <>
      <Heading className="mt-1.5 mb-2 text-xs font-semibold tracking-[0.03em] text-muted-foreground uppercase">
        {heading}
      </Heading>
      <ol aria-label={copy.dayLabel(formatDate(day.at))}>
        {day.events.map((event) => {
          const tone = event.tone ?? 'default';
          return (
            <li
              key={event.id}
              className="relative grid grid-cols-[28px_minmax(0,1fr)] gap-2.5 pb-4 before:absolute before:top-[26px] before:bottom-0 before:left-[13px] before:w-[1.5px] before:bg-border last:before:hidden"
            >
              <span
                data-tone={tone}
                className={cn('grid size-7 place-items-center rounded-full', toneClassNames[tone])}
              >
                <Icon icon={event.icon ?? Clock01Icon} className="size-3.5" strokeWidth={2} />
              </span>
              <div className="min-w-0">
                <div className="pt-1 text-sm leading-[1.35] font-medium">{event.title}</div>
                <div className="mt-px text-[12.5px] text-muted-foreground">
                  <time dateTime={event.at}>{formatTime(event.at)}</time>
                  {' · '}
                  {event.actor ?? copy.system}
                </div>
                {event.detail ? (
                  <div className="mt-[3px] text-[13.5px] text-secondary-foreground">
                    {event.detail}
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
}
