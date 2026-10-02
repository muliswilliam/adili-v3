import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiProblemResponse, Scopes, ZodValidationPipe } from '@adili/api-kit';

import { tenantParam } from './admin-input.js';
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
  @ApiOperation({ operationId: 'getTenantAiStatus' })
  @ApiOkResponse({ description: 'Status' })
  @ApiProblemResponse(400, 'Request failed validation')
  @ApiProblemResponse(403, 'Caller lacks the ai scope')
  getTenantAiStatus(
    @Param('tenant', new ZodValidationPipe(tenantParam)) tenant: string,
  ): Promise<TenantAiStatus> {
    return this.status.of(tenant);
  }
}
