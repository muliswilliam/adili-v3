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

import { AiGatewayClient, AiGatewayUnavailable } from '../ai-gateway/ai-gateway-client.js';
import { dataClassOf } from './copilot-requests.js';
import { aiGatewayUnavailable } from './problems.js';

/** review.yaml `CommissionAiStatus`. */
export interface CommissionAiStatus {
  enabled: boolean;
  providerClass: 'external' | 'self-hosted' | null;
  dataClasses: string[];
}

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
  })
  @ApiOkResponse({ description: 'Status', schema: schemaRef('CommissionAiStatus') })
  @ApiProblemResponse(404, 'Not found, or not visible to the caller')
  @ApiProblemResponse(503, 'Problem type `ai-gateway-unavailable`')
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
      dataClasses: status.dataClasses,
    };
  }
}
