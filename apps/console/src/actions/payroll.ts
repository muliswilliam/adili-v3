import type { AdministrativeAction } from '../server/actions.server';

/**
 * Where a salary stoppage stands with payroll (spec 08, #208; S6, S7, S15), from its stop and
 * resume acknowledgements. Pure: the ladder, its page and the Actions list read it.
 */

export type PayrollAck = NonNullable<AdministrativeAction['payrollStop']>;

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

/** When payroll acknowledged `ack`, or null while it has not (waiting or refused). */
export function acknowledgedAt(ack: PayrollAck | null): string | null {
  return ack !== null && payrollState(ack) === 'acknowledged' ? ack.receivedAt : null;
}

/** A salary stoppage payroll acknowledged and has not reinstated: the salary is stopped now. */
export function salaryStopped(action: AdministrativeAction): boolean {
  return (
    action.step === 'salary-stoppage' &&
    acknowledgedAt(action.payrollStop) !== null &&
    acknowledgedAt(action.payrollResume) === null &&
    // Acknowledged but its letter not yet issued (`approved`), or issued.
    (action.status === 'approved' || action.status === 'issued' || action.status === 'responded')
  );
}

/** When payroll acknowledged the ladder's latest reinstatement, or null. */
export function reinstatedAtOf(steps: readonly AdministrativeAction[]): string | null {
  for (const step of [...steps].reverse()) {
    const at = acknowledgedAt(step.payrollResume);
    if (at) return at;
  }
  return null;
}
