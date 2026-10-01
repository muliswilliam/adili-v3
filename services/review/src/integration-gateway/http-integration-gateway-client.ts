import { createServiceClient, type ServiceClient, type ServiceTokenClient } from '@adili/api-kit';
import { z } from 'zod';

import { rejectedBy } from '../internal-api/rejected.js';
import type { paths } from './integration-gateway-api.gen.js';
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

/**
 * The gateway's adapter kit times payroll out well within this. Instructions go out from workflow
 * activities, which retry. Recorded in ADR-013 §2 (synchronous budgets).
 */
export const PAYROLL_TIMEOUT_MS = 15_000;

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
 * `POST /internal/v1/payroll/instructions` through the client generated from the gateway's
 * contract (integration-gateway-api.gen.ts) with the review service's own token (`payroll`), the
 * legal basis `am-sanctions` and the review case when there is one. 201 (sent now) and 200 (a
 * replay of the same reference) both answer the acknowledgement; an instruction the gateway
 * refuses (400) is `InternalApiRejected`, anything else unexpected `IntegrationGatewayUnavailable`.
 */
export class HttpIntegrationGatewayClient extends IntegrationGatewayClient {
  private readonly gateway: ServiceClient<paths>;

  constructor(options: HttpIntegrationGatewayClientOptions) {
    super();
    this.gateway = createServiceClient<paths>({
      baseUrl: options.gatewayUrl,
      service: 'integration-gateway',
      tokens: options.tokens,
      unavailable: (message, cause) => new IntegrationGatewayUnavailable(message, cause),
      timeoutMs: options.timeoutMs ?? PAYROLL_TIMEOUT_MS,
      fetch: options.fetch,
    });
  }

  submitPayrollInstruction(
    instruction: PayrollInstructionRequest,
    context: PayrollContext,
  ): Promise<PayrollInstruction> {
    return this.gateway.call(
      (api) =>
        api.POST('/internal/v1/payroll/instructions', {
          params: {
            header: {
              'X-Legal-Basis': PAYROLL_LEGAL_BASIS,
              ...(context.caseRef === undefined ? {} : { 'X-Case-Ref': context.caseRef }),
            },
          },
          body: instruction,
        }),
      {
        status: [200, 201],
        schema: instructionSchema,
        otherwise: { 400: rejectedBy('integration-gateway') },
      },
    );
  }
}
