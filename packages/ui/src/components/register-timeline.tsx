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
import { cva } from 'class-variance-authority';
import { type ReactNode, useId } from 'react';

import { cn } from '../lib/cn';
import { formatDate, formatDateTime, formatMonth } from '../lib/format-date';
import { Icon, type IconProps } from './icon';

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

export type RegisterTone = 'default' | 'info' | 'success' | 'warning' | 'destructive' | 'brand';

/** The console's copy, icon and tint for each kind. Entries can override the copy and tint. */
export const registerKinds: Record<
  RegisterKind,
  { label: string; icon: IconProps['icon']; tone: RegisterTone }
> = {
  received: { label: 'Request received', icon: InboxIcon, tone: 'default' },
  verified: { label: 'Verified', icon: UserCheck01Icon, tone: 'info' },
  notified: { label: 'Declarant notified', icon: Notification03Icon, tone: 'info' },
  representations: { label: 'Representations received', icon: Message01Icon, tone: 'default' },
  decided: { label: 'Decision recorded', icon: JusticeScale01Icon, tone: 'success' },
  'package-issued': { label: 'Package issued', icon: PackageIcon, tone: 'success' },
  downloaded: { label: 'Package downloaded', icon: Download04Icon, tone: 'default' },
  expired: { label: 'Download window closed', icon: Timer02Icon, tone: 'warning' },
  withdrawn: { label: 'Withdrawn by the applicant', icon: Undo02Icon, tone: 'default' },
  'cannot-identify': {
    label: 'Officer could not be identified',
    icon: UserRemove01Icon,
    tone: 'destructive',
  },
  'self-access': {
    label: 'Certified copy issued (self-access)',
    icon: Stamp01Icon,
    tone: 'success',
  },
};

export interface RegisterTimelineEntry {
  id: string;
  kind: RegisterKind;
  /** When it happened, an ISO date-time. */
  at: string;
  /** Who acted, e.g. "Lucy Wambui" or "Mercy Wanjiku Kamau (applicant)"; null for the system. */
  actor?: string | null;
  /** The request's reference, shown in list density. */
  reference?: string;
  /** Replaces the kind's label, for copy written for the reader, e.g. the declarant. */
  title?: ReactNode;
  /** A line of detail under the actor and time. */
  summary?: ReactNode;
  /** Replaces the kind's tint, e.g. red for a denial. */
  tone?: RegisterTone;
}

/** The entry's own title and tone where set, else its kind's. */
function display(entry: RegisterTimelineEntry) {
  const kind = registerKinds[entry.kind];
  return { icon: kind.icon, title: entry.title ?? kind.label, tone: entry.tone ?? kind.tone };
}

const toneVariants = cva('grid shrink-0 place-items-center rounded-full', {
  variants: {
    tone: {
      default: 'bg-muted text-secondary-foreground',
      info: 'bg-info-subtle text-info-subtle-foreground',
      success: 'bg-success-subtle text-success',
      warning: 'bg-warning-subtle text-warning',
      destructive: 'bg-destructive-subtle text-destructive',
      brand: 'bg-brand-subtle text-brand-subtle-foreground',
    },
  },
});

export interface RegisterTimelineProps {
  entries: RegisterTimelineEntry[];
  /** Names the list for screen readers. */
  label?: string;
  /**
   * `compact`: a vertical timeline for one request, in a card or drawer. `list`: full-width
   * rows grouped by month, with the reference, for a card without padding (Who accessed my
   * declaration).
   */
  density?: 'compact' | 'list';
  /** Level of the month headings in list density, to fit the page's outline. */
  headingLevel?: 2 | 3 | 4;
  className?: string;
}

/**
 * The access register as an ordered list, newest first: each entry's icon and copy by kind,
 * who acted and when, as a `time` element in Kenyan time.
 */
export function RegisterTimeline({
  entries,
  label = 'Access register',
  density = 'compact',
  headingLevel = 3,
  className,
}: RegisterTimelineProps) {
  const sorted = [...entries].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  if (density === 'list') {
    return (
      <RegisterList
        entries={sorted}
        label={label}
        headingLevel={headingLevel}
        className={className}
      />
    );
  }

  return (
    <ol aria-label={label} className={cn('grid', className)}>
      {sorted.map((entry) => {
        const shown = display(entry);
        return (
          <li
            key={entry.id}
            data-kind={entry.kind}
            className="relative grid grid-cols-[28px_minmax(0,1fr)] gap-2.5 pb-4 before:absolute before:top-[26px] before:bottom-0 before:left-[13px] before:w-[1.5px] before:bg-border last:pb-0 last:before:hidden"
          >
            <span
              data-tone={shown.tone}
              className={cn(toneVariants({ tone: shown.tone }), 'size-7')}
            >
              <Icon icon={shown.icon} className="size-3.5" strokeWidth={2} />
            </span>
            <div className="min-w-0">
              <div className="pt-1 text-sm leading-[1.35] font-medium">{shown.title}</div>
              <div className="mt-px text-[12.5px] text-muted-foreground">
                {entry.actor ? `${entry.actor} · ` : null}
                <time dateTime={entry.at} className="whitespace-nowrap">
                  {formatDateTime(entry.at)}
                </time>
              </div>
              {entry.summary ? (
                <div className="mt-[3px] text-[13.5px] text-secondary-foreground">
                  {entry.summary}
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function RegisterList({
  entries,
  label,
  headingLevel,
  className,
}: {
  entries: RegisterTimelineEntry[];
  label: string;
  headingLevel: 2 | 3 | 4;
  className?: string | undefined;
}) {
  const months: { month: string; entries: RegisterTimelineEntry[] }[] = [];
  for (const entry of entries) {
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
  entries: RegisterTimelineEntry[];
  headingLevel: 2 | 3 | 4;
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
        {entries.map((entry) => {
          const shown = display(entry);
          return (
            <li
              key={entry.id}
              data-kind={entry.kind}
              className="flex items-start gap-3.5 px-5 py-3.5 not-first:border-t not-first:border-border @min-[700px]:px-6"
            >
              <span
                data-tone={shown.tone}
                className={cn(toneVariants({ tone: shown.tone }), 'size-8')}
              >
                <Icon icon={shown.icon} />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-px">
                <span className="text-[15px] leading-[1.35] font-medium">{shown.title}</span>
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
          );
        })}
      </ol>
    </div>
  );
}
