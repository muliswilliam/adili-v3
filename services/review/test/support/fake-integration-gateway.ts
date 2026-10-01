import { randomUUID } from 'node:crypto';

import {
  IntegrationGatewayClient,
  IntegrationGatewayUnavailable,
  type PayrollContext,
  type PayrollInstruction,
  type PayrollInstructionRequest,
} from '../../src/integration-gateway/integration-gateway-client.js';

/** An instruction as the fake payroll holds it: what was sent, for whom, and its acknowledgement. */
export interface StoredInstruction {
  request: PayrollInstructionRequest;
  context: PayrollContext;
  acknowledgement: PayrollInstruction;
}

/**
 * The integration-gateway's payroll instructions for tests, behaving as the payroll mock does:
 * one instruction per reference (a resubmission answers the stored acknowledgement and stores
 * nothing), every call recorded. `failCalls` makes the next calls fail as a payroll outage would
 * (nothing stored); `loseResponses` stores the next instructions but fails the calls, as a timeout
 * after payroll accepted would.
 */
export class FakeIntegrationGateway extends IntegrationGatewayClient {
  /** Every call, in order, including replays and failed ones. */
  readonly calls: { request: PayrollInstructionRequest; context: PayrollContext }[] = [];
  private readonly stored = new Map<string, StoredInstruction>();
  private failures = 0;
  private lost = 0;
  private now: () => Date = () => new Date();

  /** The instructions payroll holds, in the order it received them. */
  get instructions(): StoredInstruction[] {
    return [...this.stored.values()];
  }

  /** The next `count` calls fail (payroll unavailable); nothing is stored. */
  failCalls(count: number): void {
    this.failures = count;
  }

  /** The next `count` new instructions are stored, but their calls fail (a lost response). */
  loseResponses(count: number): void {
    this.lost = count;
  }

  /** When payroll receives instructions (the service clock, in tests that set it). */
  receiveAt(now: () => Date): void {
    this.now = now;
  }

  reset(): void {
    this.calls.length = 0;
    this.stored.clear();
    this.failures = 0;
    this.lost = 0;
    this.now = () => new Date();
  }

  submitPayrollInstruction(
    request: PayrollInstructionRequest,
    context: PayrollContext,
  ): Promise<PayrollInstruction> {
    this.calls.push({ request: structuredClone(request), context: { ...context } });
    if (this.failures > 0) {
      this.failures -= 1;
      return Promise.reject(new IntegrationGatewayUnavailable('Payroll is unavailable'));
    }
    const replayed = this.stored.get(request.instructionReference);
    if (replayed) return Promise.resolve(structuredClone(replayed.acknowledgement));
    const at = this.now().toISOString();
    const acknowledgement: PayrollInstruction = {
      instructionReference: request.instructionReference,
      action: request.action,
      status: 'accepted',
      payrollReference: randomUUID(),
      receivedAt: at,
      sentAt: at,
    };
    this.stored.set(request.instructionReference, {
      request: structuredClone(request),
      context: { ...context },
      acknowledgement,
    });
    if (this.lost > 0) {
      this.lost -= 1;
      return Promise.reject(new IntegrationGatewayUnavailable('Payroll timed out'));
    }
    return Promise.resolve(structuredClone(acknowledgement));
  }
}
