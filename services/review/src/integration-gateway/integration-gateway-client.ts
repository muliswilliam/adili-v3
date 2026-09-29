/** integration-gateway.yaml `PayrollAction`. */
export type PayrollAction = 'stop_salary' | 'resume_salary';

/**
 * A stop or resume salary instruction (integration-gateway.yaml `PayrollInstructionRequest`).
 * Personal data: it travels to the gateway only, never into logs, events or workflow history.
 */
export interface PayrollInstructionRequest {
  /** The `ADM` reference (stop), or it with `-R` (resume): payroll is idempotent by it. */
  instructionReference: string;
  employerCode: string;
  personalNumber: string;
  nationalId: string;
  action: PayrollAction;
  reason: string;
  /** `YYYY-MM-DD`. */
  effectiveDate: string;
}

/** integration-gateway.yaml `PayrollInstruction`: the instruction as payroll acknowledged it. */
export interface PayrollInstruction {
  instructionReference: string;
  action: PayrollAction;
  status: 'accepted' | 'pending' | 'failed';
  payrollReference: string | null;
  receivedAt: string | null;
  sentAt: string;
}

/** On whose behalf an instruction is sent: the Commission, and the review case when there is one. */
export interface PayrollContext {
  tenant: string;
  caseRef?: string;
}

/**
 * The integration-gateway (or payroll behind it) is unreachable, answered 503 or outside its
 * contract: nothing is recorded as sent, and activities retry with backoff.
 */
export class IntegrationGatewayUnavailable extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'IntegrationGatewayUnavailable';
  }
}

/**
 * What the review service asks of the integration-gateway's internal API, one synchronous hop per
 * call (ADR-013). A Nest token: the service uses `HttpIntegrationGatewayClient`, tests a fake.
 */
export abstract class IntegrationGatewayClient {
  /**
   * `submitPayrollInstruction`: sends the instruction to payroll and answers its acknowledgement.
   * Idempotent by instruction reference: a replay answers the stored acknowledgement and sends
   * nothing twice. Throws `IntegrationGatewayUnavailable` when payroll cannot be reached and
   * `InternalApiRejected` when the gateway refuses the request.
   */
  abstract submitPayrollInstruction(
    instruction: PayrollInstructionRequest,
    context: PayrollContext,
  ): Promise<PayrollInstruction>;
}
