import { PLATFORM_TENANT } from '@adili/api-kit';
import type { NewEvent } from '@adili/events';

import type {
  InstructionLegalBasis,
  PayrollAction,
  PayrollStatus,
  UnavailableReason,
} from '../db/schema.js';

/**
 * Payroll acknowledged an instruction the gateway sent (ADR-008: integration calls are audited
 * with their legal basis). Once per instruction reference: a replay emits nothing. Identifiers and
 * statuses only, never the personal number or national ID. Subject: the instruction reference;
 * tenant: `platform`, as instructions act for no tenant. The review service's own
 * `payroll.instruction.sent.v1` / `acknowledged.v1` tie it to the administrative action.
 * Documented here until the AsyncAPI file lands.
 */
export const PAYROLL_INSTRUCTION_SUBMITTED = 'payroll.instruction.submitted.v1';

export interface PayrollInstructionSubmittedData extends Record<string, unknown> {
  instructionReference: string;
  action: PayrollAction;
  status: PayrollStatus;
  payrollReference: string | null;
  legalBasis: InstructionLegalBasis;
  caseRef: string | null;
  /** OAuth client of the calling service. */
  requestedBy: string;
}

export function payrollInstructionSubmitted(
  data: PayrollInstructionSubmittedData,
): NewEvent<PayrollInstructionSubmittedData> {
  return {
    type: PAYROLL_INSTRUCTION_SUBMITTED,
    subject: data.instructionReference,
    tenant: PLATFORM_TENANT,
    data,
  };
}

/**
 * The gateway sent payroll an instruction it did not acknowledge (ADR-008: an integration call,
 * answered or not, is audited): payroll down, timed out, its breaker open or paused, or holding
 * another instruction under the reference. Nothing is recorded as sent. Once per attempt; the
 * same identifiers as `payroll.instruction.submitted.v1`, with why.
 */
export const PAYROLL_INSTRUCTION_UNACKNOWLEDGED = 'payroll.instruction.unacknowledged.v1';

export interface PayrollInstructionUnacknowledgedData extends Record<string, unknown> {
  instructionReference: string;
  action: PayrollAction;
  /** An unavailable reason, or `reference-conflict`: payroll holds another instruction under it. */
  reason: UnavailableReason | 'reference-conflict';
  legalBasis: InstructionLegalBasis;
  caseRef: string | null;
  /** OAuth client of the calling service. */
  requestedBy: string;
}

export function payrollInstructionUnacknowledged(
  data: PayrollInstructionUnacknowledgedData,
): NewEvent<PayrollInstructionUnacknowledgedData> {
  return {
    type: PAYROLL_INSTRUCTION_UNACKNOWLEDGED,
    subject: data.instructionReference,
    tenant: PLATFORM_TENANT,
    data,
  };
}
