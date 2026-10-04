import {
  Button,
  Card,
  CardTitle,
  formatDate,
  Icon,
  IconTile,
  OutcomeBadge,
  ReferenceChip,
  Spinner,
} from '@adili/ui';
import {
  AlertCircleIcon,
  Download04Icon,
  InformationCircleIcon,
  SecurityCheckIcon,
} from '@hugeicons/core-free-icons';
import { findScheme } from '@adili/numbering/references';
import { Suspense, use, useState } from 'react';

import type { MyDecisionsLoad } from '../../server/decisions';
import type { DecisionLetterResult } from '../../server/decisions.server';
import type { Unauthenticated } from '../../server/results';
import type { DeclarantDecision } from '../../server/review/types';
import { downloadFrom } from '../download';

/** Copy of the Decisions card (spec 08 FE-7). */
export const DECISIONS_COPY = {
  title: 'Decisions',
  outcome: {
    compliant: 'Your declaration meets the requirements. You do not need to do anything.',
    'compliant-no-issues': 'No issues were found. You do not need to do anything.',
    'non-compliant': 'Your Commission may take administrative action. Check Notices.',
    'further-action':
      'If you need to act, we will SMS and email you and it will appear under Notices.',
  } satisfies Record<DeclarantDecision['outcome'], string>,
  decided: (date: string, declaration: string) => `Decided ${formatDate(date)} · ${declaration}`,
  download: 'Download decision letter',
  downloadLabel: (reference: string) => `Download decision letter ${reference}`,
  preparing: 'Preparing…',
  failed: 'We could not prepare your letter. Try again in a few minutes.',
  sessionEnded: 'Your session has ended. Sign in again to download your letter.',
} as const;

/**
 * "Initial declaration", from the reference's type code; "Declaration" for a code the numbering
 * schemes do not know. The type code alone, so a reference that fails its check still names it.
 */
export function declarationName(reference: string): string {
  return findScheme(reference.split('-')[0] ?? '')?.name ?? 'Declaration';
}

/** The letter link, or why there is none. */
export type DeclarationLetterLoad = DecisionLetterResult | Unauthenticated;

const TONE = {
  compliant: 'success',
  'compliant-no-issues': 'success',
  'non-compliant': 'destructive',
  'further-action': 'warning',
} as const satisfies Record<DeclarantDecision['outcome'], string>;

/**
 * The Decisions card on Home (spec 08 FE-7, S17): each compliance determination with its
 * outcome, CMP reference, what it means for the declarant, when it was made and on which
 * declaration, and its decision letter. Shown only once there is a decision; the route loader
 * does not wait for it, and a failed load shows nothing (decisions are also sent by SMS and
 * email).
 */
export function DecisionsSection({
  decisions,
  loadLetter,
}: {
  decisions: Promise<MyDecisionsLoad>;
  loadLetter: (determinationId: string) => Promise<DeclarationLetterLoad>;
}) {
  return (
    <Suspense fallback={null}>
      <ResolvedDecisions promise={decisions} loadLetter={loadLetter} />
    </Suspense>
  );
}

function ResolvedDecisions({
  promise,
  loadLetter,
}: {
  promise: Promise<MyDecisionsLoad>;
  loadLetter: (determinationId: string) => Promise<DeclarationLetterLoad>;
}) {
  const load = use(promise);
  if (load.status !== 'ok' || load.decisions.length === 0) return null;
  return <DecisionsCard decisions={load.decisions} loadLetter={loadLetter} />;
}

export function DecisionsCard({
  decisions,
  loadLetter,
}: {
  decisions: DeclarantDecision[];
  loadLetter: (determinationId: string) => Promise<DeclarationLetterLoad>;
}) {
  return (
    <Card asChild className="gap-0 overflow-hidden p-0 sm:p-0">
      <section aria-labelledby="dashboard-decisions">
        <div className="flex items-center gap-3 border-b border-border px-5 py-4 sm:px-6 sm:py-[18px]">
          <CardTitle id="dashboard-decisions" className="flex-1">
            {DECISIONS_COPY.title}
          </CardTitle>
        </div>
        <ul aria-label={DECISIONS_COPY.title} className="divide-y divide-border">
          {decisions.map((decision) => (
            <DecisionRow
              key={decision.determinationId}
              decision={decision}
              loadLetter={loadLetter}
            />
          ))}
        </ul>
      </section>
    </Card>
  );
}

function DecisionRow({
  decision,
  loadLetter,
}: {
  decision: DeclarantDecision;
  loadLetter: (determinationId: string) => Promise<DeclarationLetterLoad>;
}) {
  const [state, setState] = useState<'idle' | 'preparing' | 'failed' | 'signed-out'>('idle');
  const tone = TONE[decision.outcome];
  const grave = decision.outcome === 'non-compliant';

  async function download() {
    setState('preparing');
    const result = await loadLetter(decision.determinationId).catch(
      () => ({ status: 'unavailable' }) as const,
    );
    if (result.status === 'ok') {
      setState('idle');
      downloadFrom(result.downloadUrl);
    } else {
      setState(result.status === 'unauthenticated' ? 'signed-out' : 'failed');
    }
  }

  return (
    <li className="grid gap-3.5 px-5 py-[18px] sm:px-6">
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-3.5">
        <IconTile tone={tone} size="lg">
          <Icon
            icon={
              grave
                ? AlertCircleIcon
                : decision.outcome === 'further-action'
                  ? InformationCircleIcon
                  : SecurityCheckIcon
            }
          />
        </IconTile>
        <div className="grid min-w-0 gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <OutcomeBadge outcome={decision.outcome} />
            <ReferenceChip reference={decision.reference} size="sm" />
          </div>
          <p
            className={
              grave ? 'text-sm text-destructive-subtle-foreground' : 'text-sm text-muted-foreground'
            }
          >
            {DECISIONS_COPY.outcome[decision.outcome]}
          </p>
          <p className="text-[13px] text-muted-foreground">
            {DECISIONS_COPY.decided(
              decision.decidedAt,
              declarationName(decision.declarationReference),
            )}
          </p>
          {state === 'failed' || state === 'signed-out' ? (
            <p role="alert" className="flex items-center gap-1.5 text-[13px] text-destructive">
              <Icon icon={AlertCircleIcon} className="size-3.5 shrink-0" />
              {state === 'failed' ? DECISIONS_COPY.failed : DECISIONS_COPY.sessionEnded}
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap gap-2 sm:pl-[54px]">
        <Button
          variant="secondary"
          size="sm"
          disabled={state === 'preparing'}
          aria-label={
            state === 'preparing' ? undefined : DECISIONS_COPY.downloadLabel(decision.reference)
          }
          onClick={() => void download()}
        >
          {state === 'preparing' ? <Spinner /> : <Icon icon={Download04Icon} />}
          <span aria-live="polite">
            {state === 'preparing' ? DECISIONS_COPY.preparing : DECISIONS_COPY.download}
          </span>
        </Button>
      </div>
    </li>
  );
}
