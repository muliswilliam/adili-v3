import {
  Download04Icon,
  InboxIcon,
  JusticeScale01Icon,
  Message01Icon,
  Notification03Icon,
  PackageIcon,
  Stamp01Icon,
  Timer02Icon,
  Undo02Icon,
  UserCheck01Icon,
  UserRemove01Icon,
} from '@hugeicons/core-free-icons';
import { type ReactNode, useId } from 'react';

import { cn } from '../lib/cn';
import { formatDate, formatDateTime, formatMonth } from '../lib/format-date';
import type { Tone } from '../lib/tone';
import type { IconProps } from './icon';
import { type HeadingLevel, TimelineIcon, TimelineItem } from './timeline';

export type { HeadingLevel } from './timeline';

/** The kinds of access register entry (access.yaml `RegisterEntry.kind`). */
export const REGISTER_KINDS = [
  'received',
  'verified',
  'notified',
  'representations',
  'decided',
  'package-issued',
  'downloaded',
  'expired',
  'withdrawn',
  'cannot-identify',
  'self-access',
] as const;

export type RegisterKind = (typeof REGISTER_KINDS)[number];

/** A decision's outcome (access.yaml `Outcome`). */
export type RegisterOutcome = 'grant' | 'partial-grant' | 'deny';

interface EntryMeta {
  label: string;
  icon: IconProps['icon'];
  tone: Tone;
}

/** The console's copy, icon and tint for each kind; entries can override copy and tint. */
export const registerKindMeta: Record<RegisterKind, EntryMeta> = {
  received: { label: 'Request received', icon: InboxIcon, tone: 'default' },
  verified: { label: 'Verified', icon: UserCheck01Icon, tone: 'info' },
  notified: { label: 'Declarant notified', icon: Notification03Icon, tone: 'info' },
  representations: { label: 'Representations received', icon: Message01Icon, tone: 'default' },
  decided: { label: 'Decision recorded', icon: JusticeScale01Icon, tone: 'default' },
  'package-issued': { label: 'Package issued', icon: PackageIcon, tone: 'success' },
  downloaded: { label: 'Package downloaded', icon: Download04Icon, tone: 'default' },
  expired: { label: 'Download window closed', icon: Timer02Icon, tone: 'warning' },
  withdrawn: { label: 'Request withdrawn', icon: Undo02Icon, tone: 'default' },
  'cannot-identify': {
    label: 'Declarant could not be identified',
    icon: UserRemove01Icon,
    tone: 'destructive',
  },
  'self-access': {
    label: 'Certified copy issued (self-access)',
    icon: Stamp01Icon,
    tone: 'success',
  },
};

/** How a `decided` entry reads and is tinted, by its outcome. */
export const registerOutcomeMeta: Record<RegisterOutcome, Pick<EntryMeta, 'label' | 'tone'>> = {
  grant: { label: 'Access granted', tone: 'success' },
  'partial-grant': { label: 'Access partially granted', tone: 'warning' },
  deny: { label: 'Access denied', tone: 'destructive' },
};

export interface RegisterEntry {
  id: string;
  kind: RegisterKind;
  /** When it happened, an ISO date-time. */
  at: string;
  /** Who acted, e.g. "Lucy Wambui" or "Mercy Wanjiku Kamau (applicant)"; null for the system. */
  actor?: string | null;
  /** The request's reference, shown in the list. */
  reference?: string;
  /** For `decided`: sets the copy and tint (granted green, partial amber, denied red). */
  outcome?: RegisterOutcome;
  /** Replaces the default copy, for words written for the reader, e.g. the declarant. */
  title?: ReactNode;
  /** A line of detail under the actor and time. */
  summary?: ReactNode;
  /** Replaces the default tint. */
  tone?: Tone;
}

function display(entry: RegisterEntry) {
  const kind = registerKindMeta[entry.kind];
  const outcome =
    entry.kind === 'decided' && entry.outcome ? registerOutcomeMeta[entry.outcome] : undefined;
  return {
    icon: kind.icon,
    title: entry.title ?? outcome?.label ?? kind.label,
    tone: entry.tone ?? outcome?.tone ?? kind.tone,
  };
}

const newestFirst = (entries: RegisterEntry[]) =>
  [...entries].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

function EntryIcon({ entry, size }: { entry: RegisterEntry; size: 'sm' | 'md' }) {
  const { icon, tone } = display(entry);
  return <TimelineIcon icon={icon} tone={tone} size={size} />;
}

export interface RegisterTimelineProps {
  entries: RegisterEntry[];
  /** Names the list for screen readers. */
  label?: string;
  className?: string;
}

/**
 * The access register for one request as a vertical timeline, newest first, for a card or
 * drawer: each entry's icon and copy by kind, who acted, and when, as a `time` element in
 * Kenyan time.
 */
export function RegisterTimeline({
  entries,
  label = 'Access register',
  className,
}: RegisterTimelineProps) {
  return (
    <ol aria-label={label} className={cn('grid', className)}>
      {newestFirst(entries).map((entry) => (
        <TimelineItem
          key={entry.id}
          data-kind={entry.kind}
          {...display(entry)}
          meta={
            <>
              {entry.actor ? `${entry.actor} · ` : null}
              <time dateTime={entry.at} className="whitespace-nowrap">
                {formatDateTime(entry.at)}
              </time>
            </>
          }
          summary={entry.summary}
        />
      ))}
    </ol>
  );
}

export interface RegisterListProps extends RegisterTimelineProps {
  /** Level of the month headings, to fit the page's outline. */
  headingLevel?: HeadingLevel;
}

/**
 * Register entries across requests as full-width rows grouped by month, newest first, with
 * the reference; for a card without padding (Who accessed my declaration). The date shows;
 * screen readers hear the full time.
 */
export function RegisterList({
  entries,
  label = 'Access register',
  headingLevel = 3,
  className,
}: RegisterListProps) {
  const months: { month: string; entries: RegisterEntry[] }[] = [];
  for (const entry of newestFirst(entries)) {
    const month = formatMonth(entry.at);
    const last = months.at(-1);
    if (last?.month === month) last.entries.push(entry);
    else months.push({ month, entries: [entry] });
  }

  return (
    <div role="group" aria-label={label} className={cn('@container', className)}>
      {months.map(({ month, entries: inMonth }) => (
        <RegisterMonth key={month} month={month} entries={inMonth} headingLevel={headingLevel} />
      ))}
    </div>
  );
}

function RegisterMonth({
  month,
  entries,
  headingLevel,
}: {
  month: string;
  entries: RegisterEntry[];
  headingLevel: HeadingLevel;
}) {
  const headingId = useId();
  const Heading = `h${String(headingLevel)}` as 'h2' | 'h3' | 'h4';
  return (
    <div className="not-first:border-t not-first:border-border">
      <Heading
        id={headingId}
        className="border-b border-border bg-muted/40 px-5 pt-3 pb-1.5 text-[12.5px] font-semibold text-muted-foreground @min-[700px]:px-6"
      >
        {month}
      </Heading>
      <ol aria-labelledby={headingId}>
        {entries.map((entry) => (
          <li
            key={entry.id}
            data-kind={entry.kind}
            className="flex items-start gap-3.5 px-5 py-3.5 not-first:border-t not-first:border-border @min-[700px]:px-6"
          >
            <EntryIcon entry={entry} size="md" />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-px">
              <span className="text-[15px] leading-[1.35] font-medium">{display(entry).title}</span>
              {entry.actor || entry.reference ? (
                <span className="text-[13.5px] leading-[1.4] break-words text-muted-foreground">
                  {entry.actor}
                  {entry.actor && entry.reference ? ' · ' : null}
                  {entry.reference ? (
                    <span className="font-mono text-[12.5px] whitespace-nowrap">
                      {entry.reference}
                    </span>
                  ) : null}
                </span>
              ) : null}
              {entry.summary ? (
                <span className="text-[13.5px] text-secondary-foreground">{entry.summary}</span>
              ) : null}
            </div>
            <time
              dateTime={entry.at}
              className="pt-0.5 text-[13px] whitespace-nowrap text-muted-foreground"
            >
              <span className="sr-only">{formatDateTime(entry.at)}</span>
              <span aria-hidden="true">{formatDate(entry.at)}</span>
            </time>
          </li>
        ))}
      </ol>
    </div>
  );
}
