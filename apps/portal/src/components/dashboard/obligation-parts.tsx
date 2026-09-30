import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  cn,
  focusRing,
  hasCountdown,
  Icon,
  ObligationCountdown,
  ObligationStatusBadge,
  Tooltip,
} from '@adili/ui';
import { AlertCircleIcon, ArrowRight01Icon, Login03Icon } from '@hugeicons/core-free-icons';
import { Link, useNavigate } from '@tanstack/react-router';
import { useId, useState } from 'react';

import { startMyDeclaration } from '../../server/declarations';
import type { Obligation } from '../../server/declarations/types';
import type { ObligationDetailResult } from '../../server/obligations.server';
import { SIGN_IN } from '../onboarding/links';
import { signInAgain } from '../sign-in';
import { messages as m } from './obligation-messages';
import type { StartAvailability } from './obligations';

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
      {hasCountdown(status) ? (
        <Badge
          className={cn(
            onTint && 'bg-card/80 shadow-card',
            onTint && status === 'due' && 'text-brand-subtle-foreground',
          )}
        >
          <ObligationCountdown obligation={obligation} now={now} />
        </Badge>
      ) : null}
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

const START_FAILED = {
  'not-open': m.startNotOpen,
  'not-found': m.startNotFound,
  unavailable: m.startUnavailable,
} as const;

/**
 * Start declaration, or Continue declaration when a draft for the obligation exists (S20). A
 * filed or cancelled obligation keeps the button disabled with the reason: a disabled button
 * takes neither hover nor focus, so a focusable wrapper carries the tooltip and the button is
 * described by the same words for screen readers. While the declarations load, Start waits
 * (busy) so a draft is not started twice.
 */
export function StartDeclarationButton({
  obligationId,
  availability,
  className,
}: {
  obligationId: string;
  /** `startAvailability` of the obligation. */
  availability: StartAvailability;
  className?: string;
}) {
  const hintId = useId();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (availability.kind === 'continue') {
    return (
      <Button asChild className={className}>
        <Link to="/declarations/$id" params={{ id: availability.declarationId }}>
          {m.continueDeclaration}
          <Icon icon={ArrowRight01Icon} />
        </Link>
      </Button>
    );
  }

  if (availability.kind === 'closed') {
    return (
      <Tooltip content={availability.reason}>
        <span tabIndex={0} className={cn('inline-flex rounded-lg', focusRing, className)}>
          <Button disabled aria-describedby={hintId} className="w-full">
            {m.startDeclaration}
          </Button>
          <span id={hintId} className="sr-only">
            {availability.reason}
          </span>
        </span>
      </Tooltip>
    );
  }

  if (availability.kind === 'pending') {
    return (
      <Button disabled aria-busy="true" className={className}>
        {m.startDeclaration}
        <Icon icon={ArrowRight01Icon} />
      </Button>
    );
  }

  async function start() {
    setBusy(true);
    setError(null);
    const result = await startMyDeclaration({ data: { obligationId } }).catch(
      () => ({ status: 'unavailable' }) as const,
    );
    if (result.status === 'started') {
      await navigate({
        to: '/declarations/$id',
        params: { id: result.declaration.id },
        search: result.created ? { started: true } : {},
      });
      return;
    }
    if (result.status === 'unauthenticated') {
      signInAgain('/');
      return;
    }
    setBusy(false);
    setError(START_FAILED[result.status]);
  }

  // In the card's and the drawer's wrapping action rows, the error takes a line of its own.
  return (
    <>
      <Button disabled={busy} onClick={() => void start()} className={className}>
        {m.startDeclaration}
        <Icon icon={ArrowRight01Icon} />
      </Button>
      {error ? (
        <Alert variant="destructive" className="order-last basis-full">
          <Icon icon={AlertCircleIcon} />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </>
  );
}
