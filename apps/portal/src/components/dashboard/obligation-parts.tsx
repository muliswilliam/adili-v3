import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  cn,
  DateText,
  Icon,
  ObligationStatusBadge,
  Tooltip,
} from '@adili/ui';
import { AlertCircleIcon, InformationCircleIcon, Login03Icon } from '@hugeicons/core-free-icons';
import { useId } from 'react';

import type { Obligation } from '../../server/declarations/types';
import type { ObligationDetailResult } from '../../server/obligations.server';
import { SIGN_IN } from '../onboarding/links';
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
  // On a tinted card the pill is near-white with a hairline, so it reads on the tint.
  const onTint = onCard && status !== 'upcoming';
  return (
    <>
      <ObligationStatusBadge status={status} />
      {status === 'filed' ? null : (
        <Badge
          className={cn(
            onTint && 'bg-card/80 shadow-card',
            onTint && status === 'due' && 'text-brand-subtle-foreground',
          )}
        >
          {status === 'upcoming' ? (
            <DateText date={obligation.statementDate} kind="opens" now={now} />
          ) : (
            <DateText date={obligation.dueDate} now={now} />
          )}
        </Badge>
      )}
    </>
  );
}

/** The session ended while the dashboard was open: the way back is to sign in again. */
export function SessionEnded() {
  return (
    <Alert variant="warning">
      <Icon icon={AlertCircleIcon} />
      <AlertTitle>{m.sessionEndedTitle}</AlertTitle>
      <AlertDescription className="grid justify-items-start gap-2.5">
        <p>{m.sessionEndedText}</p>
        <Button asChild variant="secondary" size="sm">
          <a href={SIGN_IN}>
            <Icon icon={Login03Icon} />
            {m.signInAgain}
          </a>
        </Button>
      </AlertDescription>
    </Alert>
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
