import { Badge, Icon } from '@adili/ui';
import {
  Alert02Icon,
  BanIcon,
  BanknoteIcon,
  Clock01Icon,
  Tick02Icon,
} from '@hugeicons/core-free-icons';
import type { ReactNode } from 'react';

import type { AdministrativeAction } from '../../server/actions.server';
import { stoppageCopy as c } from './stoppage-messages';

type PayrollAck = NonNullable<AdministrativeAction['payrollStop']>;
type PayrollAction = PayrollAck['action'];

/** Where an instruction stands with payroll. */
export type PayrollState = 'acknowledged' | 'waiting' | 'failed';

/**
 * From its acknowledgement: `accepted` with a receipt is acknowledged, `failed` was refused;
 * anything else, or no acknowledgement yet, waits. The payroll system only answers `accepted`
 * today.
 */
export function payrollState(ack: PayrollAck | null): PayrollState {
  if (ack === null) return 'waiting';
  if (ack.status === 'failed') return 'failed';
  return ack.status === 'accepted' && ack.receivedAt !== null ? 'acknowledged' : 'waiting';
}

/**
 * The payroll instructions a salary stoppage has: the stop-salary one once sent (approved and
 * waiting for payroll, or acknowledged), and the reinstatement once acknowledged. A reinstatement
 * on its way is not shown: `AdministrativeAction` carries no trace of it until payroll answers.
 */
export function payrollInstructionsOf(
  action: AdministrativeAction,
): { action: PayrollAction; ack: PayrollAck | null; reference: string | null }[] {
  if (action.step !== 'salary-stoppage') return [];
  const stop =
    action.payrollStop !== null
      ? [{ action: 'stop_salary' as const, ack: action.payrollStop, reference: null }]
      : action.status === 'approved-pending-payroll'
        ? [{ action: 'stop_salary' as const, ack: null, reference: action.reference }]
        : [];
  const resume =
    action.payrollResume !== null
      ? [{ action: 'resume_salary' as const, ack: action.payrollResume, reference: null }]
      : [];
  return [...stop, ...resume];
}

/** The stepper's payroll line for a salary stoppage, or undefined for none. */
export function payrollLine(action: AdministrativeAction): string | undefined {
  if (action.step !== 'salary-stoppage') return undefined;
  if (action.payrollResume?.receivedAt) {
    return c.stepper.resumeAcknowledged(action.payrollResume.receivedAt);
  }
  if (action.payrollStop?.receivedAt)
    return c.stepper.stopAcknowledged(action.payrollStop.receivedAt);
  return action.status === 'approved-pending-payroll' ? c.stepper.waiting : undefined;
}

/** A salary stoppage payroll acknowledged and has not reinstated: the salary is stopped now. */
export function salaryStopped(action: AdministrativeAction): boolean {
  return (
    action.step === 'salary-stoppage' &&
    action.payrollStop?.receivedAt != null &&
    action.payrollResume === null &&
    (action.status === 'issued' || action.status === 'responded')
  );
}

/** "Salary stopped", in red, for a stoppage in force (the prototype's step badge). */
export function SalaryStoppedBadge() {
  return (
    <Badge variant="destructive">
      <Icon icon={BanIcon} />
      {c.salaryStopped}
    </Badge>
  );
}

const BADGE = {
  acknowledged: { variant: 'success', icon: Tick02Icon, text: c.payroll.acknowledged },
  waiting: { variant: 'warning', icon: Clock01Icon, text: c.payroll.waiting },
  failed: { variant: 'destructive', icon: Alert02Icon, text: c.payroll.failed },
} as const;

/**
 * A stop-salary or reinstatement instruction to payroll and its acknowledgement (spec 08 FE-5;
 * S6, S7, S15): the instruction reference (the stoppage's ADM reference, `-R` for the
 * reinstatement, as payroll acknowledged it), the action, payroll's own reference and when it
 * was received. Amber while payroll has not acknowledged it.
 */
export function PayrollInstruction({
  action,
  ack,
  reference,
}: {
  action: PayrollAction;
  ack: PayrollAck | null;
  /** The instruction's reference before payroll acknowledges it. */
  reference: string | null;
}) {
  const state = payrollState(ack);
  const badge = BADGE[state];
  const title = action === 'stop_salary' ? c.payroll.stop : c.payroll.resume;
  const instructionReference = ack?.instructionReference ?? reference;
  return (
    <section
      aria-label={title}
      className={
        state === 'acknowledged'
          ? 'grid gap-3 rounded-lg bg-info-subtle/60 px-4 py-3.5 text-sm'
          : 'grid gap-3 rounded-lg bg-warning-subtle px-4 py-3.5 text-sm'
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <Icon icon={BanknoteIcon} className="size-4 text-secondary-foreground" />
        <span className="font-semibold">{title}</span>
        <Badge variant={badge.variant}>
          <Icon icon={badge.icon} />
          {badge.text}
        </Badge>
      </div>
      <dl className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-x-6 gap-y-2.5">
        {instructionReference ? (
          <Fact term={c.payroll.instructionReference} mono>
            {instructionReference}
          </Fact>
        ) : null}
        <Fact term={c.payroll.action} mono>
          {action}
        </Fact>
        <Fact term={c.payroll.payrollReference} mono={Boolean(ack?.payrollReference)}>
          {ack?.payrollReference ?? c.payroll.notYet}
        </Fact>
        {ack?.receivedAt ? (
          <Fact term={c.payroll.receivedAt}>{c.payroll.receivedAtValue(ack.receivedAt)}</Fact>
        ) : null}
      </dl>
      {state === 'waiting' ? (
        <p className="text-[13px] text-warning-subtle-foreground">
          {c.payroll.waitingNote[action]}
        </p>
      ) : null}
    </section>
  );
}

function Fact({
  term,
  mono = false,
  children,
}: {
  term: string;
  mono?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="grid min-w-0 gap-0.5">
      <dt className="text-[12.5px] text-muted-foreground">{term}</dt>
      <dd className={mono ? 'font-mono text-[13px] break-all' : 'text-[13.5px] font-medium'}>
        {children}
      </dd>
    </div>
  );
}
