import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  formatDate,
  Icon,
} from '@adili/ui';
import { AlertCircleIcon, ArrowRight01Icon, Calendar03Icon } from '@hugeicons/core-free-icons';
import { Link, useNavigate } from '@tanstack/react-router';
import { useId, useState } from 'react';

import { OBLIGATION_TYPE_LABELS } from '../declaration/labels';
import { startDeclarationFn } from '../../server/declarations';
import type { DeclarationListResult, ObligationsResult } from '../../server/declarations.server';
import type { Obligation, ObligationStatus } from '../../server/declarations/types';
import { startAvailability } from './obligations';

/** What the dashboard loads for an onboarded declarant's obligations card. */
export interface DashboardWork {
  obligations: ObligationsResult;
  declarations: DeclarationListResult;
}

const STATUS_BADGES: Record<
  ObligationStatus,
  { label: string; variant: 'default' | 'info' | 'warning' | 'success' }
> = {
  upcoming: { label: 'Upcoming', variant: 'default' },
  due: { label: 'Due', variant: 'info' },
  overdue: { label: 'Overdue', variant: 'warning' },
  filed: { label: 'Filed', variant: 'success' },
  cancelled: { label: 'Cancelled', variant: 'default' },
};

const START_FAILED = {
  'not-open': 'This obligation is no longer open, so a declaration cannot be started.',
  'not-found': 'We could not find this obligation. Reload the page and try again.',
  unavailable: 'We could not start your declaration. Try again in a few minutes.',
} as const;

function StartButton({ obligationId }: { obligationId: string }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    const result = await startDeclarationFn({ data: { obligationId } }).catch(
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
      window.location.assign(`/auth/login?returnTo=${encodeURIComponent('/')}`);
      return;
    }
    setBusy(false);
    setError(START_FAILED[result.status]);
  }

  return (
    <div className="grid gap-2">
      <Button
        type="button"
        disabled={busy}
        onClick={() => void start()}
        className="justify-self-start"
      >
        Start declaration
        <Icon icon={ArrowRight01Icon} />
      </Button>
      {error ? (
        <Alert variant="destructive">
          <Icon icon={AlertCircleIcon} />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

function ObligationRow({
  obligation,
  declarations,
}: {
  obligation: Obligation;
  declarations: DeclarationListResult;
}) {
  const reasonId = useId();
  const availability = startAvailability(
    obligation,
    declarations.status === 'ok' ? declarations.declarations : [],
  );
  const badge = STATUS_BADGES[obligation.status];
  return (
    <li className="grid gap-3 py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={badge.variant}>{badge.label}</Badge>
        {availability.kind === 'continue' ? <Badge>Draft in progress</Badge> : null}
      </div>
      <div className="grid gap-0.5">
        <h3 className="font-semibold">
          {OBLIGATION_TYPE_LABELS[obligation.type]} declaration · {obligation.commission.name}
        </h3>
        <p className="text-sm text-muted-foreground">
          Statement date {formatDate(obligation.statementDate)} · Due{' '}
          {formatDate(obligation.dueDate)}
        </p>
        {obligation.status === 'upcoming' ? (
          <p className="text-sm text-muted-foreground">
            Submit from {formatDate(obligation.statementDate)}.
          </p>
        ) : null}
      </div>
      {availability.kind === 'start' ? <StartButton obligationId={obligation.id} /> : null}
      {availability.kind === 'continue' ? (
        <Button asChild className="justify-self-start">
          <Link to="/declarations/$id" params={{ id: availability.declarationId }}>
            Continue declaration
            <Icon icon={ArrowRight01Icon} />
          </Link>
        </Button>
      ) : null}
      {availability.kind === 'closed' ? (
        <div className="grid gap-1.5">
          <Button type="button" disabled aria-describedby={reasonId} className="justify-self-start">
            Start declaration
          </Button>
          <p id={reasonId} className="text-sm text-muted-foreground">
            {availability.reason}
          </p>
        </div>
      ) : null}
    </li>
  );
}

function NoObligations() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-10 text-center">
      <Icon icon={Calendar03Icon} className="size-6 text-muted-foreground" />
      <p className="text-sm font-medium">No obligations yet</p>
      <p className="max-w-xs text-sm text-muted-foreground">
        Obligations appear here when a declaration falls due under your Commission's roster.
      </p>
    </div>
  );
}

/**
 * The declarant's filing obligations with Start declaration.
 *
 * TEMPORARY: spec 04's obligation card and drawer (#89) are not built yet, so spec 05 puts the
 * Start declaration call to action here. It moves onto the #89 obligations card when that lands.
 */
export function ObligationsCard({ work }: { work?: DashboardWork | null }) {
  const groups = work?.obligations.status === 'ok' ? work.obligations.obligations.groups : [];
  const obligations = groups.flatMap((group) => group.obligations);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Filing obligations</CardTitle>
        <CardDescription>Declarations you are required to file.</CardDescription>
      </CardHeader>
      <CardContent>
        {work?.obligations.status === 'unavailable' ? (
          <Alert variant="destructive">
            <Icon icon={AlertCircleIcon} />
            <AlertDescription>
              We could not load your obligations. Try again in a few minutes.
            </AlertDescription>
          </Alert>
        ) : obligations.length === 0 ? (
          <NoObligations />
        ) : (
          <ul className="divide-y divide-border">
            {obligations.map((obligation) => (
              <ObligationRow
                key={obligation.id}
                obligation={obligation}
                declarations={work?.declarations ?? { status: 'ok', declarations: [] }}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
