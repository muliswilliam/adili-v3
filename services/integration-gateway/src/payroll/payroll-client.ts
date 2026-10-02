import { Inject, Injectable } from '@nestjs/common';

import { UpstreamError } from '../adapter-kit/upstream-error.js';
import { callUpstream } from '../adapter-kit/upstream-http.js';
import {
  type PayrollAcknowledgement,
  payrollAcknowledgementSchema,
  type PayrollInstructionRequest,
} from './payroll-records.js';

export const PAYROLL_CLIENT_OPTIONS = Symbol('PAYROLL_CLIENT_OPTIONS');

export interface PayrollClientOptions {
  /** Ends before `/v1`, e.g. `http://localhost:8000/payroll`. */
  baseUrl: string;
}

/**
 * The payroll adapter (external/payroll.yaml `submitInstruction`): sends one stop or resume
 * salary instruction and answers payroll's acknowledgement. Payroll is idempotent by instruction
 * reference, answering a resubmission with the original (200), so sending again after a timeout
 * never stops a salary twice. Everything about the officer travels in the body. Anything but an
 * acknowledgement of this instruction reference is an `UpstreamError`. No retries here: the
 * caller's workflow retries, and the kit's timeout and breaker apply (`ResilientCalls`).
 */
@Injectable()
export class PayrollClient {
  constructor(@Inject(PAYROLL_CLIENT_OPTIONS) private readonly options: PayrollClientOptions) {}

  async submit(
    instruction: PayrollInstructionRequest,
    signal: AbortSignal,
  ): Promise<PayrollAcknowledgement> {
    const acknowledgement = await callUpstream(
      {
        name: 'Payroll',
        url: `${this.options.baseUrl}/v1/instructions`,
        signal,
        ok: [200, 201],
        body: {
          instruction_reference: instruction.instructionReference,
          employer_code: instruction.employerCode,
          personal_number: instruction.personalNumber,
          id_number: instruction.nationalId,
          action: instruction.action,
          reason: instruction.reason,
          effective_date: instruction.effectiveDate,
        },
      },
      payrollAcknowledgementSchema,
    );
    if (acknowledgement?.instructionReference !== instruction.instructionReference) {
      throw new UpstreamError('upstream-error', 'Payroll acknowledged another instruction');
    }
    return acknowledgement;
  }
}
