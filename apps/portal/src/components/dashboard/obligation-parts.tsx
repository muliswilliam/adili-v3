import { Button, cn, DateText, Icon, obligationStatusMeta, StatusBadge, Tooltip } from '@adili/ui';
import { AlertCircleIcon, InformationCircleIcon } from '@hugeicons/core-free-icons';
import { useId } from 'react';

import type { Obligation } from '../../server/declarations/types';
import type { ObligationDetailResult } from '../../server/obligations.server';
import { messages as m } from './obligation-messages';

export type LoadObligationDetail = (id: string) => Promise<ObligationDetailResult>;

/** The status badge and the days left, overdue or until it opens. */
export function ObligationStatus({
  obligation,
  now,
  onCard = false,
}: {
  obligation: Obligation;
  now?: number;
  /** On a tinted card the relative text sits in a light pill. */
  onCard?: boolean;
}) {
  const { status } = obligation;
  if (status === 'cancelled') return null;
  const meta = obligationStatusMeta[status];
  return (
    <>
      <StatusBadge variant={meta.variant}>{meta.label}</StatusBadge>
      {status === 'filed' ? null : (
        <span
          className={cn(
            'inline-flex h-6 items-center rounded-full px-[9px] text-[12.5px] font-medium whitespace-nowrap',
            status === 'upcoming' || !onCard
              ? 'bg-muted text-secondary-foreground'
              : 'bg-card/80 ring-1',
            onCard && status === 'due' && 'text-brand-subtle-foreground ring-brand/20',
            onCard && status === 'overdue' && 'ring-warning/25',
          )}
        >
          {status === 'upcoming' ? (
            <DateText date={obligation.statementDate} kind="opens" now={now} />
          ) : (
            <DateText date={obligation.dueDate} now={now} />
          )}
        </span>
      )}
    </>
  );
}

/** "Overdue." and what to do if the declaration was made by other means. */
export function OverdueNote({ className }: { className?: string }) {
  return (
    <p
      className={cn(
        'flex items-start gap-2 text-[13.5px] text-warning-subtle-foreground',
        className,
      )}
    >
      <Icon icon={AlertCircleIcon} className="mt-0.5 size-[15px] shrink-0" />
      <span>
        <strong className="font-semibold text-destructive">{m.overdueLead}</strong> {m.overdueText}
      </span>
    </p>
  );
}

/** "Statement date" with its meaning in a tooltip, reachable by keyboard. */
export function StatementDateTerm() {
  return (
    <Tooltip content={m.statementDateTip} side="bottom">
      <span
        tabIndex={0}
        className="inline-flex cursor-help items-center gap-1 rounded-sm underline decoration-current/40 decoration-dotted underline-offset-[3px] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {m.statementDate}
        <Icon icon={InformationCircleIcon} className="size-[13px]" aria-hidden="true" />
      </span>
    </Tooltip>
  );
}

/**
 * Start declaration, disabled until capture ships (slice 05). A disabled button takes neither
 * hover nor focus, so a focusable wrapper carries the tooltip; the button itself is described
 * by the same words for screen readers.
 */
export function StartDeclarationButton({ className }: { className?: string }) {
  const hintId = useId();
  return (
    <Tooltip content={m.filingOpensSoon}>
      <span
        tabIndex={0}
        className={cn(
          'inline-flex rounded-lg outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
          className,
        )}
      >
        <Button disabled aria-describedby={hintId} className="w-full">
          {m.startDeclaration}
        </Button>
        <span id={hintId} className="sr-only">
          {m.filingOpensSoon}
        </span>
      </span>
    </Tooltip>
  );
}
