import { Controller, Get, Param } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  ApiProblemResponse,
  CurrentPrincipal,
  notFoundIfInvisible,
  type Principal,
  schemaRef,
  TENANT_KEY,
} from '@adili/api-kit';
import { COMMISSION_ADMIN } from '@adili/roles';
import { z } from 'zod';

import {
  AiGatewayClient,
  AiGatewayUnavailable,
  type DataClass,
} from '../ai-gateway/ai-gateway-client.js';
import { dataClassOf } from './copilot-requests.js';
import { aiGatewayUnavailable } from './problems.js';

/** The ai-gateway's data classes (ai-gateway.yaml `DataClass`). */
const DATA_CLASSES = [
  'synthetic',
  'restricted',
  'highly-confidential',
] as const satisfies readonly DataClass[];

/** review.yaml `CommissionAiStatus`. */
export const commissionAiStatusSchema = z.object({
  enabled: z.boolean().meta({
    description:
      "The copilot may run on the Commission's cases: the data class they are sent as is among `dataClasses`",
  }),
  providerClass: z.enum(['external', 'self-hosted']).nullable().meta({
    description:
      "The provider class the Commission's AI tasks are routed to; null when no route names a provider the ai-gateway can reach",
  }),
  provider: z.string().nullable().meta({
    description:
      "The provider the Commission's AI tasks are routed to (`anthropic`...), of `providerClass`; null when `providerClass` is",
  }),
  dataClasses: z.array(z.enum(DATA_CLASSES)).meta({
    description: 'Data classes that provider class may process for the Commission',
  }),
});
export type CommissionAiStatus = z.infer<typeof commissionAiStatusSchema>;

/**
 * The Commission's AI status line (spec 07c): the ai-gateway's tenant status, read for the
 * Commission's admin only (commission administrators see a read-only status line). Enabled when
 * the gate lets the routed provider see the data class the copilot sends this Commission's cases
 * as, so the line agrees with the panel.
 */
@ApiTags('copilot')
@Controller('v1/commissions/:slug/ai-status')
export class AiStatusController {
  constructor(private readonly gateway: AiGatewayClient) {}

  @Get()
  @ApiParam({ name: 'slug', schema: { type: 'string', pattern: TENANT_KEY.source } })
  @ApiOperation({
    operationId: 'getCommissionAiStatus',
    summary: 'Whether AI assistance is enabled for the Commission (commission-admin)',
    description:
      "The commission-admin of the Commission; anyone else gets 404. Reads the ai-gateway's tenant status (its routes and classification gate). `enabled` says whether the copilot may run on this Commission's cases: the data class its declarations are sent as is among `dataClasses`.",
  })
  @ApiOkResponse({ description: 'Status', schema: schemaRef('CommissionAiStatus') })
  @ApiProblemResponse(404, 'Not found, or not visible to the caller')
  @ApiProblemResponse(503, 'Problem type `ai-gateway-unavailable`; the status could not be read')
  async status(
    @CurrentPrincipal() principal: Principal,
    @Param('slug') slug: string,
  ): Promise<CommissionAiStatus> {
    const tenant = notFoundIfInvisible(
      principal.tenant === slug &&
        TENANT_KEY.test(slug) &&
        principal.roles.includes(COMMISSION_ADMIN)
        ? slug
        : null,
    );
    const status = await this.gateway.tenantStatus(tenant).catch((error: unknown) => {
      if (error instanceof AiGatewayUnavailable) {
        throw aiGatewayUnavailable(
          'The AI status could not be read from the ai-gateway. Try again shortly.',
        );
      }
      throw error;
    });
    return {
      enabled: status.dataClasses.includes(dataClassOf(tenant)),
      providerClass: status.providerClass,
      provider: status.provider,
      dataClasses: status.dataClasses,
    };
  }
}
