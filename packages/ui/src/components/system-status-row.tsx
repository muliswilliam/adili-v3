import { Alert02Icon, ArrowDown01Icon, Tick02Icon } from '@hugeicons/core-free-icons';
import { type ComponentProps, type ReactNode, useId, useState } from 'react';

import { cn } from '../lib/cn';
import { formatDateTime } from '../lib/format-date';
import { keepHyphenatedWords } from '../lib/keep-hyphenated-words';
import { Badge, type BadgeProps } from './badge';
import { Icon, type IconProps } from './icon';
import { IconTile } from './icon-tile';
import { Spinner } from './spinner';

/**
 * Where one registry's check for one person stands. `matched`: every record is declared.
 * `mismatched`: the check raised indicators. `unavailable`: the registry did not answer (it is
 * re-checked automatically). `not-checked`: checks have not run yet. `no-id`: the person has no
 * national ID, so no registry can be asked.
 */
export type SystemCheckStatus = 'matched' | 'mismatched' | 'unavailable' | 'not-checked' | 'no-id';

export const SYSTEM_CHECK_STATUSES: readonly SystemCheckStatus[] = [
  'matched',
  'mismatched',
  'unavailable',
  'not-checked',
  'no-id',
];

export interface SystemStatusRowMessages {
  statuses: Record<SystemCheckStatus, string>;
  /** The row copy under the system's name for each status; `description` replaces it. */
  descriptions: {
    /** Defaults to "1 record, all declared" / "{n} records, all declared". */
    matched: (count: number) => string;
    /** Defaults to "1 indicator" / "{n} indicators". */
    mismatched: (count: number) => string;
    /** Defaults to "Could not reach {system}. Re-checked automatically every hour." */
    unavailable: (system: string) => string;
    'not-checked': string;
    /** Defaults to "Registries cannot be checked for {name} without an ID." */
    'no-id': (name: string) => string;
  };
  /** Defaults to "Checked {date and time}". */
  checkedAt: (dateTime: string) => string;
  checking: string;
}

const plural = (count: number, one: string, many: string) =>
  count === 1 ? `1 ${one}` : `${String(count)} ${many}`;

export const SYSTEM_STATUS_ROW_MESSAGES: SystemStatusRowMessages = {
  statuses: {
    matched: 'Matched',
    mismatched: 'Mismatched',
    unavailable: 'Unavailable',
    'not-checked': 'Not checked',
    'no-id': 'No national ID declared',
  },
  descriptions: {
    matched: (count) => `${plural(count, 'record', 'records')}, all declared`,
    mismatched: (count) => plural(count, 'indicator', 'indicators'),
    unavailable: (system) => `Could not reach ${system}. Re-checked automatically every hour.`,
    'not-checked': 'Checks run after submission.',
    'no-id': (name) => `Registries cannot be checked for ${name} without an ID.`,
  },
  checkedAt: (dateTime) => `Checked ${dateTime}`,
  checking: 'Checking…',
};

const STATUS_META: Record<
  SystemCheckStatus,
  { variant: NonNullable<BadgeProps['variant']>; icon?: IconProps['icon'] }
> = {
  matched: { variant: 'success', icon: Tick02Icon },
  mismatched: { variant: 'warning', icon: Alert02Icon },
  unavailable: { variant: 'default' },
  'not-checked': { variant: 'default' },
  'no-id': { variant: 'default' },
};

type Messages = Partial<
  Omit<SystemStatusRowMessages, 'statuses' | 'descriptions'> & {
    statuses: Partial<SystemStatusRowMessages['statuses']>;
    descriptions: Partial<SystemStatusRowMessages['descriptions']>;
  }
>;

export type SystemStatusRowProps = Omit<ComponentProps<'li'>, 'children'> & {
  /** The system's name, e.g. "KRA" or "ArdhiSasa". Not translated. */
  name: string;
  /** The system's icon, shown in a tile before the name. */
  icon?: IconProps['icon'];
  /** The check's status: a badge with its word, and the default row copy. */
  status?: SystemCheckStatus;
  /** Replaces the status badge, e.g. with a BreakerBadge on the Integrations page. */
  badge?: ReactNode;
  /** The row copy under the name; replaces the status's default copy. */
  description?: ReactNode;
  /** Records for `matched`, indicators for `mismatched`, in the default copy. */
  count?: number;
  /** The person checked, for the `no-id` copy. */
  personName?: string;
  /** When the check ran (ISO date-time), shown under the row copy as "Checked {date, time}". */
  checkedAt?: string;
  /** A check is running: a spinner and "Checking…" stand in for the copy and badge. */
  checking?: boolean;
  /**
   * Figures between the row copy and the badge, e.g. call volume and cache hit rate on the
   * Integrations page. Under the name on narrow screens.
   */
  metrics?: ReactNode;
  /** An action at the end of the row, e.g. a Pause button. Stays outside the expand button. */
  action?: ReactNode;
  /**
   * The detail under the row, e.g. a MatchTable. With it the row expands: the system's name
   * becomes a button with `aria-expanded` that toggles it, and the whole row is its hit area.
   */
  children?: ReactNode;
  /** Opens the detail (controlled). Pair with `onExpandedChange`. */
  expanded?: boolean;
  /** Opens the detail on first render (uncontrolled). */
  defaultExpanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  /** Replaces any of the default copy. */
  messages?: Messages;
};

/**
 * One external system in a list: its icon, name and row copy, when it was checked, a status badge
 * with its word (never colour alone) and an optional action. Given `children` it expands: the
 * name is a button with `aria-expanded` and `aria-controls`, stretched over the row so the whole
 * row toggles, with a chevron at the end; the action sits above it and keeps its own click.
 * Renders an `<li>`, so put it in a SystemStatusList.
 */
export function SystemStatusRow({
  name,
  icon,
  status,
  badge,
  description,
  count = 0,
  personName = '',
  checkedAt,
  checking = false,
  metrics,
  action,
  children,
  expanded: controlled,
  defaultExpanded = false,
  onExpandedChange,
  messages: overrides,
  className,
  ...props
}: SystemStatusRowProps) {
  const detailId = useId();
  const [uncontrolled, setUncontrolled] = useState(defaultExpanded);
  const expanded = controlled ?? uncontrolled;
  const expandable = children !== undefined && children !== null && children !== false;

  const messages = {
    ...SYSTEM_STATUS_ROW_MESSAGES,
    ...overrides,
    statuses: { ...SYSTEM_STATUS_ROW_MESSAGES.statuses, ...overrides?.statuses },
    descriptions: { ...SYSTEM_STATUS_ROW_MESSAGES.descriptions, ...overrides?.descriptions },
  };

  const copy = description ?? (status ? defaultDescription(status) : null);

  function defaultDescription(value: SystemCheckStatus) {
    const { descriptions } = messages;
    if (value === 'matched') return descriptions.matched(count);
    if (value === 'mismatched') return descriptions.mismatched(count);
    if (value === 'unavailable') return descriptions.unavailable(name);
    if (value === 'no-id') return descriptions['no-id'](personName);
    return descriptions['not-checked'];
  }

  function toggle() {
    const next = !expanded;
    setUncontrolled(next);
    onExpandedChange?.(next);
  }

  const shownBadge =
    badge ??
    (status ? (
      <Badge variant={STATUS_META[status].variant}>
        {STATUS_META[status].icon ? (
          <Icon icon={STATUS_META[status].icon} strokeWidth={2.2} />
        ) : null}
        {messages.statuses[status]}
      </Badge>
    ) : null);

  return (
    <li
      data-status={status}
      data-expanded={expandable ? expanded : undefined}
      className={cn('border-t border-border/60 first:border-t-0', className)}
      {...props}
    >
      <div
        className={cn(
          'relative flex items-center gap-x-2.5 px-3.5 py-2.5',
          expandable && 'hover:bg-muted/40',
        )}
      >
        {icon ? (
          <IconTile className="size-[30px] self-start rounded-md [&_svg]:size-[15px]">
            <Icon icon={icon} />
          </IconTile>
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col gap-x-2.5 gap-y-1.5 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">
              {expandable ? (
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={detailId}
                  onClick={toggle}
                  className="cursor-pointer text-left outline-hidden after:absolute after:inset-0 after:rounded-xl focus-visible:after:outline-2 focus-visible:after:outline-solid focus-visible:after:-outline-offset-2 focus-visible:after:outline-ring"
                >
                  {name}
                </button>
              ) : (
                name
              )}
            </div>
            {checking ? (
              <div
                role="status"
                className="mt-px flex items-center gap-2 text-[12.5px] text-muted-foreground"
              >
                <Spinner className="size-3 border-[1.5px]" />
                {messages.checking}
              </div>
            ) : (
              <>
                {copy ? (
                  <div className="mt-px text-[12.5px] text-secondary-foreground">
                    {typeof copy === 'string' ? keepHyphenatedWords(copy) : copy}
                  </div>
                ) : null}
                {checkedAt ? (
                  <div className="text-[12.5px] text-muted-foreground">
                    {messages.checkedAt(formatDateTime(checkedAt))}
                  </div>
                ) : null}
              </>
            )}
          </div>
          {metrics ? <div className="min-w-0 shrink-0">{metrics}</div> : null}
          {(!checking && shownBadge) || action ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2.5">
              {!checking ? shownBadge : null}
              {/* Above the stretched expand button, so it keeps its own click. */}
              {action ? <div className="relative z-10">{action}</div> : null}
            </div>
          ) : null}
        </div>
        {/* Reserved on every row, so badges line up down a list where only some rows expand. */}
        <span className="mt-0.5 flex size-4 shrink-0 self-start sm:mt-0 sm:self-center">
          {expandable ? (
            <Icon
              icon={ArrowDown01Icon}
              strokeWidth={2}
              className={cn(
                'text-muted-foreground transition-transform motion-reduce:transition-none',
                expanded && 'rotate-180',
              )}
            />
          ) : null}
        </span>
      </div>
      {expandable ? (
        <div id={detailId} hidden={!expanded} className="grid gap-2.5 px-3.5 pt-0.5 pb-3.5">
          {children}
        </div>
      ) : null}
    </li>
  );
}

export type SystemStatusListProps = ComponentProps<'ul'> & {
  /** Names the list, e.g. "Registry checks for Wanjiku Njeri Kamau". */
  label?: string;
  /** A header above the rows, e.g. the person checked. */
  header?: ReactNode;
};

/**
 * A card listing SystemStatusRows, one hairline between rows, with an optional header on a faint
 * fill (the person whose records were checked).
 */
export function SystemStatusList({
  label,
  header,
  className,
  children,
  ...props
}: SystemStatusListProps) {
  return (
    <div className={cn('overflow-hidden rounded-item bg-card shadow-card', className)}>
      {header ? (
        <div className="flex items-center gap-2.5 border-b bg-background/60 px-3.5 py-[11px]">
          {header}
        </div>
      ) : null}
      <ul aria-label={label} {...props}>
        {children}
      </ul>
    </div>
  );
}
