import type { ServiceTokenClient } from '@adili/api-kit';
import { z } from 'zod';

import { InternalApi } from '../internal-api/internal-api.js';
import {
  IntegrationGatewayClient,
  IntegrationGatewayUnavailable,
  type PayrollContext,
  type PayrollInstruction,
  type PayrollInstructionRequest,
} from './integration-gateway-client.js';

/** The scope the review service's token needs for the gateway's payroll instructions. */
export const PAYROLL_SCOPE = 'payroll';

/** The legal basis of every payroll instruction: sanctions under the Administrative Mechanisms. */
export const PAYROLL_LEGAL_BASIS = 'am-sanctions';

export interface HttpIntegrationGatewayClientOptions {
  gatewayUrl: string;
  tokens: Pick<ServiceTokenClient, 'token' | 'invalidate'>;
  timeoutMs?: number;
  /** For tests. */
  fetch?: typeof fetch;
}

const instructionSchema = z.object({
  instructionReference: z.string().min(1),
  action: z.enum(['stop_salary', 'resume_salary']),
  status: z.enum(['accepted', 'pending', 'failed']),
  payrollReference: z.string().nullable(),
  receivedAt: z.string().nullable(),
  sentAt: z.string(),
});

/**
 * `POST /internal/v1/payroll/instructions` with the review service's own token (`payroll`), the
 * legal basis `am-sanctions` and the review case when there is one. 201 (sent now) and 200 (a
 * replay of the same reference) both answer the acknowledgement.
 */
export class HttpIntegrationGatewayClient extends IntegrationGatewayClient {
  private readonly api: InternalApi;

  constructor(options: HttpIntegrationGatewayClientOptions) {
    super();
    this.api = new InternalApi({
      baseUrl: options.gatewayUrl,
      service: 'integration-gateway',
      tokens: options.tokens,
      unavailable: (message, cause) => new IntegrationGatewayUnavailable(message, cause),
      // The gateway's adapter kit times payroll out well within this.
      timeoutMs: options.timeoutMs ?? 15_000,
      fetch: options.fetch,
    });
  }

  async submitPayrollInstruction(
    instruction: PayrollInstructionRequest,
    context: PayrollContext,
  ): Promise<PayrollInstruction> {
    const acknowledged = await this.api.post({
      path: 'internal/v1/payroll/instructions',
      tenant: context.tenant,
      headers: {
        'x-legal-basis': PAYROLL_LEGAL_BASIS,
        ...(context.caseRef === undefined ? {} : { 'x-case-ref': context.caseRef }),
      },
      body: instruction,
      schema: instructionSchema,
    });
    if (!acknowledged) {
      throw new IntegrationGatewayUnavailable('The integration-gateway answered 404');
    }
    return acknowledged;
  }
}
