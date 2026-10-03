import { Clock01Icon, LockIcon } from '@hugeicons/core-free-icons';
import { type ComponentProps, type ReactNode, useId } from 'react';

import { daysBetween, plural } from '../lib/calendar-days';
import { cn } from '../lib/cn';
import { useToday } from '../lib/use-today';
import { Badge, type BadgeProps } from './badge';
import { Icon, type IconProps } from './icon';
import { IconTile } from './icon-tile';

/**
 * Why the signed-in officer cannot approve an item, as the review contract's
 * `cannotApproveReason`. `proposer`: they proposed it. `reviewer-of-record`: they reviewed the
 * case. `role`: approving it needs a supervisor.
 */
export type CannotApproveReason = 'proposer' | 'reviewer-of-record' | 'role';

export const CANNOT_APPROVE_REASONS: readonly CannotApproveReason[] = [
  'proposer',
  'reviewer-of-record',
  'role',
];

export interface ApprovalCardMessages {
  /** Read before the proposer. Defaults to "Proposed by". */
  proposedBy: string;
  /** Defaults to "Today" / "Waiting 1 day" / "Waiting {n} days". */
  waiting: (days: number) => string;
  cannotApprove: Record<CannotApproveReason, string>;
  /** The heading of the consequences list. Defaults to "When you approve". */
  consequences: string;
}

export const APPROVAL_CARD_MESSAGES: ApprovalCardMessages = {
  proposedBy: 'Proposed by',
  waiting: (days) => (days <= 0 ? 'Today' : `Waiting ${plural(days, 'day')}`),
  cannotApprove: {
    proposer: 'You proposed this. Another officer must approve it.',
    'reviewer-of-record': 'You cannot approve this: you reviewed this case.',
    role: 'Only a supervisor can approve this.',
  },
  consequences: 'When you approve',
};

/** What approving an item does, one line each: a number allocated, a letter issued, a notice. */
export interface ApprovalConsequence {
  icon: IconProps['icon'];
  title: ReactNode;
  /** A muted line under the title, e.g. the next reference number. */
  detail?: ReactNode;
  /** For an effect that is hard to undo, such as a salary stoppage: its icon tile turns red. */
  grave?: boolean;
}

export type ApprovalConsequencesProps = Omit<ComponentProps<'section'>, 'children'> & {
  items: readonly ApprovalConsequence[];
  /** Defaults to "When you approve". */
  heading?: ReactNode;
};

/**
 * "When you approve" and what follows, as a list: an icon tile per line, the effect in semibold
 * and a muted detail. On an `ApprovalCard` and in the approve dialog, so an approver reads every
 * consequence in text before deciding.
 */
export function ApprovalConsequences({
  items,
  heading = APPROVAL_CARD_MESSAGES.consequences,
  className,
  ...props
}: ApprovalConsequencesProps) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={cn('grid gap-2.5', className)} {...props}>
      <h4 id={headingId} className="text-[14.5px] font-semibold">
        {heading}
      </h4>
      <ul className="grid gap-2.5">
        {items.map((item, index) => (
          <li
            // The lines are fixed for an item and never reordered.
            key={index}
            data-grave={item.grave ? 'true' : undefined}
            className="grid grid-cols-[30px_minmax(0,1fr)] items-start gap-3 text-sm"
          >
            <IconTile tone={item.grave ? 'destructive' : 'default'} size="xs">
              <Icon icon={item.icon} />
            </IconTile>
            <div className="pt-[5px]">
              <div className="font-semibold">{item.title}</div>
              {item.detail === undefined ? null : (
                <div className="text-[13px] text-muted-foreground">{item.detail}</div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

const WAITING_VARIANT = (days: number): NonNullable<BadgeProps['variant']> =>
  days > 30 ? 'destructive' : days >= 7 ? 'warning' : 'default';

export type ApprovalCardProps = Omit<ComponentProps<'article'>, 'title' | 'children'> & {
  /** The kind of item: a scale for a determination, a step's icon, a flag for a referral. */
  icon: IconProps['icon'];
  /** `destructive` for a grave step (salary stoppage, disciplinary referral), `brand` for a referral. */
  tone?: 'default' | 'destructive' | 'brand';
  /** The subject (the declarant) or the step proposed. Names the card unless `aria-label` is set. */
  title: ReactNode;
  /** Beside the title: an `OutcomeBadge`, "Supervisor only", a referral's grounds. */
  badge?: ReactNode;
  /** Muted facts in a row under the title: a reference, the reporting entity, what is overdue. */
  details?: readonly ReactNode[];
  /** Who proposed it, printed "Proposed by {proposer}". */
  proposer?: ReactNode;
  /** When it was proposed, shown as how long it has waited. */
  proposedAt?: string;
  /** Fixes today, for tests and stories. Defaults to the moving Kenyan today. */
  now?: number;
  /** The proposal itself on a sunken panel: the reasons, the earlier steps, the evidence. */
  summary?: ReactNode;
  /** A small caps label over the summary, e.g. "Earlier steps". */
  summaryLabel?: ReactNode;
  /** What approving does, under "When you approve". */
  consequences?: readonly ApprovalConsequence[];
  /**
   * Set when the officer cannot approve it. The card then says why, in place of `decision`.
   * Null or unset means they can.
   */
  cannotApproveReason?: CannotApproveReason | null;
  /** Replaces the default words for `cannotApproveReason`, e.g. naming what needs a supervisor. */
  cannotApproveText?: ReactNode;
  /** Approve and Decline (or Return), shown only when the officer can approve. */
  decision?: ReactNode;
  /** Shown whether or not the officer can approve: Reassign, "Reassigned to you by …". */
  actions?: ReactNode;
  /** At the end of the footer: "Open case", "Open ladder", "Open referral". */
  link?: ReactNode;
  messages?: Partial<Omit<ApprovalCardMessages, 'cannotApprove'>> & {
    cannotApprove?: Partial<ApprovalCardMessages['cannotApprove']>;
  };
};

/**
 * One item waiting for approval in the approvals inbox: a determination, an administrative action
 * step or a referral. An icon tile, the title with a badge beside it, a row of muted details
 * ending "Proposed by …", how long it has waited (amber from 7 days, red past 30), the proposal on
 * a sunken panel, the consequences of approving in text, and a footer. When the officer cannot
 * approve (separation of duties), an amber note with a lock says why where the decision buttons
 * would be; the other actions and the link stay.
 */
export function ApprovalCard({
  icon,
  tone = 'default',
  title,
  badge,
  details = [],
  proposer,
  proposedAt,
  now,
  summary,
  summaryLabel,
  consequences,
  cannotApproveReason,
  cannotApproveText,
  decision,
  actions,
  link,
  messages,
  className,
  ...props
}: ApprovalCardProps) {
  const copy = {
    ...APPROVAL_CARD_MESSAGES,
    ...messages,
    cannotApprove: { ...APPROVAL_CARD_MESSAGES.cannotApprove, ...messages?.cannotApprove },
  };
  const titleId = useId();
  const today = useToday(now);
  const waited =
    proposedAt === undefined ? null : daysBetween(proposedAt, new Date(today).toISOString());
  const blocked = cannotApproveReason !== undefined && cannotApproveReason !== null;
  const meta =
    proposer === undefined
      ? details
      : [
          ...details,
          <>
            {copy.proposedBy} {proposer}
          </>,
        ];

  return (
    <article
      aria-labelledby={props['aria-label'] === undefined ? titleId : undefined}
      className={cn(
        'grid gap-3.5 rounded-xl bg-card p-4 text-card-foreground shadow-card sm:px-5 sm:py-[18px]',
        className,
      )}
      {...props}
    >
      <div className="flex flex-wrap items-start gap-x-3.5 gap-y-2.5">
        <IconTile tone={tone} className="size-[38px] [&_svg]:size-[18px]">
          <Icon icon={icon} />
        </IconTile>
        <div className="grid min-w-0 flex-1 basis-[calc(100%-52px)] gap-1 sm:basis-0">
          <h3
            id={titleId}
            className="flex flex-wrap items-center gap-2 text-[15.5px] font-semibold tracking-[-0.01em]"
          >
            {title}
            {badge}
          </h3>
          {meta.length > 0 ? (
            <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-[13.5px] text-muted-foreground">
              {meta.map((detail, index) => (
                // The details are fixed for an item and never reordered.
                <span key={index}>{detail}</span>
              ))}
            </div>
          ) : null}
        </div>
        {waited === null ? null : (
          <Badge variant={WAITING_VARIANT(waited)} className="max-sm:ml-[52px] sm:shrink-0">
            <Icon icon={Clock01Icon} strokeWidth={2.2} />
            {copy.waiting(waited)}
          </Badge>
        )}
      </div>
      {summary === undefined ? null : (
        <div className="grid gap-2 rounded-lg bg-muted px-3.5 py-3 text-sm text-secondary-foreground">
          {summaryLabel === undefined ? null : (
            <div className="text-xs font-semibold tracking-[0.04em] text-muted-foreground uppercase">
              {summaryLabel}
            </div>
          )}
          <div>{summary}</div>
        </div>
      )}
      {consequences === undefined || consequences.length === 0 ? null : (
        <ApprovalConsequences items={consequences} heading={copy.consequences} />
      )}
      {blocked ? (
        <div
          role="note"
          className="flex items-start gap-2.5 rounded-lg bg-warning-subtle px-3 py-2.5 text-sm font-semibold text-warning-subtle-foreground"
        >
          <Icon icon={LockIcon} className="mt-0.5" />
          <span>{cannotApproveText ?? copy.cannotApprove[cannotApproveReason]}</span>
        </div>
      ) : null}
      {(blocked ? undefined : decision) === undefined &&
      actions === undefined &&
      link === undefined ? null : (
        <div className="flex flex-wrap items-center gap-2 max-sm:[&>[data-slot=decision]>*]:flex-1">
          {blocked || decision === undefined ? null : (
            <div data-slot="decision" className="flex flex-wrap items-center gap-2 max-sm:w-full">
              {decision}
            </div>
          )}
          {actions}
          {link === undefined ? null : <div className="ml-auto flex items-center">{link}</div>}
        </div>
      )}
    </article>
  );
}
