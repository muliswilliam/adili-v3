import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ActingTenant,
  ApiProblemResponse,
  InternalApi,
  schemaRef,
  ZodValidationPipe,
} from '@adili/api-kit';

import { AI_SCOPE } from '../internal-api.js';
import { ApiTenantParam, tenantParam } from './admin-input.js';
import { type TenantAiStatus, TenantStatus } from './tenant-status.js';

/**
 * Internal: services with the `ai:internal` scope (review, for the Commission status line it shows its
 * commission admin), acting for the tenant in `X-Acting-Tenant` (ADR-013 §8.8), which must be
 * the one in the path. Not routed by the public entrypoint.
 */
@ApiTags('internal')
@ApiBearerAuth()
@InternalApi(AI_SCOPE)
@Controller('internal/v1/tenants')
export class TenantStatusController {
  constructor(private readonly status: TenantStatus) {}

  @Get(':tenant/status')
  @ApiTenantParam()
  @ApiOperation({
    operationId: 'getTenantAiStatus',
    summary:
      'Whether AI assistance is enabled for a tenant and with which provider class (review proxies it for the Commission status line)',
    description:
      "Derived from the tenant's routes and its classification gate (explicit rules, else the default): the provider classes the tenant's tasks are routed to, and the data classes every one of them may process.",
  })
  @ApiOkResponse({ description: 'Status', schema: schemaRef('TenantAiStatus') })
  @ApiProblemResponse(400, 'Request failed validation, or X-Acting-Tenant is missing')
  @ApiProblemResponse(404, 'The tenant is not the one the caller acts for')
  getTenantAiStatus(
    @Param('tenant', new ZodValidationPipe(tenantParam)) tenant: string,
    @ActingTenant() actingFor: string,
  ): Promise<TenantAiStatus> {
    if (tenant !== actingFor) throw new NotFoundException('No such tenant');
    return this.status.of(tenant);
  }
}
