import { Tick02Icon } from '@hugeicons/core-free-icons';
import { type ComponentProps, type ReactNode, useId } from 'react';

import { cn } from '../lib/cn';
import { formatDate } from '../lib/format-date';
import { Button } from './button';
import { Icon, type IconProps } from './icon';
import { SOURCE_ICONS, SOURCE_NAMES, type SourceKind } from './source-badge';
import { Spinner } from './spinner';

/** One field a suggestion carries, e.g. `{ key: 'registration', label: 'Registration', value: 'KCA 123A' }`. */
export interface SuggestionField {
  key: string;
  label: string;
  value: string;
}

/** An existing item the suggestion matches, and the fields it would fill there. */
export interface SuggestionMatch {
  /** The item's name, e.g. "Toyota Probox". */
  title: string;
  /** Fields the item has empty and the suggestion can fill. See `emptyFieldDiff`. */
  fills: SuggestionField[];
}

/**
 * `new` is waiting for a decision, `accepted` has been added or applied, `dismissed` was set
 * aside. Superseded suggestions are not shown.
 */
export type SuggestionStatus = 'new' | 'accepted' | 'dismissed';

/**
 * The suggested fields that would fill a gap in an existing item: those with a value whose key
 * is empty (missing, null or blank) in `existing`. Never overwrites what is already entered.
 */
export function emptyFieldDiff(
  suggested: SuggestionField[],
  existing: Record<string, unknown>,
): SuggestionField[] {
  const isEmpty = (value: unknown) =>
    value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
  return suggested.filter((field) => field.value.trim() !== '' && isEmpty(existing[field.key]));
}

export interface SuggestionMessages {
  /** The source line. Defaults to "From {source}, {date}". */
  source: (source: string, date: string) => string;
  add: string;
  editAndAdd: string;
  apply: string;
  dismiss: string;
  view: string;
  /**
   * An action's accessible name, which carries the item title: defaults to "{action}: {title}",
   * e.g. "Add: KCA 123A · Toyota Probox 2016".
   */
  actionLabel: (action: string, title: string) => string;
  /** Defaults to 'Matches "{title}".' */
  matches: (title: string) => string;
  fills: string;
  /**
   * Said of a match whose fields are all filled already. Defaults to "Nothing to fill. Applying
   * records {source} as this item's source."
   */
  nothingToFill: (source: string) => string;
  added: string;
  applied: string;
  dismissed: string;
  saving: string;
  refreshing: string;
}

/** The card's default copy; screens that show the same states reuse it. */
export const SUGGESTION_MESSAGES: SuggestionMessages = {
  source: (source, date) => `From ${source}, ${date}`,
  add: 'Add',
  editAndAdd: 'Edit and add',
  apply: 'Apply to this item',
  dismiss: 'Dismiss',
  view: 'View',
  actionLabel: (action, title) => `${action}: ${title}`,
  matches: (title) => `Matches "${title}".`,
  fills: 'Fills:',
  nothingToFill: (source) => `Nothing to fill. Applying records ${source} as this item's source.`,
  added: 'Added',
  applied: 'Applied',
  dismissed: 'Dismissed',
  saving: 'Saving…',
  refreshing: 'Your statement changed. Refreshing…',
};

export type SuggestionCardProps = Omit<ComponentProps<'article'>, 'children' | 'title'> & {
  /** What was found, e.g. "KCA 123A · Toyota Probox 2016". Every action is named after it. */
  title: string;
  source: SourceKind;
  /** When the registry answered or the document was read, as an ISO timestamp. */
  at: string;
  /** Shown in the icon tile. Defaults to the source's icon. */
  icon?: IconProps['icon'];
  /** A line under the source, e.g. "Motor vehicle · add the value yourself". */
  description?: ReactNode;
  /** A preview of what the suggestion carries. Not shown when it matches an item. */
  fields?: SuggestionField[];
  /**
   * The existing item it matches. The main action becomes "Apply to this item", listing the
   * empty fields it fills. It stays the main action when there is nothing to fill: applying
   * still records the source on the item. Add and Edit and add stay as secondary actions, for
   * when it is a different item after all.
   */
  match?: SuggestionMatch;
  status?: SuggestionStatus;
  /** How an accepted card reads. Defaults to "Applied" when it matches an item, else "Added". */
  acceptedAs?: 'added' | 'applied';
  /**
   * Replaces the actions with a spinner and a status while accepting: `saving`, or `refreshing`
   * after the statement changed underneath (409 or 412) and the accept is being retried.
   */
  busy?: 'saving' | 'refreshing';
  /** Adds the item as found: the main action, or a secondary one when it matches an item. */
  onAdd?: () => void;
  /** Opens the fields for changes before adding. */
  onEditAndAdd?: () => void;
  /** Fills the matched item's empty fields. Offered only with a `match`. */
  onApply?: () => void;
  onDismiss?: () => void;
  /** Goes to the added or updated item. Offered once accepted. */
  onView?: () => void;
  /** Heading level of the title. Defaults to 3. */
  headingLevel?: 2 | 3 | 4 | 5 | 6;
  /** Replaces any of the default copy. */
  messages?: Partial<SuggestionMessages>;
  disabled?: boolean;
};

/**
 * One thing a registry or document suggests adding to the declaration: its title, where and when
 * it came from, a preview of its fields and what can be done with it. New suggestions offer
 * Add, Edit and add, and Dismiss; one matching an existing item leads with "Apply to this item"
 * (listing the empty fields it fills), then Add, Edit and add, and Dismiss. Accepted cards collapse to "Added" (or "Applied") with a View
 * action; dismissed ones to "Dismissed". Every action's accessible name includes the title, and
 * each state is in text, never colour alone.
 */
export function SuggestionCard({
  title,
  source,
  at,
  icon,
  description,
  fields = [],
  match,
  status = 'new',
  acceptedAs,
  busy,
  onAdd,
  onEditAndAdd,
  onApply,
  onDismiss,
  onView,
  headingLevel = 3,
  messages: overrides,
  disabled = false,
  className,
  ...props
}: SuggestionCardProps) {
  const messages = { ...SUGGESTION_MESSAGES, ...overrides };
  const titleId = useId();
  const Heading = `h${String(headingLevel)}` as 'h3';
  const sourceLine = messages.source(SOURCE_NAMES[source], formatDate(at));

  function action(
    label: string,
    onClick: (() => void) | undefined,
    variant: 'default' | 'secondary' | 'ghost',
  ) {
    if (!onClick) return null;
    return (
      <Button
        type="button"
        size="sm"
        variant={variant}
        disabled={disabled}
        aria-label={messages.actionLabel(label, title)}
        onClick={onClick}
      >
        {label}
      </Button>
    );
  }

  const heading = (
    <Heading id={titleId} className="text-[15px] leading-snug font-medium">
      {title}
    </Heading>
  );

  if (status !== 'new') {
    const accepted = status === 'accepted';
    const statusText = !accepted
      ? messages.dismissed
      : (acceptedAs ?? (match ? 'applied' : 'added')) === 'applied'
        ? messages.applied
        : messages.added;
    return (
      <article
        aria-labelledby={titleId}
        data-status={status}
        className={cn(
          'flex items-center gap-3 rounded-item px-4 py-2.5',
          accepted ? 'bg-card shadow-card' : 'bg-muted',
          className,
        )}
        {...props}
      >
        {accepted ? (
          <span
            aria-hidden="true"
            className="grid size-7 shrink-0 place-items-center rounded-full bg-success-subtle text-success"
          >
            <Icon icon={Tick02Icon} strokeWidth={2.4} className="size-[15px]" />
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          {heading}
          {!accepted ? (
            <p className="text-[13px] leading-snug text-muted-foreground">{sourceLine}</p>
          ) : null}
        </div>
        <span
          className={cn(
            'text-[13px] whitespace-nowrap',
            accepted ? 'font-medium text-success' : 'text-muted-foreground',
          )}
        >
          {statusText}
        </span>
        {accepted ? action(messages.view, onView, 'ghost') : null}
      </article>
    );
  }

  const actions = match ? (
    <>
      {action(messages.apply, onApply, 'default')}
      {action(messages.add, onAdd, 'secondary')}
      {action(messages.editAndAdd, onEditAndAdd, 'secondary')}
      {action(messages.dismiss, onDismiss, 'ghost')}
    </>
  ) : (
    <>
      {action(messages.add, onAdd, 'default')}
      {action(messages.editAndAdd, onEditAndAdd, 'secondary')}
      {action(messages.dismiss, onDismiss, 'ghost')}
    </>
  );

  return (
    <article
      aria-labelledby={titleId}
      aria-busy={busy ? true : undefined}
      data-status={status}
      className={cn(
        'flex flex-wrap items-start gap-x-3 gap-y-3 rounded-item bg-card px-4 py-3.5 shadow-card',
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className="grid size-[38px] shrink-0 place-items-center rounded-lg bg-muted text-secondary-foreground"
      >
        <Icon icon={icon ?? SOURCE_ICONS[source]} className="size-[17px]" />
      </span>
      <div className="min-w-0 flex-1 basis-56">
        {heading}
        <p className="mt-px text-[13px] leading-snug text-muted-foreground">{sourceLine}</p>
        {description ? (
          <div className="mt-1.5 text-[13.5px] leading-snug text-secondary-foreground">
            {description}
          </div>
        ) : null}
        {match ? (
          <p className="mt-1.5 text-[13.5px] leading-snug text-secondary-foreground">
            {messages.matches(match.title)}{' '}
            {match.fills.length > 0 ? (
              <>
                {messages.fills}{' '}
                {match.fills.map((field, index) => (
                  <span key={field.key}>
                    {index > 0 ? ', ' : null}
                    {field.label} <strong className="font-semibold">{field.value}</strong>
                  </span>
                ))}
              </>
            ) : (
              messages.nothingToFill(SOURCE_NAMES[source])
            )}
          </p>
        ) : fields.length > 0 ? (
          <dl className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[13px] leading-snug">
            {fields.map((field) => (
              <div key={field.key} className="flex gap-1.5">
                <dt className="text-muted-foreground">{field.label}</dt>
                <dd className="font-medium">{field.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 max-sm:w-full max-sm:pl-[50px]">
        {/* Always mounted, so the change to busy is announced. */}
        <span
          role="status"
          className={
            busy ? 'inline-flex items-center gap-2 text-[13px] text-muted-foreground' : 'sr-only'
          }
        >
          {busy ? (
            <>
              <Spinner className="size-3.5" />
              {busy === 'refreshing' ? messages.refreshing : messages.saving}
            </>
          ) : null}
        </span>
        {busy ? null : actions}
      </div>
    </article>
  );
}
