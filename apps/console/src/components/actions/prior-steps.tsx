import { Badge, Button, Icon, type IconProps, Skeleton } from '@adili/ui';
import {
  Alert02Icon,
  AlertCircleIcon,
  Attachment01Icon,
  BanIcon,
  MinusSignIcon,
  Notification01Icon,
  UserWarning01Icon,
} from '@hugeicons/core-free-icons';
import type { ReactNode } from 'react';

import type { ActionStep, AdministrativeAction, Ladder } from '../../server/actions.server';
import { stepLabel } from './messages';
import { PayrollInstruction, payrollInstructionsOf } from './payroll-instruction';
import { stoppageCopy as c } from './stoppage-messages';

/** Each step's icon, on the inbox card, its earlier steps and the approve dialog. */
export const STEP_ICONS: Record<ActionStep, IconProps['icon']> = {
  'notice-to-comply': Notification01Icon,
  warning: AlertCircleIcon,
  'salary-stoppage': BanIcon,
  'disciplinary-referral': UserWarning01Icon,
};

/** Only a notice or a warning takes a response; the later steps say nothing about one. */
export function takesResponse(step: ActionStep): boolean {
  return step === 'notice-to-comply' || step === 'warning';
}

/**
 * The steps before `actionId` on the ladder that were approved (they carry a reference), in
 * ladder order: what the approver of a later step reads first (US 13).
 */
export function stepsBefore(ladder: Ladder, actionId: string): AdministrativeAction[] {
  const index = ladder.steps.findIndex((step) => step.id === actionId);
  const before = index === -1 ? ladder.steps : ladder.steps.slice(0, index);
  return before.filter((step) => step.reference !== null);
}

/** What came before a step: loaded from the ladder, or on its way, or failed. */
export type EarlierSteps =
  | { state: 'loading' }
  | { state: 'failed'; retry: () => void }
  | { state: 'ok'; steps: readonly AdministrativeAction[] };

/**
 * "What came before" in a grave step's approve dialog (spec 08 FE-3, US 13): each earlier step
 * with who approved it and its window, the declarant's whole response with its files, and the
 * salary stoppage's payroll acknowledgement. A skeleton while the ladder loads; Try again when it
 * failed.
 */
export function WhatCameBefore({ earlier }: { earlier: EarlierSteps }) {
  return (
    <section className="grid gap-2.5" aria-busy={earlier.state === 'loading'}>
      <h3 className="text-[14.5px] font-semibold">{c.before.title}</h3>
      <div className="rounded-lg bg-muted px-3.5 py-3">
        {earlier.state === 'ok' ? (
          <PriorSteps steps={earlier.steps.map(priorStepOf)} label={c.before.title} />
        ) : earlier.state === 'failed' ? (
          <div role="alert" className="grid justify-items-start gap-2 text-sm">
            <p className="flex items-center gap-1.5 text-destructive">
              <Icon icon={Alert02Icon} className="size-4" />
              {c.before.failed}
            </p>
            <Button size="sm" variant="secondary" onClick={earlier.retry}>
              {c.before.retry}
            </Button>
          </div>
        ) : (
          <div className="grid gap-2" role="status" aria-label={c.before.loading}>
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3.5 w-4/5" />
            <Skeleton className="h-4 w-2/5" />
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * One earlier step as `PriorSteps` shows it: from the ladder in full (the approve dialog) or from
 * the inbox item's summary (the card, with a response excerpt and how many files came with it).
 */
export interface PriorStepView {
  id: string;
  step: ActionStep;
  reference: string | null;
  /** "Issued 29 Jul 2026 · approved by … · act by …", or null. */
  line: string | null;
  response: { at: string; text: string; files: ReactNode[] } | null;
  /** The salary stoppage's payroll instructions; none from a summary. */
  action: AdministrativeAction | null;
}

/** A ladder's step, read in full. */
export function priorStepOf(step: AdministrativeAction): PriorStepView {
  return {
    id: step.id,
    step: step.step,
    reference: step.reference,
    line: issuedLine(step),
    response: step.response
      ? {
          at: step.response.submittedAt,
          text: step.response.text,
          files: step.response.attachments.map((file) => (
            <Badge key={file.uploadId}>
              <Icon icon={Attachment01Icon} />
              {file.fileName}
            </Badge>
          )),
        }
      : null,
    action: step,
  };
}

/**
 * The steps before the one to approve: each with its reference and when it was issued, the
 * salary stoppage's payroll instructions, and the declarant's response (or that there was none,
 * for a notice or a warning). `clamp` shortens responses to three lines (the inbox card).
 */
export function PriorSteps({
  steps,
  label,
  clamp = false,
}: {
  steps: readonly PriorStepView[];
  label: string;
  clamp?: boolean;
}) {
  if (steps.length === 0) {
    return <p className="text-[13px] text-muted-foreground">{c.before.firstStep}</p>;
  }
  return (
    <ul aria-label={label} className="grid divide-y divide-dashed divide-border">
      {steps.map((step) => (
        <li
          key={step.id}
          className="grid grid-cols-[22px_minmax(0,1fr)] gap-x-2.5 py-2.5 first:pt-0 last:pb-0"
        >
          <span
            aria-hidden="true"
            className="mt-px flex size-[22px] items-center justify-center rounded-full bg-card text-muted-foreground inset-ring-1 inset-ring-border"
          >
            <Icon icon={STEP_ICONS[step.step]} className="size-3" />
          </span>
          <div className="grid min-w-0 gap-1.5">
            <div className="grid gap-0.5">
              <div className="flex flex-wrap items-baseline gap-x-1.5 text-sm">
                <span className="font-medium text-foreground">{stepLabel(step.step)}</span>
                {step.reference ? (
                  <span className="font-mono text-[12.5px] text-muted-foreground">
                    {step.reference}
                  </span>
                ) : null}
              </div>
              {step.line ? <p className="text-[13px] text-muted-foreground">{step.line}</p> : null}
            </div>
            {step.action
              ? payrollInstructionsOf(step.action).map((instruction) => (
                  <PayrollInstruction key={instruction.action} {...instruction} />
                ))
              : null}
            {step.response ? (
              <Response at={step.response.at} text={step.response.text} clamp={clamp}>
                {step.response.files.length > 0 ? step.response.files : null}
              </Response>
            ) : takesResponse(step.step) ? (
              <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                <Icon icon={MinusSignIcon} className="size-3" />
                {c.before.noResponse}
              </p>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** "Issued 29 Jul 2026 · approved by Faith Achieng · act by 12 Aug 2026". */
function issuedLine(step: AdministrativeAction): string | null {
  if (!step.issuedAt) return null;
  const parts = [c.before.issued(step.issuedAt)];
  if (step.approver) parts.push(c.before.approvedBy(step.approver.name));
  if (step.windowEndsAt) {
    parts.push(
      step.step === 'salary-stoppage'
        ? c.before.stoppageWindowEnds(step.windowEndsAt)
        : c.before.actBy(step.windowEndsAt),
    );
  }
  return parts.join(' · ');
}

function Response({
  at,
  text,
  clamp,
  children,
}: {
  at: string;
  text: string;
  clamp: boolean;
  children?: ReactNode;
}) {
  return (
    <blockquote className="grid gap-1.5 rounded-md border-l-[3px] border-border bg-card px-3 py-2 text-[13.5px] text-secondary-foreground">
      <p className={clamp ? 'line-clamp-3' : 'whitespace-pre-line'}>
        <span className="font-semibold text-foreground">{c.before.response(at)}</span> {text}
      </p>
      {children ? <div className="flex flex-wrap gap-1.5">{children}</div> : null}
    </blockquote>
  );
}
