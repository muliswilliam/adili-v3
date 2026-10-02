import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiProblemResponse, schemaRef, Scopes, ZodValidationPipe } from '@adili/api-kit';

import { ApiTenantParam, tenantParam } from './admin-input.js';
import { type TenantAiStatus, TenantStatus } from './tenant-status.js';

/**
 * Internal: services with the `ai` scope (review, for the Commission status line it shows its
 * commission admins and supervisors). Not routed by the public entrypoint.
 */
@ApiTags('internal')
@ApiBearerAuth()
@Scopes('ai')
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
  @ApiProblemResponse(400, 'Request failed validation')
  @ApiProblemResponse(403, 'Caller lacks the ai scope')
  getTenantAiStatus(
    @Param('tenant', new ZodValidationPipe(tenantParam)) tenant: string,
  ): Promise<TenantAiStatus> {
    return this.status.of(tenant);
  }
}
